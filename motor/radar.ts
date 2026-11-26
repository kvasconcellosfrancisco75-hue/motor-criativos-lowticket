/**
 * Radar de ofertas low ticket escaladas na Biblioteca de Anúncios da Meta.
 *
 *   npm run radar                                   # coleta, verifica preços, aprofunda e gera o relatório
 *   npm run radar -- --config radar/config.json     # outro arquivo de configuração
 *   npm run radar -- --saida ../privado/radar       # grava coletas e relatórios em outra pasta
 *   npm run radar -- --de-arquivo <busca.json>      # reaproveita uma coleta (não paga a etapa 1 de novo)
 *   npm run radar -- --paginas-de-arquivo <json>    # reaproveita o aprofundamento (etapa 3)
 *   npm run radar -- --sem-aprofundar               # pula a etapa 3 (a mais cara)
 *   npm run radar -- --sem-verificar                # não abre as páginas (sem preço confirmado)
 *   npm run radar -- --termos "a,b" --limite 20     # teste barato
 *   npm run radar -- --fonte apify                  # coleta pelo Apify em vez do navegador próprio
 *
 * Etapas
 *  1. Descoberta: busca por frases que só aparecem em anúncio de oferta ("acesso imediato", "pagamento único"...).
 *     Descarta e-commerce, catálogo, apps, WhatsApp e perfis. Agrupa os anúncios em OFERTAS pelo destino
 *     (vários anunciantes e criativos levando à mesma página são uma oferta só).
 *  2. Preço: abre a página das ofertas mais fortes (e o checkout, se achar o link) e lê o preço.
 *  3. Aprofundamento: para as ofertas low ticket, visita as páginas que as anunciam. Com o navegador próprio, lê o
 *     total de anúncios ativos da página e estima quantos levam à oferta pela amostra; com o Apify, coleta os
 *     anúncios e conta. É a medida de volume de verdade; a busca da etapa 1 só mostra uma amostra.
 *  4. Critérios: low ticket, volume, longevidade, investimento contínuo e tendência (a partir da 2ª coleta).
 *
 * Fonte dos anúncios: "navegador" (padrão, motor/biblioteca.ts, sem custo) ou "apify" (cobrança por resultado).
 *
 * App: com RADAR_API (endereço do app) e RADAR_TOKEN definidos, o radar envia o progresso de cada etapa e o resultado
 * final ao app (app/), que guarda o histórico usado na tendência e avisa no telefone.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ApifyClient } from "apify-client";
import { cofreDe } from "./cofre";
import { exportarRadar } from "./obsidian";
import { args, lerJSON, salvarJSON } from "./util";
import { Biblioteca } from "./biblioteca";

const a = args();
const cfg = lerJSON(path.resolve(a.config ?? "radar/config.json"));
const crit = { preco_min: 17, preco_max: 97, min_ativos: 15, min_dias: 21, novos_dias: 7, min_novos: 1, queda_max: 0.2, ...(cfg.criterios ?? {}) };
const pastaDados = path.resolve(a.saida ?? cfg.saida ?? "radar/dados");
const hoje = new Date();
const diaHoje = hoje.toISOString().slice(0, 10);
const DIA = 86400000;
/** Ticket dentro da faixa low ticket da configuração (padrão: de R$ 17 a R$ 97). */
const naFaixa = (p?: number) => p !== undefined && p >= crit.preco_min && p <= crit.preco_max;
const pais = cfg.pais ?? "BR";
const fonte: "navegador" | "apify" = (a.fonte ?? cfg.fonte ?? "navegador") as any;

// ───────────────────────────── app (progresso e resultado) ─────────────────────────────

const API = (process.env.RADAR_API ?? "").replace(/\/$/, "");
const TOKEN = process.env.RADAR_TOKEN ?? "";
const execucao = `${diaHoje}-${hoje.getTime().toString(36)}`;

/** Chama o app com curl (respeita HTTPS_PROXY; o fetch do Node não). Falha do app nunca para o radar. */
function chamarApp(metodo: "GET" | "POST", caminho: string, corpo?: unknown): any {
  if (!API) return undefined;
  const r = spawnSync(
    "curl",
    ["-sS", "--fail-with-body", "--max-time", "60", "-X", metodo, "-H", `Authorization: Bearer ${TOKEN}`, "-H", "Content-Type: application/json",
      ...(corpo === undefined ? [] : ["--data-binary", "@-"]), `${API}${caminho}`],
    { input: corpo === undefined ? undefined : JSON.stringify(corpo), encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    console.log(`  (app: ${metodo} ${caminho} falhou: ${(r.stdout || r.stderr || "").trim().slice(0, 160)})`);
    return undefined;
  }
  try {
    return JSON.parse(r.stdout || "null");
  } catch {
    return undefined;
  }
}

let ultimoAviso = { etapa: "", em: 0 };
/** Progresso para o app: na troca de etapa sempre; dentro da etapa, no máximo a cada 20 s (poupa gravações). */
function aviso(etapa: string, mensagem: string, passo?: number, total?: number) {
  const agora = Date.now();
  if (etapa === ultimoAviso.etapa && agora - ultimoAviso.em < 20000 && passo !== total) return;
  ultimoAviso = { etapa, em: agora };
  chamarApp("POST", "/api/coleta/evento", { execucao, inicio: hoje.toISOString(), etapa, mensagem, passo, total, fonte });
}

// ───────────────────────────── anúncios ─────────────────────────────

type Anuncio = {
  id: string;
  criativo: string;
  pagina: string;
  paginaId: string;
  curtidas: number;
  destino: string;
  chave: string;
  inicio: number;
  ativo: boolean;
  versoes: number;
  formato: string;
  texto: string;
  origem: string;
};

const campo = (o: any, ...caminhos: string[]) => {
  for (const c of caminhos) {
    const v = c.split(".").reduce((x: any, k) => (x == null ? undefined : x[k]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const limpar = (s: any) => String(s ?? "").replace(/\s+/g, " ").trim();
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const paraMs = (v: any) => {
  if (v == null || v === "") return 0;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};
const dataBR = (ms: number) => (ms ? new Date(ms).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "");

/** Domínios onde várias ofertas dividem o mesmo endereço: a oferta é o domínio + o 1º trecho do caminho. */
const COMPARTILHADOS = [
  "hotmart.com", "kiwify.com.br", "kiwify.app", "eduzz.com", "monetizze.com.br", "linktr.ee", "beacons.ai",
  "wixsite.com", "sites.google.com", "carrd.co", "hub.la", "ticto.app", "greenn.com.br", "braip.com",
  "cakto.com.br", "perfectpay.com.br", "kirvano.com", "lastlink.com", "pepper.com.br", "payt.com.br",
  "notion.site", "canva.site", "my.canva.site", "blogspot.com", "wordpress.com", "systeme.io",
];
const host = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const temDominio = (h: string, d: string) => h === d || h.endsWith(`.${d}`);
export function chaveOferta(url: string) {
  const h = host(url);
  if (!h) return "";
  if (COMPARTILHADOS.some((d) => temDominio(h, d))) {
    const seg = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname.split("/").filter(Boolean)[0];
    if (seg) return `${h}/${seg.toLowerCase()}`;
  }
  return h;
}
const semRastreio = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
};

// Não são ofertas de infoproduto: conversa, perfil, app, buscador, e-commerce e marketplaces.
const NAO_OFERTA = [
  "whatsapp.com", "wa.me", "instagram.com", "facebook.com", "fb.me", "fb.com", "m.me", "t.me", "telegram.me",
  "apps.apple.com", "itunes.apple.com", "play.google.com", "google.com", "youtube.com", "youtu.be", "tiktok.com",
  "mercadolivre.com.br", "mercadolibre.com", "shopee.com.br", "amazon.com.br", "amazon.com", "magazineluiza.com.br",
  "magalu.com", "americanas.com.br", "casasbahia.com.br", "aliexpress.com", "shein.com", "temu.com", "olx.com.br",
  "ifood.com.br", "booking.com", "airbnb.com", "decolar.com", "skyscanner.com.br",
];

const motivo = (x: Anuncio): string | undefined => {
  const h = host(x.destino);
  if (!h) return "sem link";
  if (NAO_OFERTA.some((d) => temDominio(h, d))) return "não é página de oferta";
  if ((cfg.excluir_dominios ?? []).some((d: string) => temDominio(h, d.toLowerCase()))) return "domínio excluído";
  if ((cfg.excluir_anunciantes ?? []).some((n: string) => sem(x.pagina).includes(sem(n)))) return "anunciante excluído";
  if (x.formato === "dpa" || x.texto.includes("{{product.")) return "anúncio de catálogo";
  if (x.curtidas > (cfg.max_curtidas_pagina ?? 2_000_000)) return "marca grande";
  return undefined;
};

function normalizar(item: any): Anuncio | undefined {
  const id = String(campo(item, "adArchiveID", "adArchiveId", "ad_archive_id", "id") ?? "");
  if (!id) return undefined;
  const s = item.snapshot ?? {};
  const destino = String(campo(s, "linkUrl", "link_url", "cards.0.linkUrl", "cards.0.link_url") ?? "");
  const textoCards = (s.cards ?? []).map((c: any) => campo(c, "body", "title") ?? "").join(" ");
  return {
    id,
    criativo: String(campo(item, "collationId", "collation_id") ?? id),
    pagina: limpar(campo(item, "pageName", "page_name", "snapshot.pageName")),
    paginaId: String(campo(item, "pageID", "pageId", "page_id", "snapshot.pageId") ?? ""),
    curtidas: Number(campo(s, "pageLikeCount", "page_like_count") ?? 0),
    destino,
    chave: chaveOferta(destino),
    inicio: paraMs(campo(item, "startDate", "start_date", "startDateFormatted")),
    ativo: Boolean(campo(item, "isActive", "is_active")),
    versoes: Math.max(1, Number(campo(item, "collationCount", "collation_count") ?? 1)),
    formato: String(campo(s, "displayFormat", "display_format") ?? "").toLowerCase(),
    texto: limpar(campo(s, "body.text", "body.markup.__html", "body") ?? textoCards),
    origem: String(item.inputUrl ?? ""),
  };
}

// ───────────────────────────── Apify ─────────────────────────────

const urlBusca = (termo: string) => {
  const exata = (cfg.tipo_busca ?? "keyword_exact_phrase") === "keyword_exact_phrase";
  const q = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: pais,
    media_type: "all",
    q: exata ? `"${termo}"` : termo,
    search_type: cfg.tipo_busca ?? "keyword_exact_phrase",
  });
  // Mais impressões primeiro: o navegador próprio só recebe os ~30 primeiros, então eles precisam ser os mais fortes.
  return `https://www.facebook.com/ads/library/?${q}&sort_data[mode]=total_impressions&sort_data[direction]=desc`;
};
const urlPagina = (id: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${pais}&media_type=all&search_type=page&view_all_page_id=${id}&sort_data[mode]=total_impressions&sort_data[direction]=desc`;

/** Visita cada endereço com o navegador próprio. Devolve os anúncios (com inputUrl, como o Apify) e os totais. */
async function coletarNavegador(urls: string[], etapa: string, rotulo: (u: string) => string) {
  const bib = new Biblioteca({ tentativas: Number(cfg.tentativas ?? 8), pausa_ms: Number(cfg.pausa_ms ?? 6000) });
  const itens: any[] = [];
  const totais = new Map<string, number>();
  let falhas = 0;
  console.log(`\n[${etapa}] navegador próprio: ${urls.length} endereço(s)...`);
  try {
    for (const [i, url] of urls.entries()) {
      aviso(etapa, `${rotulo(url)} (${i + 1} de ${urls.length})`, i + 1, urls.length);
      const r = await bib.visitar(url);
      for (const x of r.anuncios) itens.push({ ...x, inputUrl: url });
      if (r.total !== undefined) totais.set(url, r.total);
      if (r.erro) falhas++;
      console.log(`  ${String(i + 1).padStart(2)}. ${rotulo(url).padEnd(36)} ${r.erro ? `sem resultado após ${r.tentativas} tentativas` : `${r.anuncios.length} anúncios (total ${r.total ?? "?"}, ${r.tentativas}ª tentativa)`}`);
    }
  } finally {
    await bib.fechar();
  }
  console.log(`[${etapa}] ${itens.length} anúncios; ${falhas} endereço(s) sem resultado.`);
  return { itens, totais, falhas };
}

let custoTotal = 0;
async function rodarActor(urls: string[], limite: number, etapa: string): Promise<any[]> {
  // O token vem de APIFY_TOKEN ou é injetado pelo ambiente nas chamadas a api.apify.com.
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN ?? "injetado-pelo-ambiente" });
  const actor = cfg.actor ?? "apify/facebook-ads-scraper";
  // Teto de gasto por etapa: sem ele, vale o teto padrão da conta no Apify, que pode cortar a coleta no meio.
  const maxItems = urls.length * limite;
  const teto = Number(cfg.apify?.custo_max_por_etapa_usd ?? 8);
  const estimativa = maxItems * Number(cfg.apify?.custo_por_anuncio_usd ?? 0.0055);
  console.log(`\n[${etapa}] ${actor}: ${urls.length} endereço(s), até ${limite} anúncios cada (estimativa: até US$ ${estimativa.toFixed(2)}, teto US$ ${teto.toFixed(2)})...`);
  const run = await client
    .actor(actor)
    .call({ startUrls: urls.map((url) => ({ url })), resultsLimit: limite, ...(cfg.entrada ?? {}) }, { log: null, maxItems, maxTotalChargeUsd: teto });
  if (run.status !== "SUCCEEDED") {
    if (!["ABORTED", "TIMED-OUT"].includes(run.status)) throw new Error(`O Actor terminou com status ${run.status}. Veja o log no painel do Apify (run ${run.id}).`);
    console.log(`[${etapa}] o Actor parou antes do fim (${run.status}: ${run.statusMessage ?? "teto de custo ou tempo"}); seguindo com o que foi coletado.`);
  }
  const items: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const pag = await client.dataset(run.defaultDatasetId).listItems({ offset, limit: 1000 });
    items.push(...pag.items);
    if (pag.items.length < 1000) break;
  }
  const custo = Number(run.usageTotalUsd ?? 0);
  custoTotal += custo;
  console.log(`[${etapa}] ${items.length} anúncios coletados (custo no Apify: US$ ${custo.toFixed(2)}).`);
  return items;
}

// ───────────────────────────── ofertas ─────────────────────────────

type Metricas = {
  ativos: number;
  criativos: number;
  paginas: { id: string; nome: string; anuncios: number }[];
  maisAntigo: number;
  diasNoAr: number;
  novos: number;
  destino: string;
  url: string;
  textos: { texto: string; link: string; versoes: number; inicio: string }[];
};

function medir(ads: Anuncio[]): Metricas {
  const porCriativo = new Map<string, Anuncio>();
  for (const x of ads.filter((x) => x.ativo)) {
    const o = porCriativo.get(x.criativo);
    if (!o || x.versoes > o.versoes || (x.versoes === o.versoes && x.inicio && x.inicio < o.inicio)) porCriativo.set(x.criativo, x);
  }
  const criativos = [...porCriativo.values()];
  const inicios = criativos.map((x) => x.inicio).filter(Boolean);
  const maisAntigo = inicios.length ? Math.min(...inicios) : 0;
  const paginas = new Map<string, { id: string; nome: string; anuncios: number }>();
  for (const x of criativos) {
    const p = paginas.get(x.paginaId) ?? { id: x.paginaId, nome: x.pagina, anuncios: 0 };
    p.anuncios += x.versoes;
    paginas.set(x.paginaId, p);
  }
  const destinos = new Map<string, number>();
  for (const x of criativos) destinos.set(semRastreio(x.destino), (destinos.get(semRastreio(x.destino)) ?? 0) + x.versoes);
  const destinoTop = [...destinos.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? "";
  const urlTop = criativos.find((x) => semRastreio(x.destino) === destinoTop)?.destino ?? "";
  const corteNovo = hoje.getTime() - crit.novos_dias * DIA;
  return {
    ativos: criativos.reduce((s, x) => s + x.versoes, 0),
    criativos: criativos.length,
    paginas: [...paginas.values()].sort((p, q) => q.anuncios - p.anuncios),
    maisAntigo,
    diasNoAr: maisAntigo ? Math.floor((hoje.getTime() - maisAntigo) / DIA) : 0,
    novos: criativos.filter((x) => x.inicio >= corteNovo).length,
    destino: destinoTop,
    url: urlTop,
    textos: criativos
      .filter((x) => x.texto)
      .sort((p, q) => q.versoes - p.versoes || p.inicio - q.inicio)
      .slice(0, 3)
      .map((x) => ({ texto: x.texto.slice(0, 220), link: `https://www.facebook.com/ads/library/?id=${x.id}`, versoes: x.versoes, inicio: dataBR(x.inicio) })),
  };
}

const agrupar = (ads: Anuncio[]) => {
  const m = new Map<string, Anuncio[]>();
  for (const x of ads) {
    if (!x.chave) continue;
    const l = m.get(x.chave) ?? [];
    if (!l.some((y) => y.id === x.id)) l.push(x);
    m.set(x.chave, l);
  }
  return m;
};

/** Nota da descoberta: serve só para escolher quais ofertas verificar e aprofundar. */
const notaDescoberta = (m: Metricas) =>
  m.ativos * 2 + m.paginas.length * 3 + m.novos * 2 + (m.diasNoAr >= crit.min_dias ? 6 : 0) + Math.min(m.diasNoAr, 120) / 20;

// ───────────────────────────── preço ─────────────────────────────

const CHECKOUTS: [string, string][] = [
  ["hotmart.com", "Hotmart"], ["kiwify.com.br", "Kiwify"], ["kiwify.app", "Kiwify"], ["eduzz.com", "Eduzz"],
  ["monetizze.com.br", "Monetizze"], ["perfectpay.com.br", "PerfectPay"], ["ticto.app", "Ticto"], ["ticto.com.br", "Ticto"],
  ["greenn.com.br", "Greenn"], ["braip.com", "Braip"], ["cakto.com.br", "Cakto"], ["lastlink.com", "Lastlink"], ["hub.la", "Hubla"],
  ["pepper.com.br", "Pepper"], ["payt.com.br", "Payt"], ["kirvano.com", "Kirvano"], ["doppus.com", "Doppus"], ["yampi.com.br", "Yampi"],
  ["appmax.com.br", "Appmax"], ["wiapy.com", "Wiapy"], ["assiny.com.br", "Assiny"], ["zouti.com.br", "Zouti"], ["checkout.stripe.com", "Stripe"], ["mercadopago.com.br", "Mercado Pago"], ["pagar.me", "Pagar.me"], ["disrupty.com.br", "Disrupty"], ["luna.checkout", "Luna"], ["digitalmanager.guru", "Guru"], ["pagtrust.com.br", "PagTrust"], ["vega.app", "Vega"],
];
const plataformaDe = (url: string) => CHECKOUTS.find(([d]) => temDominio(host(url), d))?.[1];

/** Preços em reais num texto, sem os valores de parcela ("12x de R$ 2,47"). */
export function precos(texto: string) {
  const out: { valor: number; destaque: boolean }[] = [];
  const re = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const antes = sem(texto.slice(Math.max(0, m.index - 30), m.index));
    if (/\d+\s*x\s*(de\s*)?$/.test(antes) || /parcela|mensais|\/mes|por mes/.test(sem(texto.slice(m.index, m.index + 25)))) continue;
    const valor = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(valor) || valor < 5 || valor > 20000) continue;
    out.push({ valor, destaque: /\b(por|apenas|so|hoje|somente|investimento|valor)\b\W*(de\W*)?$/.test(antes) });
  }
  return out;
}
/** O preço de venda provável: o menor valor anunciado "por/apenas/hoje"; sem isso, o menor valor da página. */
const precoProvavel = (texto: string) => {
  const p = precos(texto);
  if (!p.length) return undefined;
  const d = p.filter((x) => x.destaque);
  return Math.min(...(d.length ? d : p).map((x) => x.valor));
};

/** Onde começam os order bumps num checkout: daí para baixo, os preços são de produtos adicionais, não do front. */
const BUMP =
  /(also buy|adicionar (produto|ao pedido|oferta|[àa] compra)|adicione (tamb[ée]m|ao pedido|[àa] sua compra)|aproveite (tamb[ée]m|e leve|esta oferta)|leve (tamb[ée]m|junto)|compre (tamb[ée]m|junto)|sim,? ?(eu )?quero (adicionar|levar|aproveitar)|oferta (especial|exclusiva|[úu]nica)|order ?bump|turbine (seu|sua)|[ée] agora ou nunca|s[óo] nesta p[áa]gina|voc[êe] tamb[ée]m pode)/i;

/**
 * Preço do produto principal (front) num checkout. Primeiro os sinais que só o front tem e que ficam no topo
 * ("R$ 297,00 à vista", "1x de R$ 297,00", "Total R$ ..."); sem eles, o preço em destaque ANTES do 1º bloco de
 * order bump. Sem nada confiável, devolve undefined e quem chama usa a página de vendas.
 */
export function precoCheckout(texto: string): number | undefined {
  const num = (x: string) => Number(x.replace(/\./g, "").replace(",", "."));
  const valido = (v: number) => Number.isFinite(v) && v >= 5 && v <= 20000;
  const corte = texto.search(BUMP);
  const valor = "R\\$\\s*(\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?)";
  const achar = (re: RegExp, limite = Infinity) => {
    const m = re.exec(texto);
    return m && m.index < limite && valido(num(m[1])) ? num(m[1]) : undefined;
  };
  // "R$ 297,00 à vista" e "Total R$ 14,99" são do pedido sem bumps (bumps vêm desmarcados): valem em qualquer lugar.
  // O "à vista" vem antes: o total pode somar frete.
  // "1x de R$ ..." e o 1º preço da página só valem antes do 1º bloco de bump (cada bump pode ter os seus).
  const limite = corte < 0 ? Infinity : corte;
  const primeiro = (() => {
    const re = new RegExp(valor, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) && m.index < limite) {
      const antes = sem(texto.slice(Math.max(0, m.index - 14), m.index));
      if (/\d\s*x\s*(de\s*)?$/.test(antes) || /\bde\s*$/.test(antes)) continue; // parcela ou preço riscado ("de R$ 97")
      if (valido(num(m[1]))) return num(m[1]);
    }
    return undefined;
  })();
  return (
    achar(new RegExp(`${valor}\\s*(?:[àa]\\s*vista)`, "i")) ??
    achar(new RegExp(`[àa]\\s*vista\\s*(?:por\\s*)?${valor}`, "i")) ??
    achar(new RegExp(`\\btotal\\b[^R\\d]{0,20}${valor}`, "i")) ??
    achar(new RegExp(`\\b1\\s*x\\s*(?:de\\s*)?${valor}`, "i"), limite) ??
    primeiro
  );
}


type Bump = { nome: string; preco?: number };
type Verificacao = {
  titulo?: string;
  preco?: number;
  fonte?: string;
  precos_pagina: number[];
  precos_checkout: number[];
  bumps: Bump[];
  /** O nome completo foi preenchido ("Kaike") para revelar order bumps que só aparecem depois disso. */
  preenchido?: boolean;
  /** O checkout mostrou valores em outra moeda (alguns convertem pelo país do IP). */
  moeda?: string;
  plataforma?: string;
  checkout?: string;
  erro?: string;
};

/** Checkout de plataforma conhecida, ou de domínio próprio com cara de checkout (checkout.*, pay.*, /checkout). */
const ehCheckout = (url: string) => {
  if (plataformaDe(url)) return true;
  try {
    const u = new URL(url);
    return /^(checkout|pay|pagamento|seguro|secure|compra|comprar)\./i.test(u.hostname) || /\/(checkout|carrinho|cart)(\/|$)/i.test(u.pathname);
  } catch {
    return false;
  }
};

/** Botões que levam ao checkout ("Quero comprar", "Garantir minha vaga"...). */
const BOTAO_COMPRA = /(comprar|compre|quero|garant|adquir|acessar agora|acesso imediato|sim,? eu|matricul|inscrev|come[çc]ar agora|pegar|baixar agora|liberar|aproveitar|finalizar)/i;
/** Nome completo no checkout. E-mail, telefone e documento nunca são tocados. */
const CAMPO_NOME = [
  'input[autocomplete="name"]',
  'input[name="name" i]',
  'input[name*="nome" i]',
  'input[name*="fullname" i]',
  'input[name*="full_name" i]',
  'input[id*="nome" i]',
  'input[id="name" i]',
  'input[placeholder*="nome" i]',
  'input[placeholder*="name" i]',
  'input[aria-label*="nome" i]',
];
const NOME_TESTE = "Kaike";

let navegador: any;
async function iniciarNavegador() {
  if (navegador === undefined) {
    try {
      // Playwright é opcional. Instale com: npm i -D playwright && npx playwright install chromium
      navegador = await require("playwright").chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    } catch {
      navegador = null;
      console.log("  (Playwright indisponível: lendo o HTML sem executar scripts; sem clique no botão de compra nem order bumps revelados)");
    }
  }
  return navegador;
}
const novaAba = async () => {
  const ctx = await navegador.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    extraHTTPHeaders: { "Accept-Language": "pt-BR,pt;q=0.9" },
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
  });
  return { ctx, p: await ctx.newPage() };
};
const rolar = (p: any) =>
  p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 1200) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
const textoDe = (p: any): Promise<string> => p.evaluate(() => document.body?.innerText ?? "");
const linksDe = (p: any): Promise<string[]> => p.evaluate(() => [...document.querySelectorAll("a[href]")].map((e) => (e as HTMLAnchorElement).href));

/** Sem navegador: curl respeita o HTTPS_PROXY (o fetch do Node não). */
function baixarHTML(url: string) {
  const r = spawnSync("curl", ["-sfL", "--max-time", "30", "-A", "Mozilla/5.0", url], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`não abriu (curl ${r.status})`);
  const html = r.stdout;
  return {
    titulo: limpar(html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? ""),
    links: [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]),
    texto: html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "),
  };
}

/** Página de vendas: título, valores citados e o endereço do checkout (pelo link ou clicando no botão de compra). */
export async function lerVendas(url: string): Promise<{ titulo: string; texto: string; checkout?: string }> {
  if (!(await iniciarNavegador())) {
    const h = baixarHTML(url);
    return { titulo: h.titulo, texto: h.texto, checkout: ehCheckout(url) ? url : h.links.find(ehCheckout) };
  }
  const { ctx, p } = await novaAba();
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForTimeout(2500);
    await rolar(p);
    await p.waitForTimeout(800);
    const titulo = await p.title();
    const texto = await textoDe(p);
    if (ehCheckout(p.url())) return { titulo, texto, checkout: p.url() };
    let checkout = (await linksDe(p)).find(ehCheckout);
    // Sem link direto: clica no botão de compra e vê onde vai parar (mesma aba, aba nova ou link revelado).
    if (!checkout) {
      const botoes = p.locator("a, button, [role=button], input[type=submit]").filter({ hasText: BOTAO_COMPRA });
      const n = Math.min(await botoes.count(), 4);
      for (let i = 0; i < n && !checkout; i++) {
        const b = botoes.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        const aba = ctx.waitForEvent("page", { timeout: 6000 }).catch(() => null);
        await b.click({ timeout: 4000 }).catch(() => {});
        const nova = await aba;
        if (nova) {
          await nova.waitForLoadState("domcontentloaded").catch(() => {});
          if (ehCheckout(nova.url())) checkout = nova.url();
          await nova.close().catch(() => {});
        }
        await p.waitForTimeout(2500);
        if (!checkout && ehCheckout(p.url())) checkout = p.url();
        if (!checkout) checkout = (await linksDe(p)).find(ehCheckout);
        if (!checkout && p.url() !== url) await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      }
    }
    return { titulo, texto, checkout };
  } finally {
    await ctx.close();
  }
}

/** Blocos de order bump (caixa de marcar + preço) e o texto do checkout sem eles. */
async function blocosDoCheckout(p: any): Promise<{ bumps: string[]; resto: string }> {
  return p.evaluate(() => {
    const termos = /(termos|pol[íi]tica|privacidade|li e aceito|concordo|aceito receber|lembrar|salvar (meus )?dados|dois cart[õo]es|cupom|autor\b)/i;
    const preco = /(R\$|US\$|\$|€)\s?\d/;
    const acao = /(adicionar|add to (purchase|order|cart)|adicione|sim,? ?(eu )?quero|quero (aproveitar|adicionar|levar)|incluir|also buy)/i;
    const caixas = [
      ...document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]'),
      ...[...document.querySelectorAll('button, a, [role="button"], label')].filter((e) => {
        const t = (e as HTMLElement).innerText || "";
        return acao.test(t) && !/(cupom|coupon|cart[ãa]o|card|endere[çc]o)/i.test(t);
      }),
    ];
    const blocos: HTMLElement[] = [];
    // Só o que está visível: bump escondido ainda não foi oferecido (alguns só aparecem depois de preencher o nome).
    // (sem função nomeada aqui dentro: o tsx injeta um helper __name que não existe na página)
    for (const c of caixas) {
      if (!((c as HTMLElement).getClientRects().length > 0 && getComputedStyle(c).visibility !== "hidden")) continue;
      let el = c.parentElement;
      for (let i = 0; i < 8 && el && el !== document.body; i++, el = el.parentElement) {
        // Bloco que já engloba campos do formulário ou o resumo do pedido não é um bump: desiste deste candidato.
        if (el.querySelector('input[type="email"], input[type="tel"], input[type="password"], input[name*="mail" i], input[name*="cpf" i]')) break;
        const t = el.innerText || "";
        if (/(detalhes da compra|resumo (do pedido|da compra)|order (details|summary)|^\s*total\b)/i.test(t)) break;
        // Só parcela ("12x de R$ 2,05") ainda não é o bloco inteiro do bump: sobe até achar o preço.
        if (!preco.test(t.replace(/\d+\s*x\s*(de|of)?\s*(R\$|US\$|\$)\s?[\d.,]+\*?/gi, ""))) continue;
        if (t.length < 900 && !termos.test(t.slice(0, 160)) && !blocos.some((b) => b.contains(el!) || el!.contains(b))) blocos.push(el);
        break;
      }
    }
    const textos = blocos.map((b) => b.innerText);
    const antes = blocos.map((b) => b.style.display);
    blocos.forEach((b) => (b.style.display = "none"));
    const resto = document.body.innerText;
    blocos.forEach((b, i) => (b.style.display = antes[i]));
    return { bumps: textos, resto };
  });
}

/** Nome e preço de um order bump a partir do texto do seu bloco. */
function lerBump(texto: string): Bump {
  const linhas = texto.split(/\n+/).map((l) => limpar(l)).filter(Boolean);
  const generica = /^(sim|adicionar|adicione|add to|also buy|aproveite|leve|compre|oferta|com desconto|[ée] agora|s[óo] hoje|selecionar|quero|incluir|\d+%|r\$|us\$|\$|de r\$|por r\$|\d+\s*x)/i;
  const campo = /^(n[úu]mero|nome|cpf|cnpj|e-?mail|confirm|telefone|celular|cart[ãa]o|validade|cvv|c[óo]digo|card|expiration|security|detalhes|resumo|total|finalizar|salvar|parcelas|pagamento)/i;
  const nome = linhas.find((l) => l.length >= 4 && !campo.test(l) && l.length <= 140 && !/R\$\s*\d/.test(l) && !generica.test(l)) ?? linhas[0] ?? "";
  return { nome: nome.replace(/[\s:–—-]+$/, "").slice(0, 140), preco: precoProvavel(texto) };
}

/** Bumps pelo texto, quando o checkout não usa caixas de marcar: preço de cada trecho depois do marcador de bump. */
function bumpsPeloTexto(texto: string): Bump[] {
  const corte = texto.search(BUMP);
  if (corte < 0) return [];
  // O resumo do pedido e o botão de pagamento encerram a área de bumps.
  let area = texto.slice(corte);
  const fim = area.search(/(detalhes da compra|resumo (do pedido|da compra)|order (details|summary)|finalizar (pagamento|compra)|comprar agora|buy now|salvar dados|existem campos inv[áa]lidos)/i);
  if (fim > 0) area = area.slice(0, fim);
  const partes = area.split(BUMP).filter((t) => t && /R\$\s*\d/.test(t) && !BUMP.test(t));
  return partes.slice(0, 6).map(lerBump).filter((b) => b.preco !== undefined);
}

/** O front aparece em outra moeda? (bumps às vezes ficam em reais enquanto o produto principal vem em dólar) */
const semReais = async (p: any) => {
  const t = await textoDe(p);
  return !/R\$\s*\d/.test(t) || /(US\$|\$)\s?\d/.test(t.replace(/R\$/g, ""));
};

/** Escolhe "Brasil" no seletor de país do checkout (Hotmart, Eduzz, Greenn e outros que usam o país do IP). */
async function trocarParaBrasil(p: any) {
  const seletor = p
    .locator('#country-select, #selectCountryInter, select[id*="country" i], select[name*="country" i], [id*="country" i]:is(button, [role=button], [role=combobox]), button:has-text("Change country"), button:has-text("Alterar país"), :text-is("Change country")')
    .first();
  if (!(await seletor.count())) return false;
  const tag = await seletor.evaluate((e: Element) => e.tagName).catch(() => "");
  if (tag === "SELECT") {
    for (const op of [{ label: "Brazil" }, { label: "Brasil" }, { value: "BR" }, { value: "br" }]) {
      if (await seletor.selectOption(op, { timeout: 3000 }).then(() => true, () => false)) break;
    }
  } else {
    await seletor.click({ timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const busca = p.locator('input[type="search"], input[placeholder*="country" i], input[placeholder*="país" i], input[placeholder*="pais" i]').first();
    if (await busca.count()) await busca.fill("Bra").catch(() => {});
    await p.waitForTimeout(600);
    await p.getByText(/^\s*(🇧🇷\s*)?(Brazil|Brasil)\b/).first().click({ timeout: 4000 }).catch(async () => {
      await p.getByText(/Bra[sz]il/).first().click({ timeout: 3000 }).catch(() => {});
    });
  }
  await p.waitForTimeout(4500);
  return true;
}

export async function lerCheckout(url: string): Promise<Pick<Verificacao, "preco" | "precos_checkout" | "bumps" | "preenchido" | "moeda">> {
  if (!(await iniciarNavegador())) {
    const t = baixarHTML(url).texto;
    return { preco: precoCheckout(t), precos_checkout: [...new Set(precos(t).map((x) => x.valor))].sort((a, b) => a - b), bumps: bumpsPeloTexto(t) };
  }
  const { ctx, p } = await novaAba();
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForTimeout(4000);
    // Verificação anti-robô (Cloudflare e afins): espera ela liberar a página.
    for (let i = 0; i < 6 && /(verifica[çc][ãa]o de seguran[çc]a|just a moment|checking your browser|verify you are human)/i.test(await textoDe(p)); i++) await p.waitForTimeout(4000);
    // O checkout escolhe país e moeda pelo IP (servidores nos EUA veem dólar): troca para o Brasil quando há seletor.
    if (await semReais(p)) await trocarParaBrasil(p);
    await rolar(p);
    let { bumps, resto } = await blocosDoCheckout(p);
    let preenchido = false;
    // Alguns order bumps só aparecem depois que um campo é preenchido: o nome completo recebe "Kaike".
    // Nada é enviado: o radar não clica em comprar nem preenche e-mail, telefone, documento ou cartão.
    if (!bumps.length && !bumpsPeloTexto(resto).length) {
      for (const sel of CAMPO_NOME) {
        const campo = p.locator(sel).first();
        if (!(await campo.count()) || !(await campo.isVisible().catch(() => false))) continue;
        const tipo = ((await campo.getAttribute("type")) ?? "text").toLowerCase();
        if (["email", "tel", "hidden", "password", "number"].includes(tipo)) continue;
        await campo.fill(NOME_TESTE, { timeout: 4000 }).catch(() => {});
        await campo.press("Tab").catch(() => {});
        preenchido = true;
        await p.waitForTimeout(3500);
        await rolar(p);
        ({ bumps, resto } = await blocosDoCheckout(p));
        break;
      }
    }
    // Os blocos achados pela página saem do "resto"; o que sobrou com cara de bump é lido pelo texto.
    const lista = [...bumps.map(lerBump), ...bumpsPeloTexto(resto)].filter((b) => b.preco !== undefined);
    if (process.env.RADAR_DEBUG) console.log(JSON.stringify({ url: p.url(), blocos: bumps, resto: resto.replace(/\s+/g, " ").slice(0, 1500) }, null, 1));
    const tudo = await textoDe(p);
    const moeda = /R\$\s*\d/.test(tudo) ? undefined : /US\$\s*\d|\$\s?\d/.test(tudo) ? "USD" : /€\s?\d/.test(tudo) ? "EUR" : undefined;
    return {
      preco: precoCheckout(resto),
      precos_checkout: [...new Set(precos(tudo).map((x) => x.valor))].sort((a, b) => a - b).slice(0, 15),
      bumps: [...new Map(lista.filter((b) => b.nome || b.preco).map((b) => [`${b.nome}|${b.preco}`, b])).values()],
      preenchido,
      moeda,
    };
  } finally {
    await ctx.close();
  }
}

/**
 * O preço registrado é o do CHECKOUT (o front, sem os order bumps). Criativo e legenda não contam.
 * Sem checkout encontrado, o preço fica vazio, a não ser que "preco_da_pagina_sem_checkout" esteja ligado.
 */
async function verificar(destino: string): Promise<Verificacao> {
  const v: Verificacao = { precos_pagina: [], precos_checkout: [], bumps: [] };
  try {
    const pg = await lerVendas(destino);
    v.titulo = limpar(pg.titulo).slice(0, 120);
    v.precos_pagina = [...new Set(precos(pg.texto).map((x) => x.valor))].sort((p, q) => p - q).slice(0, 12);
    if (pg.checkout) {
      v.checkout = pg.checkout;
      v.plataforma = plataformaDe(pg.checkout) ?? "própria";
      const ck = await lerCheckout(pg.checkout);
      Object.assign(v, ck);
      if (v.preco !== undefined) v.fonte = "checkout";
    }
    if (v.preco === undefined && cfg.preco_da_pagina_sem_checkout) {
      const p = precoProvavel(pg.texto);
      if (p !== undefined) [v.preco, v.fonte] = [p, "página"];
    }
  } catch (e: any) {
    v.erro = String(e?.message ?? e).split("\n")[0].slice(0, 120);
  }
  return v;
}

// ───────────────────────────── critérios ─────────────────────────────

type Oferta = {
  chave: string;
  status: "escalada" | "quase" | "fora";
  falhas: string[];
  aprofundada: boolean;
  limitada: boolean;
  estimado?: boolean;
  metricas: Metricas;
  descoberta: { ativos: number; nota: number; termos: string[] };
  verificacao?: Verificacao;
  preco?: number;
  anterior?: number;
};

function avaliar(o: Oferta) {
  const m = o.metricas;
  const c: [boolean | null, string][] = [
    [naFaixa(o.preco), o.preco === undefined ? (o.verificacao && !o.verificacao.checkout ? "checkout não encontrado" : "preço do checkout não encontrado") : `preço R$ ${o.preco} fora da faixa de R$ ${crit.preco_min} a R$ ${crit.preco_max}`],
    [m.ativos >= crit.min_ativos, `${m.ativos} anúncios ativos (mínimo ${crit.min_ativos})`],
    [m.diasNoAr >= crit.min_dias, `criativo mais antigo com ${m.diasNoAr} dias (mínimo ${crit.min_dias})`],
    [m.novos >= crit.min_novos, `${m.novos} criativo(s) novo(s) em ${crit.novos_dias} dias (mínimo ${crit.min_novos})`],
    [o.anterior === undefined ? null : m.ativos >= o.anterior * (1 - crit.queda_max), `caiu de ${o.anterior} para ${m.ativos} anúncios ativos`],
  ];
  o.falhas = c.filter(([ok]) => ok === false).map(([, f]) => f);
  o.status = o.falhas.length === 0 ? "escalada" : o.falhas.length === 1 ? "quase" : "fora";
}

// ───────────────────────────── relatório ─────────────────────────────

const tendencia = (o: Oferta) => {
  if (o.anterior === undefined) return "1ª coleta";
  const d = o.metricas.ativos - o.anterior;
  return d === 0 ? "estável" : `${d > 0 ? "+" : ""}${d} (antes ${o.anterior})`;
};
const brl = (v?: number) => (v === undefined ? "?" : `R$ ${v.toFixed(2).replace(".", ",")}`);

function blocoOferta(o: Oferta) {
  const m = o.metricas;
  const v = o.verificacao;
  const ativos = `${o.estimado ? "≈" : ""}${m.ativos}${o.limitada ? "+" : ""}${o.aprofundada ? "" : " (só na busca)"}`;
  const linhas = [
    `### ${o.chave}${v?.titulo ? ` — ${v.titulo}` : ""}`,
    "",
    `| Preço | Checkout | Anúncios ativos | Criativos | Mais antigo | Novos (${crit.novos_dias} d) | Tendência |`,
    "|---|---|---|---|---|---|---|",
    `| ${brl(o.preco)}${o.verificacao?.fonte ? ` (${o.verificacao.fonte})` : ""} | ${v?.plataforma ?? "?"} | ${ativos} | ${m.criativos} | ${m.diasNoAr} dias (${dataBR(m.maisAntigo)}) | ${m.novos} | ${tendencia(o)} |`,
    "",
    `- Página: https://${m.destino}`,
    `- Anunciantes: ${m.paginas.slice(0, 5).map((p) => `[${p.nome || p.id}](${urlPagina(p.id)}) (${p.anuncios})`).join(", ")}${m.paginas.length > 5 ? ` e mais ${m.paginas.length - 5}` : ""}`,
  ];
  if (v?.checkout) linhas.push(`- Checkout: ${v.checkout}`);
  if (v?.bumps.length) linhas.push(`- Order bumps${v.preenchido ? " (apareceram depois de preencher o nome)" : ""}: ${v.bumps.map((b) => `${b.nome || "sem nome"} (${brl(b.preco)})`).join("; ")}`);
  else if (v?.checkout) linhas.push(`- Order bumps: nenhum${v.preenchido ? " (nem depois de preencher o nome)" : ""}`);
  if (v?.precos_checkout.length) linhas.push(`- Valores no checkout: ${v.precos_checkout.map((p) => brl(p)).join(", ")}`);
  if (v?.precos_pagina.length) linhas.push(`- Valores na página de vendas: ${v.precos_pagina.map((p) => brl(p)).join(", ")}`);
  if (o.falhas.length) linhas.push(`- Falta: ${o.falhas.join("; ")}`);
  if (m.textos.length) {
    linhas.push("- Criativos mais duplicados:");
    for (const t of m.textos) linhas.push(`  - [${t.versoes}× desde ${t.inicio}](${t.link}) ${t.texto}`);
  }
  return linhas.join("\n");
}

function relatorio(ofertas: Oferta[], resumo: string[]) {
  const ordem = (l: Oferta[]) => l.sort((p, q) => q.metricas.ativos - p.metricas.ativos);
  const esc = ordem(ofertas.filter((o) => o.status === "escalada"));
  const quase = ordem(ofertas.filter((o) => o.status === "quase"));
  const md = [
    `# Radar de ofertas low ticket — ${hoje.toLocaleDateString("pt-BR")}`,
    "",
    `Critérios: preço de ${brl(crit.preco_min)} a ${brl(crit.preco_max)} · ${crit.min_ativos}+ anúncios ativos · criativo no ar há ${crit.min_dias}+ dias · ${crit.min_novos}+ criativo novo em ${crit.novos_dias} dias · sem queda de mais de ${Math.round(crit.queda_max * 100)}% desde a coleta anterior.`,
    "",
    ...resumo.map((r) => `- ${r}`),
    "",
    `## Escaladas (${esc.length})`,
    "",
  ];
  md.push(...esc.map((o) => blocoOferta(o) + "\n"));
  if (!esc.length) md.push("Nenhuma oferta cumpriu todos os critérios nesta coleta.", "");
  md.push(`## Quase lá: falta um critério (${quase.length})`, "");
  for (const o of quase) md.push(blocoOferta(o), "");
  return md.join("\n");
}

// ───────────────────────────── principal ─────────────────────────────

async function main() {
  const pastaColetas = path.join(pastaDados, "coletas");
  const pastaHist = path.join(pastaDados, "historico");

  const termoDe = (url: string) => {
    const q = new URL(url || "https://x").searchParams.get("q") ?? "";
    return q.replace(/^"|"$/g, "");
  };

  // 1. Descoberta
  const termos: string[] = a.termos ? a.termos.split(",").map((t) => t.trim()).filter(Boolean) : cfg.termos;
  aviso("descoberta", `Começando: ${termos.length} buscas na Biblioteca de Anúncios`, 0, termos.length);
  let falhasBusca = 0;
  let brutos: any[];
  if (a["de-arquivo"]) brutos = lerJSON(path.resolve(a["de-arquivo"]));
  else if (fonte === "apify") brutos = await rodarActor(termos.map(urlBusca), Number(a.limite ?? cfg.apify?.limite_por_termo ?? 50), "1/3 descoberta");
  else {
    const r = await coletarNavegador(termos.map(urlBusca), "descoberta", (u) => `busca "${termoDe(u)}"`);
    brutos = r.itens;
    falhasBusca = r.falhas;
  }
  if (!a["de-arquivo"]) salvarJSON(path.join(pastaColetas, `${diaHoje}.busca.json`), brutos);

  const descartes = new Map<string, number>();
  const validos: Anuncio[] = [];
  for (const b of brutos) {
    const x = normalizar(b);
    if (!x) continue;
    const mot = motivo(x);
    if (mot) descartes.set(mot, (descartes.get(mot) ?? 0) + 1);
    else validos.push(x);
  }
  const grupos = agrupar(validos);
  let ofertas: Oferta[] = [...grupos.entries()].map(([chave, ads]) => {
    const m = medir(ads);
    return {
      chave,
      status: "fora",
      falhas: [],
      aprofundada: false,
      limitada: false,
      metricas: m,
      descoberta: { ativos: m.ativos, nota: notaDescoberta(m), termos: [...new Set(ads.map((x) => termoDe(x.origem)).filter(Boolean))] },
    } as Oferta;
  });
  ofertas.sort((p, q) => q.descoberta.nota - p.descoberta.nota);
  console.log(`${validos.length} anúncios de oferta em ${ofertas.length} ofertas. Descartados: ${[...descartes].map(([k, v]) => `${v} ${k}`).join(", ") || "nenhum"}.`);

  // 2. Preço das ofertas mais fortes
  const nVerificar = Number(a["verificar"] ?? cfg.verificar_paginas ?? 40);
  if (!a["sem-verificar"]) {
    const alvo = ofertas.slice(0, nVerificar);
    console.log(`\n[2/3 preço] abrindo a página de ${alvo.length} oferta(s)...`);
    for (const [i, o] of alvo.entries()) {
      aviso("preco", `Lendo o preço de ${o.chave} (${i + 1} de ${alvo.length})`, i + 1, alvo.length);
      o.verificacao = await verificar(o.metricas.url || `https://${o.metricas.destino}`);
      o.preco = o.verificacao.preco;
      const v = o.verificacao;
      const extra = [v.plataforma, v.bumps.length ? `${v.bumps.length} bump(s): ${v.bumps.map((b) => brl(b.preco)).join(", ")}` : "", v.preenchido ? "nome preenchido" : "", v.moeda ? `moeda ${v.moeda}` : "", !v.checkout ? "checkout não encontrado" : ""].filter(Boolean).join(" · ");
      console.log(`  ${String(i + 1).padStart(2)}. ${o.chave.padEnd(40)} ${v.erro ? `erro: ${v.erro}` : `${brl(o.preco).padEnd(10)} ${extra}`}`);
    }
    if (navegador) await navegador.close();
  }

  // 3. Aprofundamento: todos os anúncios ativos das páginas que anunciam as ofertas low ticket
  const nAprofundar = Number(a.aprofundar ?? cfg.aprofundar ?? 12);
  const alvos = ofertas.filter((o) => naFaixa(o.preco)).slice(0, nAprofundar);
  if (!a["sem-aprofundar"] && alvos.length) {
    const limitePag = Number(cfg.apify?.limite_por_pagina ?? 60);
    const idsPag = [...new Set(alvos.flatMap((o) => o.metricas.paginas.slice(0, cfg.paginas_por_oferta ?? 2).map((p) => p.id)).filter(Boolean))];
    let brutosPag: any[] = [];
    // Total de anúncios ativos de cada página (só o navegador próprio lê; o Apify só traz o que coletou).
    const totalPagina = new Map<string, number>();
    try {
      if (a["paginas-de-arquivo"]) brutosPag = lerJSON(path.resolve(a["paginas-de-arquivo"]));
      else if (fonte === "apify") brutosPag = await rodarActor(idsPag.map(urlPagina), limitePag, "3/3 aprofundamento");
      else {
        const nome = new Map(alvos.flatMap((o) => o.metricas.paginas.map((p) => [p.id, p.nome] as const)));
        const r = await coletarNavegador(idsPag.map(urlPagina), "aprofundamento", (u) => `página ${nome.get(new URL(u).searchParams.get("view_all_page_id") ?? "") ?? ""}`.slice(0, 36));
        brutosPag = r.itens;
        for (const [u, t] of r.totais) totalPagina.set(new URL(u).searchParams.get("view_all_page_id") ?? "", t);
      }
    } catch (e: any) {
      // Sem aprofundamento o relatório sai do mesmo jeito, com o volume da busca (um piso, não o total).
      console.log(`[3/3 aprofundamento] falhou: ${String(e?.message ?? e).split("\n")[0]}`);
    }
    if (!a["paginas-de-arquivo"] && brutosPag.length) salvarJSON(path.join(pastaColetas, `${diaHoje}.paginas.json`), brutosPag);
    const porPagina = new Map<string, number>();
    const dasPaginas: Anuncio[] = [];
    for (const b of brutosPag) {
      const x = normalizar(b);
      if (!x) continue;
      porPagina.set(x.paginaId, (porPagina.get(x.paginaId) ?? 0) + 1);
      dasPaginas.push(x);
    }
    const gruposPag = agrupar(dasPaginas);
    for (const o of alvos) {
      const ids = new Set(o.metricas.paginas.slice(0, cfg.paginas_por_oferta ?? 2).map((p) => p.id));
      if (![...ids].some((id) => porPagina.has(id))) continue;
      const todos = [...(grupos.get(o.chave) ?? []), ...(gruposPag.get(o.chave) ?? [])];
      const unicos = [...new Map(todos.map((x) => [x.id, x])).values()];
      o.metricas = medir(unicos);
      o.aprofundada = true;
      o.limitada = fonte === "apify" && [...ids].some((id) => (porPagina.get(id) ?? 0) >= limitePag);
      // Navegador próprio: a amostra da página (os ~30 de mais impressões) diz que fração leva à oferta;
      // o total da página vezes essa fração estima os anúncios ativos da oferta.
      let estimado = 0;
      for (const id of ids) {
        const total = totalPagina.get(id);
        const amostra = dasPaginas.filter((x) => x.paginaId === id && x.ativo);
        if (total === undefined || !amostra.length) continue;
        const daOferta = amostra.filter((x) => x.chave === o.chave).length;
        estimado += Math.round((total * daOferta) / amostra.length);
      }
      if (estimado > o.metricas.ativos) [o.metricas.ativos, o.estimado] = [estimado, true];
    }
  }

  // 4. Histórico e critérios
  const anteriores = fs.existsSync(pastaHist) ? fs.readdirSync(pastaHist).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${diaHoje}.json`).sort() : [];
  // Com o app, o histórico vem dele (cada execução no GitHub Actions começa com a pasta vazia).
  const remoto = API ? chamarApp("GET", "/api/historico") : undefined;
  const ant: Record<string, { ativos: number; preco?: number }> =
    remoto?.historico ?? (anteriores.length ? lerJSON(path.join(pastaHist, anteriores[anteriores.length - 1])) : {});
  const dataAnterior: string | undefined = remoto?.data ?? (anteriores.length ? anteriores[anteriores.length - 1].slice(0, 10) : undefined);
  for (const o of ofertas) {
    if (ant[o.chave] && o.aprofundada) o.anterior = ant[o.chave].ativos;
    avaliar(o);
  }
  const hist: Record<string, { ativos: number; preco?: number }> = { ...ant };
  for (const o of ofertas) if (o.aprofundada) hist[o.chave] = { ativos: o.metricas.ativos, preco: o.preco };
  salvarJSON(path.join(pastaHist, `${diaHoje}.json`), hist);

  const esc = ofertas.filter((o) => o.status === "escalada").length;
  const quase = ofertas.filter((o) => o.status === "quase").length;
  const resumo = [
    `${a["de-arquivo"] ? "Coleta reaproveitada" : `${termos.length} buscas`}, ${brutos.length} anúncios, ${validos.length} de oferta, ${ofertas.length} ofertas distintas.`,
    `${ofertas.filter((o) => o.verificacao).length} páginas abertas, ${ofertas.filter((o) => o.verificacao?.checkout).length} checkouts lidos, ${ofertas.filter((o) => o.verificacao?.bumps.length).length} com order bump, ${ofertas.filter((o) => naFaixa(o.preco)).length} ofertas low ticket, ${ofertas.filter((o) => o.aprofundada).length} aprofundadas.`,
    `Resultado: **${esc} escalada(s)** e ${quase} quase lá.`,
    dataAnterior ? `Tendência comparada com a coleta de ${dataAnterior}.` : "Primeira coleta: a tendência aparece a partir da próxima.",
    fonte === "apify" ? `Custo no Apify desta execução: US$ ${custoTotal.toFixed(2)}.` : `Fonte: navegador próprio (sem custo)${falhasBusca ? `; ${falhasBusca} busca(s) sem resultado` : ""}.`,
  ];
  const pastaSaida = path.join(pastaDados, diaHoje);
  salvarJSON(path.join(pastaSaida, "ofertas.json"), { data: diaHoje, criterios: crit, ofertas });
  fs.writeFileSync(path.join(pastaSaida, "ofertas.md"), relatorio(ofertas, resumo));
  const cab = ["status", "oferta", "titulo", "preco", "plataforma", "ativos", "aprofundada", "criativos", "dias_no_ar", "novos", "anterior", "paginas", "falta"];
  const csv = ofertas
    .filter((o) => o.status !== "fora")
    .map((o) =>
      [o.status, o.chave, o.verificacao?.titulo ?? "", o.preco ?? "", o.verificacao?.plataforma ?? "", o.metricas.ativos, o.aprofundada ? "sim" : "não",
        o.metricas.criativos, o.metricas.diasNoAr, o.metricas.novos, o.anterior ?? "", o.metricas.paginas.map((p) => p.nome).join(" / "), o.falhas.join(" / ")]
        .map((c) => String(c).replace(/[;\n]/g, " "))
        .join(";"),
    );
  fs.writeFileSync(path.join(pastaSaida, "ofertas.csv"), [cab.join(";"), ...csv].join("\n") + "\n");
  // Com --cofre ou OBSIDIAN_COFRE, a coleta também vai para o Obsidian (nota do dia e uma nota por oferta).
  const cofre = cofreDe(undefined, undefined, a.cofre);
  if (cofre) console.log(`Obsidian: ${exportarRadar(cofre, path.join(pastaSaida, "ofertas.json")).ofertas} oferta(s) no cofre.`);
  console.log(`\n${resumo.map((r) => r.replace(/\*\*/g, "")).join("\n")}\nRelatório: ${path.join(pastaSaida, "ofertas.md")}`);

  if (API) {
    // Para o app: as escaladas, as quase lá e as maiores do resto (o painel não precisa das centenas de ofertas fracas).
    const relevantes = [
      ...ofertas.filter((o) => o.status !== "fora"),
      ...ofertas.filter((o) => o.status === "fora" && (o.aprofundada || o.verificacao)).sort((p, q) => q.metricas.ativos - p.metricas.ativos).slice(0, 30),
    ];
    const r = chamarApp("POST", "/api/coleta/fim", {
      execucao,
      data: diaHoje,
      inicio: hoje.toISOString(),
      fim: new Date().toISOString(),
      fonte,
      criterios: crit,
      resumo: resumo.map((x) => x.replace(/\*\*/g, "")),
      contagem: {
        buscas: termos.length,
        anuncios: brutos.length,
        validos: validos.length,
        ofertas: ofertas.length,
        low_ticket: ofertas.filter((o) => naFaixa(o.preco)).length,
        aprofundadas: ofertas.filter((o) => o.aprofundada).length,
        escaladas: esc,
        quase,
      },
      ofertas: relevantes.map((o) => ({
        chave: o.chave,
        status: o.status,
        falhas: o.falhas,
        preco: o.preco,
        fonte_preco: o.verificacao?.fonte,
        plataforma: o.verificacao?.plataforma,
        checkout: o.verificacao?.checkout,
        bumps: o.verificacao?.bumps ?? [],
        bumps_apos_nome: !!o.verificacao?.preenchido,
        moeda_checkout: o.verificacao?.moeda,
        titulo: o.verificacao?.titulo,
        url: o.metricas.url,
        ativos: o.metricas.ativos,
        aprofundada: o.aprofundada,
        estimado: !!o.estimado,
        limitada: o.limitada,
        criativos: o.metricas.criativos,
        dias_no_ar: o.metricas.diasNoAr,
        mais_antigo: dataBR(o.metricas.maisAntigo),
        novos: o.metricas.novos,
        anterior: o.anterior,
        paginas: o.metricas.paginas.slice(0, 5).map((p) => ({ ...p, link: urlPagina(p.id) })),
        textos: o.metricas.textos,
      })),
      historico: hist,
    });
    console.log(r ? `Resultado enviado ao app (${API}).` : "O app não recebeu o resultado; o relatório local continua valendo.");
  }
}

if (require.main === module)
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });

export const fecharNavegador = async () => navegador && navegador.close();

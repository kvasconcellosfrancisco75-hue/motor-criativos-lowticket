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
 *
 * Etapas
 *  1. Descoberta: busca por frases que só aparecem em anúncio de oferta ("acesso imediato", "pagamento único"...).
 *     Descarta e-commerce, catálogo, apps, WhatsApp e perfis. Agrupa os anúncios em OFERTAS pelo destino
 *     (vários anunciantes e criativos levando à mesma página são uma oferta só).
 *  2. Preço: abre a página das ofertas mais fortes (e o checkout, se achar o link) e lê o preço.
 *  3. Aprofundamento: para as ofertas low ticket, coleta todos os anúncios ativos das páginas que as anunciam
 *     e conta quantos levam à oferta. É a medida de volume de verdade; a busca da etapa 1 só mostra uma amostra.
 *  4. Critérios: low ticket, volume, longevidade, investimento contínuo e tendência (a partir da 2ª coleta).
 *
 * A coleta roda no Apify, na sua conta (cobrança por resultado). O custo de cada etapa aparece no terminal.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ApifyClient } from "apify-client";
import { args, lerJSON, salvarJSON } from "./util";

const a = args();
const cfg = lerJSON(path.resolve(a.config ?? "radar/config.json"));
const crit = { preco_max: 97, min_ativos: 15, min_dias: 21, novos_dias: 7, min_novos: 1, queda_max: 0.2, ...(cfg.criterios ?? {}) };
const pastaDados = path.resolve(a.saida ?? cfg.saida ?? "radar/dados");
const hoje = new Date();
const diaHoje = hoje.toISOString().slice(0, 10);
const DIA = 86400000;
const pais = cfg.pais ?? "BR";

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
  return `https://www.facebook.com/ads/library/?${q}`;
};
const urlPagina = (id: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${pais}&media_type=all&search_type=page&view_all_page_id=${id}`;

let custoTotal = 0;
async function rodarActor(urls: string[], limite: number, etapa: string): Promise<any[]> {
  // O token vem de APIFY_TOKEN ou é injetado pelo ambiente nas chamadas a api.apify.com.
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN ?? "injetado-pelo-ambiente" });
  const actor = cfg.actor ?? "apify/facebook-ads-scraper";
  // Teto de gasto por etapa: sem ele, vale o teto padrão da conta no Apify, que pode cortar a coleta no meio.
  const maxItems = urls.length * limite;
  const teto = Number(cfg.custo_max_por_etapa_usd ?? 8);
  const estimativa = maxItems * Number(cfg.custo_por_anuncio_usd ?? 0.0055);
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

// ───────────────────────────── mercado (Brunson) ─────────────────────────────

/** Saúde, riqueza ou relacionamento: um rótulo depois da coleta, não um filtro na busca. */
const SINAIS: Record<string, string[]> = {
  "saúde": [
    "emagrec", "peso", "quilos", "kg", "barriga", "dieta", "receitas fit", "low carb", "jejum", "diabet", "glicose", "pressao alta",
    "ansiedade", "depress", "insonia", "dormir", "sono", "dor", "coluna", "joelho", "articula", "gastrite", "intestin", "inchaco",
    "saude", "menopausa", "cabelo", "calvicie", "pele", "manchas", "celulite", "flacidez", "treino", "academia", "yoga", "pilates",
    "gluten", "detox", "cha ", "natural", "tireoide", "fibromialgia", "memoria", "postura", "visao", "cha seca", "metabolismo",
  ],
  riqueza: [
    "renda", "dinheiro", "ganhar", "vender", "vendas", "venda", "negocio", "empreend", "lucr", "faturar", "clientes", "marketing",
    "trafego", "afiliad", "concurso", "carreira", "emprego", "profiss", "professor", "salario", "investi", "financ", "divida",
    "excel", "curriculo", "freela", "encomenda", "loja", "revend", "ingles", "certificado", "aprovad", "enem",
  ],
  relacionamento: [
    "relacionamento", "namor", "casamento", "casal", "marido", "esposa", "reconquist", "ex ", "conquistar", "seducao", "amor",
    "filho", "bebe", "maternidade", "mae", "pai ", "crianca", "familia", "autoestima", "comunicacao", "amizade", "solteir",
    "paquera", "traicao", "ciume", "birra", "educacao infantil", "adolescente", "autismo", "tdah",
  ],
};
function mercado(textos: string[]): string {
  const t = ` ${sem(textos.join(" "))} `;
  // Cada sinal é o começo de uma palavra ("dor" conta "dores", não "vendedor"); com espaço no fim, a palavra inteira.
  const conta = (p: string) => (t.match(new RegExp(`\\b${p.trim()}${p.endsWith(" ") ? "\\b" : ""}`, "g")) ?? []).length;
  const pontos = Object.entries(SINAIS).map(([m, l]) => [m, l.reduce((s, p) => s + conta(p), 0)] as const);
  pontos.sort((p, q) => q[1] - p[1]);
  if (!pontos[0][1] || pontos[0][1] === pontos[1][1]) return "indefinido";
  return pontos[0][0];
}

// ───────────────────────────── preço ─────────────────────────────

const CHECKOUTS: [string, string][] = [
  ["hotmart.com", "Hotmart"], ["kiwify.com.br", "Kiwify"], ["kiwify.app", "Kiwify"], ["eduzz.com", "Eduzz"],
  ["monetizze.com.br", "Monetizze"], ["perfectpay.com.br", "PerfectPay"], ["ticto.app", "Ticto"], ["ticto.com.br", "Ticto"],
  ["greenn.com.br", "Greenn"], ["braip.com", "Braip"], ["cakto.com.br", "Cakto"], ["lastlink.com", "Lastlink"], ["hub.la", "Hubla"],
  ["pepper.com.br", "Pepper"], ["payt.com.br", "Payt"], ["kirvano.com", "Kirvano"], ["doppus.com", "Doppus"], ["yampi.com.br", "Yampi"],
  ["appmax.com.br", "Appmax"], ["digitalmanager.guru", "Guru"], ["pagtrust.com.br", "PagTrust"], ["vega.app", "Vega"],
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

type Verificacao = { titulo?: string; preco?: number; fonte?: string; precos_pagina: number[]; plataforma?: string; checkout?: string; erro?: string };

let navegador: any;
async function abrir(url: string): Promise<{ titulo: string; texto: string; links: string[] }> {
  if (navegador === undefined) {
    try {
      // Playwright é opcional. Instale com: npm i -D playwright && npx playwright install chromium
      navegador = await require("playwright").chromium.launch(
        process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
      );
    } catch {
      navegador = null;
      console.log("  (Playwright indisponível: lendo o HTML sem executar scripts; páginas montadas por JavaScript podem ficar sem preço)");
    }
  }
  if (navegador) {
    const ctx = await navegador.newContext({ locale: "pt-BR", userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36" });
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(2500);
      // Rola a página: preço e botão de compra costumam estar no fim e carregar sob demanda.
      await p.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 1200) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
      });
      await p.waitForTimeout(800);
      const titulo = await p.title();
      const texto: string = await p.evaluate(() => document.body?.innerText ?? "");
      const links: string[] = await p.evaluate(() => [...document.querySelectorAll("a[href]")].map((e) => (e as HTMLAnchorElement).href));
      return { titulo, texto, links };
    } finally {
      await ctx.close();
    }
  }
  // Sem navegador: curl respeita o HTTPS_PROXY (o fetch do Node não).
  const r = spawnSync("curl", ["-sfL", "--max-time", "30", "-A", "Mozilla/5.0", url], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`não abriu (curl ${r.status})`);
  const html = r.stdout;
  const titulo = limpar(html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "");
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const texto = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  return { titulo, texto, links };
}

async function verificar(destino: string): Promise<Verificacao> {
  const v: Verificacao = { precos_pagina: [] };
  try {
    const pg = await abrir(destino);
    v.titulo = limpar(pg.titulo).slice(0, 120);
    v.precos_pagina = [...new Set(precos(pg.texto).map((x) => x.valor))].sort((p, q) => p - q).slice(0, 12);
    v.plataforma = plataformaDe(destino);
    const checkout = v.plataforma ? destino : pg.links.find((l) => plataformaDe(l));
    if (checkout) {
      v.checkout = checkout;
      v.plataforma = plataformaDe(checkout);
    }
    // O checkout tem o preço exato; a página de vendas tem "de R$ 97 por R$ 27", bônus e parcelas.
    if (checkout && checkout !== destino) {
      try {
        const ck = await abrir(checkout);
        const p = precoProvavel(ck.texto);
        if (p) [v.preco, v.fonte] = [p, "checkout"];
      } catch {}
    }
    if (v.preco === undefined) {
      const p = precoProvavel(pg.texto);
      if (p) [v.preco, v.fonte] = [p, checkout === destino ? "checkout" : "página"];
    }
  } catch (e: any) {
    v.erro = String(e?.message ?? e).split("\n")[0].slice(0, 120);
  }
  return v;
}

// ───────────────────────────── critérios ─────────────────────────────

type Oferta = {
  chave: string;
  mercado: string;
  status: "escalada" | "quase" | "fora";
  falhas: string[];
  aprofundada: boolean;
  limitada: boolean;
  metricas: Metricas;
  descoberta: { ativos: number; nota: number; termos: string[] };
  verificacao?: Verificacao;
  preco?: number;
  anterior?: number;
};

function avaliar(o: Oferta) {
  const m = o.metricas;
  const c: [boolean | null, string][] = [
    [o.preco === undefined ? false : o.preco <= crit.preco_max, o.preco === undefined ? "preço não encontrado" : `preço R$ ${o.preco} acima de R$ ${crit.preco_max}`],
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
  const ativos = `${m.ativos}${o.limitada ? "+" : ""}${o.aprofundada ? "" : " (só na busca)"}`;
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
  if (v?.precos_pagina.length) linhas.push(`- Valores na página: ${v.precos_pagina.map((p) => brl(p)).join(", ")}`);
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
    `Critérios: preço até ${brl(crit.preco_max)} · ${crit.min_ativos}+ anúncios ativos · criativo no ar há ${crit.min_dias}+ dias · ${crit.min_novos}+ criativo novo em ${crit.novos_dias} dias · sem queda de mais de ${Math.round(crit.queda_max * 100)}% desde a coleta anterior.`,
    "",
    ...resumo.map((r) => `- ${r}`),
    "",
    `## Escaladas (${esc.length})`,
    "",
  ];
  for (const merc of ["saúde", "riqueza", "relacionamento", "indefinido"]) {
    const l = esc.filter((o) => o.mercado === merc);
    if (!l.length) continue;
    md.push(`## ${merc[0].toUpperCase()}${merc.slice(1)} (${l.length})`, "", ...l.map((o) => blocoOferta(o) + "\n"));
  }
  if (!esc.length) md.push("Nenhuma oferta cumpriu todos os critérios nesta coleta.", "");
  md.push(`## Quase lá: falta um critério (${quase.length})`, "");
  for (const o of quase) md.push(`*${o.mercado}*`, "", blocoOferta(o), "");
  return md.join("\n");
}

// ───────────────────────────── principal ─────────────────────────────

async function main() {
  const pastaColetas = path.join(pastaDados, "coletas");
  const pastaHist = path.join(pastaDados, "historico");

  // 1. Descoberta
  const termos: string[] = a.termos ? a.termos.split(",").map((t) => t.trim()).filter(Boolean) : cfg.termos;
  const brutos: any[] = a["de-arquivo"]
    ? lerJSON(path.resolve(a["de-arquivo"]))
    : await rodarActor(termos.map(urlBusca), Number(a.limite ?? cfg.limite_por_termo ?? 50), "1/3 descoberta");
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
  const termoDe = (url: string) => {
    const q = new URL(url || "https://x").searchParams.get("q") ?? "";
    return q.replace(/^"|"$/g, "");
  };
  let ofertas: Oferta[] = [...grupos.entries()].map(([chave, ads]) => {
    const m = medir(ads);
    return {
      chave,
      mercado: "indefinido",
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
      o.verificacao = await verificar(o.metricas.url || `https://${o.metricas.destino}`);
      o.preco = o.verificacao.preco;
      const v = o.verificacao;
      console.log(`  ${String(i + 1).padStart(2)}. ${o.chave.padEnd(40)} ${v.erro ? `erro: ${v.erro}` : `${brl(o.preco)} ${v.plataforma ?? ""}`}`);
    }
    if (navegador) await navegador.close();
  }
  // Sem página aberta, o preço citado no anúncio serve de pista.
  for (const o of ofertas) if (o.preco === undefined) {
    const p = precoProvavel(o.metricas.textos.map((t) => t.texto).join(" \n "));
    if (p) o.preco = p;
  }

  // 3. Aprofundamento: todos os anúncios ativos das páginas que anunciam as ofertas low ticket
  const nAprofundar = Number(a.aprofundar ?? cfg.aprofundar ?? 12);
  const alvos = ofertas.filter((o) => o.preco !== undefined && o.preco <= crit.preco_max).slice(0, nAprofundar);
  if (!a["sem-aprofundar"] && alvos.length) {
    const limitePag = Number(cfg.limite_por_pagina ?? 60);
    const idsPag = [...new Set(alvos.flatMap((o) => o.metricas.paginas.slice(0, cfg.paginas_por_oferta ?? 2).map((p) => p.id)).filter(Boolean))];
    let brutosPag: any[] = [];
    try {
      brutosPag = a["paginas-de-arquivo"]
        ? lerJSON(path.resolve(a["paginas-de-arquivo"]))
        : await rodarActor(idsPag.map(urlPagina), limitePag, "3/3 aprofundamento");
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
      o.limitada = [...ids].some((id) => (porPagina.get(id) ?? 0) >= limitePag);
    }
  }

  // 4. Histórico, mercado e critérios
  const anteriores = fs.existsSync(pastaHist) ? fs.readdirSync(pastaHist).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${diaHoje}.json`).sort() : [];
  const ant: Record<string, { ativos: number; preco?: number; mercado: string }> = anteriores.length ? lerJSON(path.join(pastaHist, anteriores[anteriores.length - 1])) : {};
  for (const o of ofertas) {
    o.mercado = mercado([...(grupos.get(o.chave) ?? []).map((x) => x.texto), o.verificacao?.titulo ?? ""]);
    if (ant[o.chave] && o.aprofundada) o.anterior = ant[o.chave].ativos;
    avaliar(o);
  }
  const hist: Record<string, { ativos: number; preco?: number; mercado: string }> = { ...ant };
  for (const o of ofertas) if (o.aprofundada) hist[o.chave] = { ativos: o.metricas.ativos, preco: o.preco, mercado: o.mercado };
  salvarJSON(path.join(pastaHist, `${diaHoje}.json`), hist);

  const esc = ofertas.filter((o) => o.status === "escalada").length;
  const quase = ofertas.filter((o) => o.status === "quase").length;
  const resumo = [
    `${a["de-arquivo"] ? "Coleta reaproveitada" : `${termos.length} buscas`}, ${brutos.length} anúncios, ${validos.length} de oferta, ${ofertas.length} ofertas distintas.`,
    `${ofertas.filter((o) => o.verificacao).length} páginas abertas, ${ofertas.filter((o) => o.preco !== undefined && o.preco <= crit.preco_max).length} ofertas low ticket, ${ofertas.filter((o) => o.aprofundada).length} aprofundadas.`,
    `Resultado: **${esc} escalada(s)** e ${quase} quase lá.`,
    anteriores.length ? `Tendência comparada com a coleta de ${anteriores[anteriores.length - 1].slice(0, 10)}.` : "Primeira coleta: a tendência aparece a partir da próxima (rode toda semana).",
    `Custo no Apify desta execução: US$ ${custoTotal.toFixed(2)}.`,
  ];
  const pastaSaida = path.join(pastaDados, diaHoje);
  salvarJSON(path.join(pastaSaida, "ofertas.json"), { data: diaHoje, criterios: crit, ofertas });
  fs.writeFileSync(path.join(pastaSaida, "ofertas.md"), relatorio(ofertas, resumo));
  const cab = ["status", "mercado", "oferta", "titulo", "preco", "plataforma", "ativos", "aprofundada", "criativos", "dias_no_ar", "novos", "anterior", "paginas", "falta"];
  const csv = ofertas
    .filter((o) => o.status !== "fora")
    .map((o) =>
      [o.status, o.mercado, o.chave, o.verificacao?.titulo ?? "", o.preco ?? "", o.verificacao?.plataforma ?? "", o.metricas.ativos, o.aprofundada ? "sim" : "não",
        o.metricas.criativos, o.metricas.diasNoAr, o.metricas.novos, o.anterior ?? "", o.metricas.paginas.map((p) => p.nome).join(" / "), o.falhas.join(" / ")]
        .map((c) => String(c).replace(/[;\n]/g, " "))
        .join(";"),
    );
  fs.writeFileSync(path.join(pastaSaida, "ofertas.csv"), [cab.join(";"), ...csv].join("\n") + "\n");
  console.log(`\n${resumo.map((r) => r.replace(/\*\*/g, "")).join("\n")}\nRelatório: ${path.join(pastaSaida, "ofertas.md")}`);
}

if (require.main === module)
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });

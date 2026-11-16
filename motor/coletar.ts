/**
 * Coleta referências na Biblioteca de Anúncios da Meta por um Actor do Apify e preenche
 * <produto>/referencias.csv (que `npm run referencias` pontua).
 *
 *   npm run coletar -- --produto <pasta>                      # roda o Actor (precisa do token do Apify)
 *   npm run coletar -- --produto <pasta> --de-arquivo dados.json  # usa um conjunto exportado do Apify, sem API
 *   [--sem-transcricao]                                        # não baixa nem transcreve os vídeos
 *   [--termos "a,b"] [--limite 15]                             # troca os termos e o limite da ficha (para testes baratos)
 *
 * A busca fica na ficha, em "busca" (veja docs/referencias.md). A coleta roda nos servidores do Apify,
 * na sua conta: o uso é cobrado por resultado e segue os termos da Meta e do Apify.
 *
 * Cada coleta fica guardada em <produto>/coletas/. Um anúncio que aparece ativo em várias coletas
 * seguidas (ex.: semanais) ganha pontos: é o sinal mais forte de que dá lucro.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ApifyClient } from "apify-client";
import { args, lerJSON, salvarJSON } from "./util";

const a = args();
if (!a.produto) {
  console.error("Uso: npm run coletar -- --produto <pasta> [--de-arquivo dados.json] [--sem-transcricao]");
  process.exit(1);
}
const pasta = path.resolve(a.produto);
const produto = lerJSON(path.join(pasta, "produto.json"));
const busca = produto.busca;
if (!busca?.termos?.length) {
  console.error('A ficha não tem "busca.termos". Exemplo em docs/referencias.md.');
  process.exit(1);
}
const pastaColetas = path.join(pasta, "coletas");
const hoje = new Date();
const diaHoje = hoje.toISOString().slice(0, 10);

const urlBusca = (termo: string) => {
  const q = new URLSearchParams({
    active_status: busca.so_ativos === false ? "all" : "active",
    ad_type: "all",
    country: busca.pais ?? "BR",
    media_type: busca.so_video === false ? "all" : "video",
    q: termo,
    search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${q}`;
};

/** Lê um campo aceitando os nomes em camelCase e snake_case e caminhos alternativos. */
const campo = (o: any, ...caminhos: string[]) => {
  for (const c of caminhos) {
    const v = c.split(".").reduce((x: any, k) => (x == null ? undefined : x[k]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const dataBR = (v: any) => {
  if (v == null) return "";
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};
const dataNum = (br: string) => {
  const [d, m, y] = br.split("/").map(Number);
  return br ? new Date(y, m - 1, d).getTime() : Infinity;
};
const limpar = (s: any) => String(s ?? "").replace(/[;\r\n]+/g, " ").replace(/\s+/g, " ").trim();

type Anuncio = { id: string; criativo: string; link: string; destino: string; anunciante: string; inicio: string; fim: string; ativo: boolean; versoes: number; formato: string; texto: string; cta: string; video?: string };

function normalizar(item: any): Anuncio | undefined {
  const id = String(campo(item, "adArchiveID", "adArchiveId", "ad_archive_id", "id") ?? "");
  if (!id) return undefined;
  const s = item.snapshot ?? {};
  const videos = campo(s, "videos", "cards.0.videos") ?? [];
  const video = campo(videos[0] ?? {}, "video_sd_url", "videoSdUrl", "video_hd_url", "videoHdUrl") ?? campo(s, "cards.0.video_sd_url", "cards.0.videoSdUrl");
  return {
    id,
    criativo: String(campo(item, "collationId", "collation_id") ?? id),
    link: `https://www.facebook.com/ads/library/?id=${id}`,
    destino: String(campo(s, "link_url", "linkUrl", "cards.0.link_url", "cards.0.linkUrl") ?? ""),
    anunciante: limpar(campo(item, "pageName", "page_name", "snapshot.page_name", "snapshot.pageName")),
    inicio: dataBR(campo(item, "startDate", "start_date", "startDateFormatted")),
    fim: dataBR(campo(item, "endDate", "end_date", "endDateFormatted")),
    ativo: Boolean(campo(item, "isActive", "is_active")),
    versoes: Number(campo(item, "collationCount", "collation_count") ?? 1),
    formato: String(campo(s, "display_format", "displayFormat") ?? (video ? "VIDEO" : "")).toLowerCase(),
    texto: limpar(campo(s, "body.text", "body.markup.__html", "body")),
    cta: limpar(campo(s, "cta_text", "ctaText")),
    video,
  };
}

async function rodarActor(): Promise<any[]> {
  // O token pode vir de APIFY_TOKEN ou ser injetado pelo ambiente nas chamadas a api.apify.com.
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN ?? "injetado-pelo-ambiente" });
  const actor = busca.actor ?? "apify/facebook-ads-scraper";
  const termos: string[] = a.termos ? a.termos.split(",").map((t) => t.trim()) : busca.termos;
  const urls = termos.map((t) => ({ url: urlBusca(t) }));
  // Só anúncios que já estavam no ar antes de (hoje - dias_minimos): não se paga por anúncio novo demais.
  const corte = new Date(hoje.getTime() - (busca.dias_minimos ?? 21) * 86400000).toISOString().slice(0, 10);
  // Entrada do apify/facebook-ads-scraper. Outro Actor pode usar outros nomes: ajuste em "busca.entrada".
  const entrada = {
    startUrls: urls,
    resultsLimit: Number(a.limite ?? busca.limite_por_termo ?? 50),
    sorting: busca.ordenar ?? "total_impressions",
    onlyAdsOlderThan: corte,
    ...(busca.entrada ?? {}),
  };
  console.log(`Rodando ${actor} com ${urls.length} busca(s)...`);
  const run = await client.actor(actor).call(entrada);
  if (run.status !== "SUCCEEDED") throw new Error(`O Actor terminou com status ${run.status}. Veja o log no painel do Apify.`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

async function baixar(url: string, destino: string) {
  if (fs.existsSync(destino)) return true;
  const r = await fetch(url);
  if (!r.ok) return false;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  return true;
}

async function main() {
  const brutos = a["de-arquivo"] ? lerJSON(path.resolve(a["de-arquivo"])) : await rodarActor();
  salvarJSON(path.join(pastaColetas, `${diaHoje}.json`), brutos);

  // Uma linha por criativo. Além do agrupamento da própria biblioteca (collationId), junta anúncios do mesmo
  // anunciante com o mesmo texto: é o mesmo criativo rodando em vários anúncios, sinal de que está escalando.
  const chave = (n: Anuncio) => `${n.anunciante.toLowerCase()}|${n.texto.toLowerCase().replace(/\W+/g, "").slice(0, 120)}`;
  const grupos = new Map<string, { melhor: Anuncio; ids: Set<string>; versoes: number }>();
  for (const b of Array.isArray(brutos) ? brutos : []) {
    const n = normalizar(b);
    if (!n) continue;
    const k = n.texto ? chave(n) : n.criativo;
    const g = grupos.get(k);
    if (!g) grupos.set(k, { melhor: n, ids: new Set([n.criativo]), versoes: n.versoes });
    else {
      g.ids.add(n.criativo);
      g.versoes = Math.max(g.versoes, n.versoes);
      // Fica com o mais antigo (mais tempo no ar) como representante.
      if (dataNum(n.inicio) < dataNum(g.melhor.inicio)) g.melhor = n;
    }
  }
  const porCriativo = new Map<string, Anuncio>();
  for (const [k, g] of grupos) porCriativo.set(k, { ...g.melhor, versoes: Math.max(g.versoes, g.ids.size) });

  // Em quantas coletas (contando esta) cada anúncio apareceu ativo.
  const ativoEm = new Map<string, number>();
  for (const f of fs.readdirSync(pastaColetas).filter((f) => f.endsWith(".json"))) {
    const vistos = new Set<string>();
    for (const b of lerJSON(path.join(pastaColetas, f))) {
      const n = normalizar(b);
      if (n?.ativo) vistos.add(n.texto ? chave(n) : n.criativo);
    }
    for (const c of vistos) ativoEm.set(c, (ativoEm.get(c) ?? 0) + 1);
  }

  // Só ofertas: descarta anúncios que levam a conversa, perfil ou loja de apps (posts impulsionados, serviços).
  // Infoprodutores costumam usar página própria, então não dá para exigir Hotmart, Kiwify etc.
  // Com "busca.dominios_oferta", só entram anúncios que levam a um desses domínios.
  const NAO_OFERTA = ["whatsapp.com", "wa.me", "instagram.com", "facebook.com", "fb.me", "m.me", "t.me", "itunes.apple.com", "apps.apple.com", "play.google.com", "maps.google", "tiktok.com"];
  const dest = (x: Anuncio) => x.destino.toLowerCase();
  const ehOferta = (x: Anuncio) =>
    busca.so_infoproduto === false ||
    (busca.dominios_oferta?.length ? busca.dominios_oferta.some((d: string) => dest(x).includes(d.toLowerCase())) : !!x.destino && !NAO_OFERTA.some((d) => dest(x).includes(d)));
  const descartados = [...porCriativo.values()].filter((x) => !ehOferta(x));
  for (const [k, x] of porCriativo) if (!ehOferta(x)) porCriativo.delete(k);
  if (descartados.length) console.log(`${descartados.length} criativo(s) descartados por não levarem a uma página de venda (WhatsApp, perfil, app ou sem link).`);

  const diasMin = busca.dias_minimos ?? 21;
  const dias = (x: Anuncio) => {
    const [d, m, y] = x.inicio.split("/").map(Number);
    return x.inicio ? Math.round((hoje.getTime() - new Date(y, m - 1, d).getTime()) / 86400000) : 0;
  };
  const escolhidos = [...porCriativo.values()]
    .filter((x) => dias(x) >= diasMin)
    .sort((x, y) => dias(y) * Math.max(1, y.versoes) - dias(x) * Math.max(1, x.versoes));
  console.log(`${porCriativo.size} criativos de oferta, ${escolhidos.length} no ar há ${diasMin}+ dias.`);

  // Transcrição: o texto do anúncio é a legenda; o gancho de verdade é a fala dos primeiros segundos.
  const falas: Record<string, { gancho: string; texto: string; duracao?: number }> = {};
  const maxTranscrever = busca.transcrever_max ?? 15;
  if (!a["sem-transcricao"]) {
    const videos: string[] = [];
    for (const x of escolhidos.filter((x) => x.video).slice(0, maxTranscrever)) {
      const arq = path.join(pastaColetas, "videos", `${x.id}.mp4`);
      if (await baixar(x.video!, arq).catch(() => false)) videos.push(arq);
      else console.log(`  não consegui baixar o vídeo de ${x.link}`);
    }
    if (videos.length) {
      const saida = path.join(pastaColetas, `${diaHoje}.falas.json`);
      const py = process.env.PYTHON ?? "python3";
      const r = spawnSync(py, [path.join(__dirname, "transcrever.py"), saida, ...videos], { stdio: "inherit" });
      if (r.status === 0) for (const [arq, v] of Object.entries(lerJSON(saida) as Record<string, any>)) falas[path.basename(arq, ".mp4")] = v;
      else console.log("  a transcrição falhou; as referências ficam só com o texto do anúncio.");
    }
  }

  // Público: "mesmo" se o anúncio fala com o público do produto (palavras em busca.palavras_publico).
  const palavrasPublico: string[] = (busca.palavras_publico ?? []).map((p: string) => p.toLowerCase());
  const publico = (x: Anuncio, fala: string) =>
    palavrasPublico.length && palavrasPublico.some((p) => `${x.texto} ${fala}`.toLowerCase().includes(p)) ? "mesmo" : "vizinho";

  const COLUNAS = ["link", "anunciante", "inicio", "fim", "ativo", "versoes", "formato", "duracao_s", "publico", "gancho", "transcricao", "cta", "observacao", "coletas"];
  const csv = path.join(pasta, "referencias.csv");
  // Mantém as linhas preenchidas à mão que esta coleta não trouxe.
  const antigas = fs.existsSync(csv) ? fs.readFileSync(csv, "utf8").split(/\r?\n/).filter((l) => l.trim()) : [];
  const cab = antigas[0]?.split(";") ?? COLUNAS;
  const novosLinks = new Set(escolhidos.map((x) => x.link));
  const manuais = antigas.slice(1).filter((l) => !novosLinks.has(l.split(";")[cab.indexOf("link")]));
  const linhas = escolhidos.map((x) => {
    const f = falas[x.id];
    const v: Record<string, string | number> = {
      link: x.link,
      anunciante: x.anunciante,
      inicio: x.inicio,
      fim: x.ativo ? "" : x.fim,
      ativo: x.ativo ? "sim" : "não",
      versoes: x.versoes,
      formato: x.formato,
      duracao_s: f?.duracao ?? "",
      publico: publico(x, f?.texto ?? ""),
      gancho: limpar(f?.gancho || x.texto.split(/(?<=[.?!])\s/)[0]),
      transcricao: limpar(f?.texto ?? ""),
      cta: x.cta,
      observacao: limpar(`destino: ${x.destino.replace(/^https?:\/\//, "").split(/[/?]/)[0]} — ${f?.texto ? `legenda: ${x.texto.slice(0, 160)}` : "sem fala transcrita, gancho = 1ª frase da legenda"}`),
      coletas: ativoEm.get(x.texto ? chave(x) : x.criativo) ?? 1,
    };
    return COLUNAS.map((c) => v[c] ?? "").join(";");
  });
  const cabFinal = cab.includes("coletas") ? cab : COLUNAS;
  fs.writeFileSync(csv, [cabFinal.join(";"), ...manuais, ...linhas].join("\n") + "\n");
  console.log(`${linhas.length} referências gravadas em ${csv}. Agora: npm run referencias -- --produto ${a.produto}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

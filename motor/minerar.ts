/**
 * Minera a Biblioteca de Anúncios da Meta com o Actor curious_coder/facebook-ads-library-scraper (Apify)
 * e guarda os anúncios mais relevantes do nicho em JSON.
 *
 *   npm run minerar -- --produto <pasta>
 *   [--termos "a,b,c"]   troca os termos da ficha
 *   [--total 100]        quantos anúncios coletar no total (padrão: inteligencia.total ou 100)
 *   [--pais BR]          país da busca (ALL = todos)
 *   [--qualquer-ordem]   aceita as palavras em qualquer ordem (mais resultados, mais ruído)
 *
 * Rodar de novo no mesmo dia SOMA à coleta do dia (sem repetir anúncios), para completar com outros termos.
 *
 * Saída em <produto>/inteligencia/<aaaa-mm-dd>/:
 *   brutos.json    exatamente o que o Actor devolveu (referência)
 *   anuncios.json  os mesmos anúncios num formato limpo (motor/anuncio.ts)
 *
 * "Relevância" = a ordem da própria biblioteca por impressões (sort_data[mode]=total_impressions):
 * os primeiros de cada busca são os que mais estão sendo entregues hoje.
 * Custo: o Actor cobra por anúncio (cerca de US$ 0,75 a cada 1.000) na sua conta do Apify.
 */
import fs from "node:fs";
import path from "node:path";
import { ApifyClient } from "apify-client";
import { normalizar } from "./anuncio";
import { args, lerJSON, salvarJSON } from "./util";

const a = args();
if (!a.produto) {
  console.error('Uso: npm run minerar -- --produto <pasta> [--termos "a,b"] [--total 100] [--pais BR]');
  process.exit(1);
}
const pasta = path.resolve(a.produto);
const produto = lerJSON(path.join(pasta, "produto.json"));
const cfg = { ...(produto.busca ?? {}), ...(produto.inteligencia ?? {}) };
const termos: string[] = a.termos ? a.termos.split(",").map((t) => t.trim()).filter(Boolean) : cfg.termos ?? [];
if (!termos.length) {
  console.error('A ficha não tem "inteligencia.termos" (nem "busca.termos"). Veja docs/inteligencia.md.');
  process.exit(1);
}
const total = Number(a.total ?? cfg.total ?? 100);
const pais = String(a.pais ?? cfg.pais ?? "BR").toUpperCase();
const midia = cfg.midia ?? (cfg.so_video ? "video" : "all"); // all | video | image
const status = cfg.status ?? "active"; // active | all
const ACTOR = cfg.actor ?? "curious_coder/facebook-ads-library-scraper";

const urlBusca = (termo: string) => {
  const q = new URLSearchParams({
    active_status: status,
    ad_type: "all",
    country: pais,
    media_type: midia,
    q: termo,
    // keyword_exact_phrase busca a frase exata (menos ruído); keyword_unordered aceita as palavras em qualquer ordem.
    search_type: cfg.frase_exata === false || a["qualquer-ordem"] ? "keyword_unordered" : "keyword_exact_phrase",
    "sort_data[direction]": "desc",
    "sort_data[mode]": "total_impressions",
  });
  if (cfg.idioma) q.set("content_languages[0]", cfg.idioma);
  return `https://www.facebook.com/ads/library/?${q}`;
};

async function main() {
  const dia = new Date().toISOString().slice(0, 10);
  const saida = path.join(pasta, "inteligencia", dia);
  // O token vem de APIFY_TOKEN ou é injetado pelo ambiente nas chamadas a api.apify.com.
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN ?? "injetado-pelo-ambiente" });

  const porTermo = Math.ceil(total / termos.length);
  console.log(`Minerando ${total} anúncios (${porTermo} por termo) em ${pais}, ${status === "active" ? "só ativos" : "ativos e inativos"}, mídia: ${midia}.`);
  termos.forEach((t) => console.log(`  • ${t}`));

  const run = await client.actor(ACTOR).call(
    {
      urls: termos.map((t) => ({ url: urlBusca(t) })),
      // Sem "count" global: ele seria preenchido pelos primeiros termos e os outros ficariam sem nada.
      limitPerSource: porTermo,
      scrapeAdDetails: false,
      runTag: produto.id ?? "inteligencia",
      ...(cfg.entrada ?? {}),
    },
    { log: null },
  );
  if (run.status !== "SUCCEEDED") throw new Error(`O Actor terminou com status ${run.status}. Veja o run ${run.id} no painel do Apify.`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  // O Actor pode passar do limite por busca; fica com os primeiros (mais impressões) de cada termo,
  // em rodízio, até o total pedido.
  const porUrl = new Map<string, any[]>();
  for (const it of items) {
    const k = String((it as any).url ?? "");
    if (!porUrl.has(k)) porUrl.set(k, []);
    porUrl.get(k)!.push(it);
  }
  for (const l of porUrl.values()) l.sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
  const brutos: any[] = [];
  for (let i = 0; brutos.length < total && [...porUrl.values()].some((l) => l.length > i); i++)
    for (const l of porUrl.values()) if (l[i] && brutos.length < total) brutos.push(l[i]);

  // Soma à coleta do mesmo dia, sem repetir anúncios.
  const arqBrutos = path.join(saida, "brutos.json");
  const arqAnuncios = path.join(saida, "anuncios.json");
  const antes = fs.existsSync(arqAnuncios) ? lerJSON(arqAnuncios) : undefined;
  const brutosAntes: any[] = fs.existsSync(arqBrutos) ? lerJSON(arqBrutos) : [];
  const idDe = (b: any) => String(b.ad_archive_id ?? b.adArchiveID ?? b.id ?? "");
  const vistos = new Set(brutosAntes.map(idDe));
  const novos = brutos.filter((b) => !vistos.has(idDe(b)));
  const todosBrutos = [...brutosAntes, ...novos];
  salvarJSON(arqBrutos, todosBrutos);
  const anuncios = todosBrutos.map((b) => normalizar(b)).filter(Boolean);
  const todosTermos = [...new Set([...(antes?.termos ?? []), ...termos])];
  salvarJSON(arqAnuncios, { produto: produto.id, coletado_em: new Date().toISOString(), pais, termos: todosTermos, runs: [...(antes?.runs ?? (antes?.run ? [antes.run] : [])), run.id], anuncios });
  if (antes) console.log(`\nSomado à coleta de hoje: ${novos.length} anúncios novos (${brutos.length - novos.length} já estavam lá).`);

  const porBusca = new Map<string, number>();
  for (const x of anuncios) porBusca.set(x!.termo, (porBusca.get(x!.termo) ?? 0) + 1);
  console.log(`\n${anuncios.length} anúncios na coleta de hoje; esta rodada trouxe ${brutos.length} (o Actor entregou ${items.length}; ele cobra por anúncio entregue).`);
  for (const [t, n] of porBusca) console.log(`  ${String(n).padStart(3)}  ${t}`);
  console.log(`\nDados brutos: ${path.join(saida, "brutos.json")}`);
  console.log(`Agora: npm run curadoria -- --produto ${a.produto}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

/**
 * Coletor próprio da Biblioteca de Anúncios da Meta, sem Apify.
 *
 * A página da biblioteca é pública (não precisa de login) e já traz embutido o JSON da busca
 * (`search_results_connection`): o total de resultados e os primeiros ~30 anúncios, ordenados por impressões.
 * São os mesmos campos que o Actor do Apify devolve, então o radar lê os dois do mesmo jeito.
 *
 * Limites, medidos a partir de IP de servidor (nuvem, GitHub Actions):
 *  - Parte das visitas volta vazia ("Nenhum anúncio"): o Facebook filtra IPs de datacenter de forma intermitente.
 *    Cada endereço é tentado de novo, num contexto limpo, até `tentativas` vezes.
 *  - A rolagem (paginação) não carrega mais anúncios. Por isso cada busca rende ~30 anúncios: amplie com mais
 *    termos, não com mais profundidade. A página de um anunciante, porém, traz o TOTAL de anúncios ativos.
 *
 * Playwright: npm i -D playwright && npx playwright install chromium (ou CHROME_PATH apontando para um Chrome).
 */

export type Pagina = { url: string; total?: number; anuncios: any[]; tentativas: number; erro?: string };

const AGENTES = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Recorta o objeto JSON que começa na 1ª chave "{" depois de `marcador`, respeitando strings. */
export function recortarJSON(texto: string, marcador: string): any | undefined {
  const i = texto.indexOf(marcador);
  if (i < 0) return undefined;
  const ini = texto.indexOf("{", i + marcador.length);
  if (ini < 0) return undefined;
  let prof = 0;
  let str = false;
  let esc = false;
  for (let k = ini; k < texto.length; k++) {
    const c = texto[k];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") prof++;
    else if (c === "}" && --prof === 0) {
      try {
        return JSON.parse(texto.slice(ini, k + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Anúncios e total embutidos no HTML de uma página da biblioteca. */
export function extrair(html: string): { total?: number; anuncios: any[] } | undefined {
  const con = recortarJSON(html, '"search_results_connection":');
  if (!con) return undefined;
  const anuncios = (con.edges ?? []).flatMap((e: any) => e?.node?.collated_results ?? []);
  return { total: typeof con.count === "number" ? con.count : undefined, anuncios };
}

export class Biblioteca {
  private navegador: any;
  constructor(private opcoes: { tentativas?: number; pausa_ms?: number; log?: (s: string) => void } = {}) {}

  private async abrirNavegador() {
    if (this.navegador) return this.navegador;
    let pw: any;
    try {
      pw = require("playwright");
    } catch {
      throw new Error("Playwright não está instalado. Rode: npm i -D playwright && npx playwright install chromium");
    }
    this.navegador = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    return this.navegador;
  }

  /** Visita uma página da biblioteca até conseguir os anúncios embutidos (ou esgotar as tentativas). */
  async visitar(url: string): Promise<Pagina> {
    const nav = await this.abrirNavegador();
    const max = this.opcoes.tentativas ?? 8;
    let ultimoErro = "";
    for (let t = 1; t <= max; t++) {
      const ctx = await nav.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 900 }, userAgent: AGENTES[(t - 1) % AGENTES.length] });
      try {
        const p = await ctx.newPage();
        // Imagens, vídeos e fontes não são necessários: a página fica mais leve e rápida.
        await p.route("**/*", (r: any) => (["image", "media", "font"].includes(r.request().resourceType()) ? r.abort() : r.continue()));
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        let achado: { total?: number; anuncios: any[] } | undefined;
        // O JSON chega no HTML, às vezes um pouco depois do primeiro carregamento.
        for (let i = 0; i < 4 && !achado?.anuncios.length; i++) {
          await p.waitForTimeout(1500);
          achado = extrair(await p.content());
        }
        if (achado?.anuncios.length) return { url, total: achado.total, anuncios: achado.anuncios, tentativas: t };
        // Visita filtrada e busca vazia de verdade chegam iguais ("0 resultados"): só desiste após todas as tentativas.
        ultimoErro = "sem anúncios em todas as tentativas (filtro do Facebook ou busca sem resultado)";
      } catch (e: any) {
        ultimoErro = String(e?.message ?? e).split("\n")[0].slice(0, 140);
      } finally {
        await ctx.close().catch(() => {});
      }
      await esperar((this.opcoes.pausa_ms ?? 6000) + Math.random() * 3000);
    }
    return { url, anuncios: [], tentativas: max, erro: ultimoErro };
  }

  async fechar() {
    await this.navegador?.close().catch(() => {});
    this.navegador = undefined;
  }
}

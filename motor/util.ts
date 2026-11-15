import fs from "node:fs";
import path from "node:path";

export const lerJSON = <T = any>(arquivo: string): T => JSON.parse(fs.readFileSync(arquivo, "utf8"));
export const salvarJSON = (arquivo: string, dados: unknown) => {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2) + "\n");
};

/** Lê argumentos no formato --chave valor (ou --flag). */
export const args = (): Record<string, string> => {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true";
    out[k] = v;
  }
  return out;
};

const pegar = (ctx: any, caminho: string) => caminho.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);

/**
 * Preenche {{variáveis}} com dados do contexto (produto, ângulo, gancho...).
 * - Se o texto for só "{{x}}" e x for lista/objeto/número, devolve o valor original.
 * - Variável ausente vira erro, para o motor nunca gerar um criativo com buraco.
 */
export const preencher = (modelo: unknown, ctx: any, onde = "modelo"): any => {
  if (typeof modelo === "string") {
    const inteiro = modelo.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (inteiro) {
      const v = pegar(ctx, inteiro[1]);
      if (v === undefined) throw new Error(`Variável {{${inteiro[1]}}} não encontrada (${onde})`);
      return v;
    }
    return modelo.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = pegar(ctx, k);
      if (v === undefined) throw new Error(`Variável {{${k}}} não encontrada (${onde})`);
      return Array.isArray(v) ? v.join(" ") : String(v);
    });
  }
  if (Array.isArray(modelo)) return modelo.map((m, i) => preencher(m, ctx, `${onde}[${i}]`));
  if (modelo && typeof modelo === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(modelo)) out[k] = preencher(v, ctx, `${onde}.${k}`);
    return out;
  }
  return modelo;
};

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

export const contarPalavras = (s: string) => s.split(/\s+/).filter(Boolean).length;

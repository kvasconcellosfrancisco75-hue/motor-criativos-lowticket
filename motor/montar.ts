/**
 * Monta as cenas de uma fórmula para um ângulo e um gancho. Usado pela criação (para checar a
 * duração antes de aprovar) e pelos roteiros (para gerar o lote).
 */
import fs from "node:fs";
import path from "node:path";
import type { Cena } from "../src/tipos";
import { tempoEstimado } from "./tempo";
import { lerJSON, preencher } from "./util";

export const RAIZ = path.resolve(__dirname, "..");

export const carregarFormulas = (): any[] =>
  fs
    .readdirSync(path.join(RAIZ, "formulas"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => lerJSON(path.join(RAIZ, "formulas", f)));

const ehObjeto = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Junta a copy criada para o ângulo por cima da ficha (listas e textos da copy substituem os da ficha). */
export const mesclar = (base: any, extra: any): any => {
  if (!ehObjeto(base) || !ehObjeto(extra)) return extra === undefined ? base : extra;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = mesclar(base[k], v);
  return out;
};

/** O produto visto por um ângulo: a ficha com a copy daquele ângulo aplicada.
 *  "personagem_por_angulo" na ficha troca poses só naquele ângulo (ex.: { "outro-nicho": { "neutra": "dancinha.png" } }). */
export const produtoDoAngulo = (produto: any, angulo: any) => {
  const p = mesclar(produto, angulo.copy ?? {});
  const poses = produto.personagem_por_angulo?.[angulo.id];
  return poses ? { ...p, personagem: { ...(p.personagem ?? {}), ...poses } } : p;
};

const preencherSeguro = (m: string, ctx: any) => {
  try {
    return preencher(m, ctx);
  } catch {
    return undefined;
  }
};

export const montarCenas = (formula: any, produto: any, angulo: any, gancho: any): Cena[] => {
  const p = produtoDoAngulo(produto, angulo);
  const ctx = { produto: p, p, angulo, gancho };
  // Cenas com "requer" só entram se o produto tiver aquele dado (ex.: ativo de vídeo).
  return formula.cenas
    .filter((c: any) => !c.requer || preencherSeguro(`{{${c.requer}}}`, ctx))
    .map((c: any, i: number) => {
      const { requer, ...resto } = c;
      const cena = preencher(resto, ctx, `${formula.id}.cenas[${i}]`);
      if (cena.personagem && !p.personagem?.[cena.personagem]) delete cena.personagem;
      else if (cena.personagem) cena.personagem = p.personagem[cena.personagem];
      return cena;
    });
};

export const narracaoDe = (cenas: Cena[]) => cenas.map((c) => c.fala).join(" ").replace(/\s+/g, " ").trim();
export const segundosEstimados = (cenas: Cena[], ritmo?: number) => tempoEstimado(cenas, ritmo).reduce((x, y) => x + y, 0) / 30;

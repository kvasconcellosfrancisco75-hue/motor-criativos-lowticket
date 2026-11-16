import type { Cena } from "../src/tipos";
import { FPS } from "../src/tipos";
import { contarPalavras } from "./util";

export type Palavra = { w: string; s: number; e: number };

/** Ritmo médio de narração usado quando ainda não existe áudio (palavras por segundo).
 *  Cada produto pode trocar com "ritmo_fala" na ficha, medido num criativo aprovado. */
export const RITMO = 2.8;
/** Tempo que o último quadro (o botão do CTA) fica na tela depois da fala. */
const RESPIRO_FINAL = 1.5;
/** Antecipação do corte em relação à primeira palavra de cada cena (a troca começa um pouco antes). */
const ANTECIPA = 0.1;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Sem áudio: estima a duração de cada cena pelo número de palavras faladas. */
export const tempoEstimado = (cenas: Cena[], ritmo = RITMO): number[] =>
  cenas.map((c, i) => {
    const seg = Math.max(1.3, contarPalavras(c.fala) / ritmo + 0.3) + (i === cenas.length - 1 ? RESPIRO_FINAL : 0);
    return Math.round(seg * FPS);
  });

/**
 * Com áudio transcrito (palavras com tempo): corta cada cena no início da sua primeira palavra.
 * A busca é tolerante a erros da transcrição (ex.: "cem" vs "100"): procura uma das três primeiras
 * palavras da fala numa janela à frente; se não achar, distribui pelo número de palavras.
 */
export const tempoPelaFala = (cenas: Cena[], palavras: Palavra[]): number[] => {
  const tokens = palavras.map((p) => ({ ...p, n: norm(p.w) }));
  const inicios: number[] = [];
  let cursor = 0;
  for (const c of cenas) {
    const alvo = c.fala.split(/\s+/).map(norm).filter(Boolean);
    let achou = -1;
    for (let k = 0; k < Math.min(3, alvo.length) && achou < 0; k++) {
      for (let j = cursor; j < Math.min(tokens.length, cursor + 8 + k); j++) {
        if (tokens[j].n === alvo[k]) {
          achou = Math.max(cursor, j - k);
          break;
        }
      }
    }
    if (achou < 0) achou = Math.min(tokens.length - 1, cursor);
    inicios.push(tokens[achou]?.s ?? 0);
    cursor = Math.min(tokens.length - 1, achou + Math.max(1, alvo.length - 1));
  }
  const fim = (tokens[tokens.length - 1]?.e ?? 0) + RESPIRO_FINAL;
  const cortes = inicios.map((t, i) => (i === 0 ? 0 : Math.max(0, t - ANTECIPA)));
  return cortes.map((t, i) => {
    const prox = i + 1 < cortes.length ? cortes[i + 1] : fim;
    return Math.max(Math.round(0.8 * FPS), Math.round((prox - t) * FPS));
  });
};

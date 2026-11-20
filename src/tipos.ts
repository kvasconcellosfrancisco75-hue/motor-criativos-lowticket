/** Tipos compartilhados entre o motor (Node) e as cenas (Remotion). */

export type Formato = "9x16" | "4x5";

export const DIMENSOES: Record<Formato, { width: number; height: number }> = {
  "9x16": { width: 1080, height: 1920 },
  "4x5": { width: 1080, height: 1350 },
};

export type Tom = "claro" | "escuro" | "destaque";

/** Identidade visual do produto (vem de produto.json → visual). */
export type Tema = {
  claro: string;
  escuro: string;
  destaque: string;
  texto: string;
  fonteTitulo: string;
  fonteCitacao: string;
  /** Escala da imagem da personagem (ficha: visual.escala_personagem). Abaixo de 1, a imagem é tratada como ícone: quadrada e acima da borda. */
  escalaPersonagem?: number;
};

export type TipoCena =
  | "titulo"
  | "citacao"
  | "contador"
  | "lista"
  | "prova-video"
  | "batidas"
  | "preco"
  | "cta";

/** Uma cena já resolvida (sem {{variáveis}}), pronta para renderizar. */
export type Cena = {
  tipo: TipoCena;
  /** Texto falado na narração durante esta cena. Usado para calcular o tempo. */
  fala: string;
  tom?: Tom;
  /** Arquivo de imagem da personagem, relativo à pasta de ativos do produto. */
  personagem?: string;
  dados: Record<string, unknown>;
};

export type PropsCriativo = {
  formato: Formato;
  tema: Tema;
  cenas: Cena[];
  /** Duração de cada cena em quadros (calculada pelo motor). */
  duracoes: number[];
  /** Arquivo de narração dentro da pasta pública da renderização (opcional). */
  audio?: string;
};

export const FPS = 30;

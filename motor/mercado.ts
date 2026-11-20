/**
 * Os três mercados centrais (Russell Brunson, "DotCom Secrets"): saúde, dinheiro e relacionamento.
 * Toda compra nasce do desejo de melhorar uma dessas áreas, mas não se vende no nível do mercado:
 * desce-se para um submercado e dali para um nicho (um público específico com um problema específico).
 *
 *   Mercado (desejo central) → Submercado          → Nicho
 *   saude                     → alimentação prática → receitas rápidas para quem trabalha fora
 *
 * Na ficha:
 *   "mercado": {
 *     "central": "saude" | "dinheiro" | "relacionamento",
 *     "submercado": "alimentação prática",
 *     "nicho": "receitas rápidas para quem trabalha fora e chega cansado",
 *     "termos_nicho": ["receita", "cozinh", "jantar", "delivery"]
 *   }
 *
 * Este módulo dá à criação os cuidados de política de cada mercado, recusa ganchos genéricos de mercado
 * e dá às referências um peso maior quando falam do mesmo submercado.
 */

export type Central = "saude" | "dinheiro" | "relacionamento";

export type Mercado = {
  central: Central;
  submercado?: string;
  nicho?: string;
  termos_nicho: string[];
};

/** Sem acento e em minúsculas, para comparar texto. */
export const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SINONIMOS: Record<string, Central> = {
  saude: "saude",
  dinheiro: "dinheiro",
  riqueza: "dinheiro",
  financas: "dinheiro",
  relacionamento: "relacionamento",
  relacionamentos: "relacionamento",
};

/** Lê o bloco "mercado" da ficha. Sem ele (fichas antigas) devolve null e nada muda. */
export function lerMercado(produto: any): Mercado | null {
  const m = produto?.mercado;
  if (!m) return null;
  const bruto = typeof m === "string" ? m : m.central;
  const central = SINONIMOS[sem(String(bruto ?? "")).trim()];
  if (!central) throw new Error(`mercado.central inválido na ficha: "${bruto}". Use "saude", "dinheiro" ou "relacionamento".`);
  return {
    central,
    submercado: typeof m === "object" ? m.submercado : undefined,
    nicho: typeof m === "object" ? m.nicho : undefined,
    termos_nicho: (typeof m === "object" ? m.termos_nicho ?? [] : []).map((t: string) => sem(t)).filter(Boolean),
  };
}

export const NOME: Record<Central, string> = { saude: "Saúde", dinheiro: "Dinheiro", relacionamento: "Relacionamento" };

/** Cuidados de política de anúncios (Meta) mais cobrados em cada mercado. Entram nas instruções da criação. */
export const CUIDADOS: Record<Central, string[]> = {
  saude: [
    "sem antes e depois, nem em palavras (\"eu era assim, hoje estou assim\")",
    "sem prometer perda de peso, medida, cura ou resultado em prazo (\"perca 5 kg em 30 dias\")",
    "sem apontar o corpo ou a condição de quem assiste (\"você está acima do peso\", \"você que tem diabetes\")",
    "sem prometer resultado de saúde que o produto não entrega por si",
  ],
  dinheiro: [
    "sem prometer ganho em valor ou em prazo (\"ganhe 5 mil por mês\", \"primeira venda em 7 dias\")",
    "sem \"fique rico\", \"dinheiro fácil\", \"renda garantida\" ou print de ganhos",
    "sem afirmar a situação financeira de quem assiste (\"você que está endividado\")",
    "o resultado depende do esforço da pessoa: fale do caminho e do que ela recebe, não de quanto vai ganhar",
  ],
  relacionamento: [
    "sem afirmar o estado civil, a orientação ou a situação amorosa de quem assiste (\"você que foi traída\", \"você que está solteiro\")",
    "sem prometer que alguém volta, se apaixona ou fica (\"faça ele voltar em 7 dias\")",
    "sem técnicas de manipulação ou de controle do outro",
    "fale do que a pessoa faz e sente, não do que o outro vai fazer",
  ],
};

/** Promessas de mercado: servem para qualquer produto do mercado. Um gancho que se apoia nelas não desceu ao nicho. */
const GENERICOS: Record<Central, string[]> = {
  saude: ["emagrecer", "emagrecimento", "perder peso", "perca peso", "queimar gordura", "vida saudavel", "mais saude", "ficar saudavel", "corpo dos sonhos", "barriga chapada", "secar a barriga"],
  dinheiro: ["ganhar dinheiro", "ganhe dinheiro", "renda extra", "ficar rico", "fique rico", "enriquecer", "liberdade financeira", "independencia financeira", "dinheiro na internet", "dinheiro online", "renda passiva", "dinheiro facil"],
  relacionamento: ["reconquistar", "reconquiste", "encontrar o amor", "alma gemea", "salvar seu casamento", "salvar o casamento", "ter ele de volta", "fazer ele voltar", "conquistar qualquer"],
};

/** Expressões de mercado que aparecem no texto (para recusar gancho genérico). */
export function genericosNo(texto: string, m: Mercado): string[] {
  const t = sem(texto);
  return GENERICOS[m.central].filter((g) => t.includes(g));
}

/** O texto toca o nicho? Os termos valem como prefixo ("cozinh" pega "cozinhar" e "cozinha"). */
export function falaDoNicho(texto: string, termos: string[]): boolean {
  if (!termos.length) return true;
  const palavras = sem(texto).split(/[^a-z0-9]+/);
  return termos.some((t) => (t.includes(" ") ? sem(texto).includes(t) : palavras.some((p) => p.startsWith(t))));
}

const ATRIBUTO_SENSIVEL =
  /\bvoce\s+(que\s+)?(e|esta|ta|foi|vive|anda|ficou)\s+(muito\s+)?(gord|obes|acima do peso|diabetic|hipertens|ansios|deprimid|doente|endividad|falid|quebrad|pobre|sem dinheiro|desempregad|traid|divorciad|separad|solteir|abandonad|carente)/;

const REGRAS: Record<Central, { re: RegExp; msg: string }[]> = {
  saude: [
    { re: /\bantes e depois\b/, msg: "antes e depois" },
    { re: /\b(perd|perc|elimin|emagrec|sec|tir)\w*\s+(\S+\s+){0,4}(quilos?|kg|kilos?|medidas?|centimetros?)\b/, msg: "promessa de perda de peso ou medida" },
    { re: /\b(cura|curar|cure|reverte|reverter)\b/, msg: "promessa de cura" },
  ],
  dinheiro: [
    { re: /\b(ganh|fatur|lucr|embols|receb)\w*\s+(\S+\s+){0,5}(reais|r\$|mil (reais|por|no|ao)|por mes|por dia|por semana)/, msg: "promessa de ganho em valor ou prazo" },
    { re: /\b(fique rico|ficar rico|dinheiro facil|renda garantida|ganho garantido|lucro garantido)\b/, msg: "promessa de dinheiro fácil ou garantido" },
  ],
  relacionamento: [
    { re: /\b(fa[cz]\w*|ter|traz\w*|trazer)\s+(ele|ela|o|a)?\s*(\S+\s+)?(de\s+)?volta(r)?\b/, msg: "promessa de que a pessoa volta" },
    { re: /\b(ele|ela)\s+(vai|vao)\s+(voltar|se apaixonar|implorar|correr atras)/, msg: "promessa sobre o que o outro vai fazer" },
  ],
};

/** Problemas de política no texto, de acordo com o mercado. Vale também sem mercado na ficha (atributos sensíveis). */
export function problemasDePolitica(texto: string, m: Mercado | null): string[] {
  const t = sem(texto);
  const p: string[] = [];
  if (ATRIBUTO_SENSIVEL.test(t)) p.push("afirma um atributo pessoal sensível de quem assiste");
  if (m) for (const r of REGRAS[m.central]) if (r.re.test(t)) p.push(r.msg);
  return p;
}

/** Bloco para as instruções da criação: onde o produto está e o que o mercado exige. */
export function instrucoesDeMercado(m: Mercado | null): string {
  if (!m) return "";
  return `
Mercado, submercado e nicho (os três mercados centrais de Russell Brunson: saúde, dinheiro e relacionamento):
- Mercado central: ${NOME[m.central]}${m.submercado ? ` → submercado: ${m.submercado}` : ""}${m.nicho ? ` → nicho: ${m.nicho}` : ""}.
- Escreva no nível do NICHO, nunca no do mercado. Um gancho que serviria para qualquer produto de ${NOME[m.central].toLowerCase()} ("${GENERICOS[m.central].slice(0, 3).join("\", \"")}") não para ninguém e será recusado. Mostre a pessoa do nicho numa situação que só ela vive.
- Apresente o produto como uma oportunidade nova (um jeito diferente de resolver), não como "mais um" do mercado.${m.termos_nicho.length ? `\n- Todo gancho precisa tocar o nicho com pelo menos um destes termos (ou a chamada do público): ${m.termos_nicho.join(", ")}.` : ""}
- Cuidados de política deste mercado:
${CUIDADOS[m.central].map((c) => `  - ${c}`).join("\n")}
`;
}

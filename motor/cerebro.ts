/**
 * O cérebro do produto: a memória do que já foi testado no ar e do que funcionou.
 *
 *   npm run cerebro -- --produto <pasta>                     # atualiza e mostra cerebro/cerebro.md
 *   npm run cerebro -- --produto <pasta> --licao "texto"     # anota uma lição sua (vai para a próxima criação)
 *
 * Fica em <produto>/cerebro/:
 *   resultados.json — números de cada variação no ar (importados com `npm run resultados`)
 *   licoes.md       — o que você aprendeu e quer que o motor leve em conta (uma lição por linha, "- ...")
 *   cerebro.md      — o resumo: vencedores, perdedores e padrões por tipo de gancho, base, consciência e fórmula
 *
 * A criação (`npm run criar`) lê o cérebro antes de pedir ângulos novos: explora a mecânica dos vencedores,
 * evita a dos perdedores e segue as lições. Como a ficha fica numa pasta privada, o cérebro fica junto dela.
 */
import fs from "node:fs";
import path from "node:path";
import { anotarNoCofre, cofreDe, licoesDoCofre } from "./cofre";
import { args, lerJSON, salvarJSON } from "./util";

export type Numeros = { gasto: number; impressoes: number; plays3s: number; cliques: number; compras: number; receita: number };

export type Resultado = Numeros & {
  variacao: string;
  criacao: string;
  formula: string;
  formato: string;
  angulo: string;
  base?: string;
  consciencia?: string;
  dor?: string;
  gancho: string;
  tipo_gancho?: string;
  referencia?: string;
  anuncios: string[];
  atualizado_em: string;
};

export type Importacao = { data: string; arquivo: string; linhas: number; casadas: number; sem_par: string[] };

export type Cerebro = { produto: string; resultados: Record<string, Resultado>; importacoes: Importacao[] };

export type Veredito = "vencedor" | "promissor" | "em_teste" | "perdedor";

export const pastaCerebro = (pastaProduto: string) => path.join(pastaProduto, "cerebro");

export function lerCerebro(pastaProduto: string, produtoId = ""): Cerebro {
  const arq = path.join(pastaCerebro(pastaProduto), "resultados.json");
  return fs.existsSync(arq) ? lerJSON<Cerebro>(arq) : { produto: produtoId, resultados: {}, importacoes: [] };
}

export const salvarCerebro = (pastaProduto: string, c: Cerebro) => salvarJSON(path.join(pastaCerebro(pastaProduto), "resultados.json"), c);

/** Lições de cerebro/licoes.md e, com o Obsidian configurado, da nota Lições do cofre. */
export function lerLicoes(pastaProduto: string, produto?: any): string[] {
  const cofre = produto ? cofreDe(pastaProduto, produto) : undefined;
  return [...new Set([...lerLicoesLocais(pastaProduto), ...(cofre ? licoesDoCofre(cofre, produto) : [])])];
}

export function lerLicoesLocais(pastaProduto: string): string[] {
  const arq = path.join(pastaCerebro(pastaProduto), "licoes.md");
  if (!fs.existsSync(arq)) return [];
  return fs
    .readFileSync(arq, "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((l): l is string => Boolean(l));
}

export function anotarLicao(pastaProduto: string, texto: string) {
  const arq = path.join(pastaCerebro(pastaProduto), "licoes.md");
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  if (!fs.existsSync(arq)) fs.writeFileSync(arq, "# Lições\n\nUma lição por linha, começando com \"- \". A criação lê todas.\n\n");
  fs.appendFileSync(arq, `- ${texto.trim()} (${new Date().toISOString().slice(0, 10)})\n`);
}

/**
 * Metas do produto (ficha, campo "cerebro"):
 *   cpa_alvo     — custo por compra que ainda dá lucro. Padrão: o preço da oferta (empate no front; os order bumps são o lucro).
 *   gasto_minimo — quanto uma variação precisa gastar antes de ser julgada. Padrão: 2 × cpa_alvo.
 */
export function metas(produto: any) {
  const cpa = Number(produto.cerebro?.cpa_alvo ?? produto.oferta?.valor ?? 30);
  return { cpa_alvo: cpa, gasto_minimo: Number(produto.cerebro?.gasto_minimo ?? cpa * 2) };
}

const div = (a: number, b: number) => (b > 0 ? a / b : undefined);

export const indicadores = (n: Numeros) => ({
  /** Taxa de gancho: de quem viu o anúncio, quantos assistiram 3 segundos. É o termômetro do gancho. */
  gancho: div(n.plays3s, n.impressoes),
  ctr: div(n.cliques, n.impressoes),
  cpa: div(n.gasto, n.compras),
  roas: div(n.receita, n.gasto),
});

export function veredito(n: Numeros, m: ReturnType<typeof metas>): Veredito {
  const cpa = div(n.gasto, n.compras);
  const bom = cpa !== undefined && cpa <= m.cpa_alvo;
  if (n.gasto < m.gasto_minimo) return bom ? "promissor" : "em_teste";
  return bom ? "vencedor" : "perdedor";
}

const somar = (lista: Numeros[]): Numeros =>
  lista.reduce((s, r) => ({ gasto: s.gasto + r.gasto, impressoes: s.impressoes + r.impressoes, plays3s: s.plays3s + r.plays3s, cliques: s.cliques + r.cliques, compras: s.compras + r.compras, receita: s.receita + r.receita }), {
    gasto: 0,
    impressoes: 0,
    plays3s: 0,
    cliques: 0,
    compras: 0,
    receita: 0,
  });

/** Um gancho é o que se testa: soma os formatos e as fórmulas em que ele rodou. */
export type Gancho = Numeros & { angulo: string; gancho: string; tipo_gancho?: string; base?: string; consciencia?: string; dor?: string; referencia?: string; variacoes: number; veredito: Veredito };

export function porGancho(c: Cerebro, m: ReturnType<typeof metas>): Gancho[] {
  const grupos = new Map<string, Resultado[]>();
  for (const r of Object.values(c.resultados)) {
    const k = `${r.angulo}|${r.gancho}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  return [...grupos.values()].map((rs) => {
    const n = somar(rs);
    const r = rs[0];
    return { ...n, angulo: r.angulo, gancho: r.gancho, tipo_gancho: r.tipo_gancho, base: r.base, consciencia: r.consciencia, dor: r.dor, referencia: r.referencia, variacoes: rs.length, veredito: veredito(n, m) };
  });
}

/** Ordem: vencedores pelo menor CPA; sem compras, pela taxa de gancho. */
const ordem = (x: Gancho, y: Gancho) => (indicadores(x).cpa ?? Infinity) - (indicadores(y).cpa ?? Infinity) || (indicadores(y).gancho ?? 0) - (indicadores(x).gancho ?? 0);

export type Padrao = Numeros & { valor: string; ganchos: number };

/** Junta os números por uma característica (tipo de gancho, base do ângulo...) para ver o que puxa o resultado. */
export function padroes(c: Cerebro, campo: keyof Resultado): Padrao[] {
  const grupos = new Map<string, Resultado[]>();
  for (const r of Object.values(c.resultados)) {
    const v = String(r[campo] ?? "").trim();
    if (!v || v === "nenhuma") continue;
    grupos.set(v, [...(grupos.get(v) ?? []), r]);
  }
  return [...grupos.entries()]
    .map(([valor, rs]) => ({ ...somar(rs), valor, ganchos: new Set(rs.map((r) => `${r.angulo}|${r.gancho}`)).size }))
    .sort((x, y) => (indicadores(x).cpa ?? Infinity) - (indicadores(y).cpa ?? Infinity) || (indicadores(y).gancho ?? 0) - (indicadores(x).gancho ?? 0));
}

const pct = (v?: number) => (v === undefined ? "–" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const brl = (v?: number) => (v === undefined ? "–" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const x = (v?: number) => (v === undefined ? "–" : `${v.toFixed(2).replace(".", ",")}x`);

const DIMENSOES: [keyof Resultado, string][] = [
  ["tipo_gancho", "Tipo de gancho"],
  ["base", "Base do ângulo"],
  ["consciencia", "Nível de consciência"],
  ["formula", "Fórmula"],
  ["formato", "Formato"],
];

/** O resumo legível (cerebro.md). */
export function resumo(pastaProduto: string, produto: any): string {
  const c = lerCerebro(pastaProduto, produto.id);
  const m = metas(produto);
  const gs = porGancho(c, m).sort(ordem);
  const licoes = lerLicoes(pastaProduto, produto);
  const total = somar(Object.values(c.resultados));
  const it = indicadores(total);
  const md = [
    `# Cérebro · ${produto.nome}`,
    "",
    `Meta: CPA até ${brl(m.cpa_alvo)}; cada gancho é julgado depois de gastar ${brl(m.gasto_minimo)} (ficha, campo "cerebro").`,
    c.importacoes.length ? `Última importação: ${c.importacoes[c.importacoes.length - 1].data}.` : "Ainda sem resultados. Importe com `npm run resultados`.",
    "",
  ];
  if (gs.length) {
    md.push(
      `**No total:** ${brl(total.gasto)} gastos, ${total.compras} compras, CPA ${brl(it.cpa)}, taxa de gancho ${pct(it.gancho)}, CTR ${pct(it.ctr)}, ROAS ${x(it.roas)}.`,
      "",
      "## Ganchos",
      "",
      "| Veredito | Ângulo | Tipo | Gancho | Gasto | Compras | CPA | Gancho 3 s | CTR |",
      "|---|---|---|---|---|---|---|---|---|",
      ...gs.map((g) => {
        const i = indicadores(g);
        return `| ${g.veredito.replace("_", " ")} | ${g.angulo} | ${g.tipo_gancho ?? "–"} | ${g.gancho} | ${brl(g.gasto)} | ${g.compras} | ${brl(i.cpa)} | ${pct(i.gancho)} | ${pct(i.ctr)} |`;
      }),
      "",
      "## Padrões",
      "",
      "O que puxa o resultado, somando todos os ganchos que têm a mesma característica.",
      "",
    );
    for (const [campo, titulo] of DIMENSOES) {
      const ps = padroes(c, campo);
      if (ps.length < 2) continue;
      md.push(`**${titulo}**`, "", "| | Ganchos | Gasto | Compras | CPA | Gancho 3 s |", "|---|---|---|---|---|---|");
      for (const p of ps) {
        const i = indicadores(p);
        md.push(`| ${p.valor} | ${p.ganchos} | ${brl(p.gasto)} | ${p.compras} | ${brl(i.cpa)} | ${pct(i.gancho)} |`);
      }
      md.push("");
    }
  }
  md.push("## Lições", "", ...(licoes.length ? licoes.map((l) => `- ${l}`) : ["Nenhuma ainda. Anote com `npm run cerebro -- --produto <pasta> --licao \"...\"`."]), "");
  const semPar = c.importacoes[c.importacoes.length - 1]?.sem_par ?? [];
  if (semPar.length) md.push("## Anúncios sem variação correspondente na última importação", "", ...semPar.map((s) => `- ${s}`), "");
  return md.join("\n");
}

/** O trecho do pedido da criação: o que os resultados ensinaram. Vazio quando o cérebro ainda não tem nada. */
export function paraCriacao(pastaProduto: string, produto: any): string {
  const c = lerCerebro(pastaProduto, produto.id);
  const m = metas(produto);
  const gs = porGancho(c, m);
  const licoes = lerLicoes(pastaProduto, produto);
  if (!gs.length && !licoes.length) return "";
  const desc = (g: Gancho) => {
    const i = indicadores(g);
    return `- "${g.gancho}" (${g.tipo_gancho ? `gancho ${g.tipo_gancho}, ` : ""}ângulo ${g.angulo}${g.base ? ` · base ${g.base}` : ""}${g.consciencia ? ` · consciência ${g.consciencia}` : ""}${g.dor ? ` · dor: ${g.dor}` : ""}) — ${g.compras} compra${g.compras === 1 ? "" : "s"}, CPA ${brl(i.cpa)}, taxa de gancho ${pct(i.gancho)}`;
  };
  const bons = gs.filter((g) => g.veredito === "vencedor" || g.veredito === "promissor").sort(ordem).slice(0, 5);
  const ruins = gs.filter((g) => g.veredito === "perdedor").sort((a, b) => (indicadores(a).gancho ?? 0) - (indicadores(b).gancho ?? 0)).slice(0, 5);
  const partes: string[] = [`O QUE OS RESULTADOS NO AR ENSINARAM (cérebro do produto; meta de CPA ${brl(m.cpa_alvo)}):`];
  if (bons.length) partes.push("Ganchos que venderam dentro da meta (explore a MECÂNICA deles com palavras novas, sem repetir nem parafrasear):", ...bons.map(desc));
  if (ruins.length) partes.push("Ganchos que gastaram e não deram resultado (evite a mesma mecânica e a mesma dor):", ...ruins.map(desc));
  for (const [campo, titulo] of DIMENSOES.slice(0, 3)) {
    const ps = padroes(c, campo).filter((p) => p.gasto >= m.gasto_minimo);
    if (ps.length >= 2) partes.push(`${titulo}, do melhor para o pior CPA: ${ps.map((p) => `${p.valor} (${brl(indicadores(p).cpa)})`).join(", ")}.`);
  }
  if (licoes.length) partes.push("Lições anotadas por quem roda os anúncios (siga-as):", ...licoes.map((l) => `- ${l}`));
  partes.push("Distribua a rodada: a maior parte dos ângulos aproveita o que venceu; pelo menos um explora uma base ou um tipo de gancho ainda não testado, para o cérebro continuar aprendendo.");
  return partes.join("\n");
}

if (require.main === module) {
  const a = args();
  if (!a.produto) {
    console.error('Uso: npm run cerebro -- --produto <pasta> [--licao "texto"]');
    process.exit(1);
  }
  const pasta = path.resolve(a.produto);
  const produto = lerJSON(path.join(pasta, "produto.json"));
  const cofre = cofreDe(pasta, produto, a.cofre);
  if (a.licao && a.licao !== "true") {
    if (cofre) anotarNoCofre(cofre, produto, a.licao);
    else anotarLicao(pasta, a.licao);
    console.log(`Lição anotada${cofre ? " na nota Lições do Obsidian" : ` em ${path.join(pastaCerebro(pasta), "licoes.md")}`}. A próxima criação vai levar em conta.`);
  }
  const md = resumo(pasta, produto);
  fs.mkdirSync(pastaCerebro(pasta), { recursive: true });
  fs.writeFileSync(path.join(pastaCerebro(pasta), "cerebro.md"), md);
  console.log(md);
  // Carregado só aqui: o obsidian.ts também usa este arquivo.
  if (cofre) require("./obsidian").sincronizar(pasta, produto, a.cofre);
}

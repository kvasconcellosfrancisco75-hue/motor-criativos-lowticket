/**
 * Utilitários do cofre do Obsidian: onde ele fica, como ler e escrever notas sem apagar o que você escreveu.
 *
 * Toda nota que o motor escreve tem:
 *  - propriedades (frontmatter): as do motor são reescritas; as suas (tags, etc.) ficam; "aprovado" é seu depois da 1ª vez;
 *  - um trecho entre %% motor:inicio %% e %% motor:fim %%, reescrito a cada exportação;
 *  - o resto da nota, que é seu e nunca é tocado.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Onde está o cofre, nesta ordem: --cofre, o campo "obsidian.cofre" da ficha (relativo à pasta do produto)
 * ou a variável OBSIDIAN_COFRE. Sem nenhum deles, o motor segue sem Obsidian.
 */
export function cofreDe(pastaProduto?: string, produto?: any, arg?: string): string | undefined {
  if (arg && arg !== "true") return path.resolve(arg);
  if (produto?.obsidian?.cofre && pastaProduto) return path.resolve(pastaProduto, produto.obsidian.cofre);
  if (process.env.OBSIDIAN_COFRE) return path.resolve(process.env.OBSIDIAN_COFRE);
  return undefined;
}

/** Pasta do motor dentro do cofre (o resto do cofre é seu). */
export const RAIZ_COFRE = "Motor";

/** Nome de arquivo aceito pelo Obsidian em qualquer sistema (sem \ / : * ? " < > | # ^ [ ]). */
export const nomeArquivo = (s: string, max = 70) => {
  const t = s.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
  return (t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t).replace(/[.\s]+$/, "") || "sem nome";
};

/** Link para usar dentro de tabela: o "|" do apelido precisa de escape. */
export const linkT = (caminho: string, texto?: string) => link(caminho, texto).replace("|", "\\|");

/** Link para uma nota pelo caminho dentro do cofre (sem .md), com texto opcional. */
export const link = (caminho: string, texto?: string) => `[[${caminho.replace(/\.md$/, "")}${texto ? `|${texto.replace(/[|\]]/g, "")}` : ""}]]`;

const INICIO = "%% motor:inicio · este trecho é reescrito pelo motor; escreva fora dele %%";
const FIM = "%% motor:fim %%";

type Blocos = { chaves: string[]; brutos: Map<string, string> };

/** Lê o frontmatter guardando o texto original de cada propriedade (inclusive listas em várias linhas). */
function lerBlocos(fm: string): Blocos {
  const chaves: string[] = [];
  const brutos = new Map<string, string>();
  let atual = "";
  for (const linha of fm.split(/\r?\n/)) {
    const m = linha.match(/^([^\s#][^:]*):(.*)$/);
    if (m) {
      atual = m[1].trim();
      chaves.push(atual);
      brutos.set(atual, linha);
    } else if (atual) brutos.set(atual, brutos.get(atual) + "\n" + linha);
  }
  return { chaves, brutos };
}

const valor = (bruto: string): unknown => {
  const v = bruto.slice(bruto.indexOf(":") + 1).trim();
  if (v === "") return undefined;
  if (/^(true|sim)$/i.test(v)) return true;
  if (/^(false|não|nao)$/i.test(v)) return false;
  try {
    return JSON.parse(v);
  } catch {
    return v.replace(/^['"]|['"]$/g, "");
  }
};

export type Nota = { props: Record<string, unknown>; blocos: Blocos; corpo: string };

export function lerNota(arquivo: string): Nota | undefined {
  if (!fs.existsSync(arquivo)) return undefined;
  const t = fs.readFileSync(arquivo, "utf8");
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const blocos = lerBlocos(m?.[1] ?? "");
  const props: Record<string, unknown> = {};
  for (const k of blocos.chaves) props[k] = valor(blocos.brutos.get(k)!.split("\n")[0]);
  return { props, blocos, corpo: m ? t.slice(m[0].length) : t };
}

const yaml = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) || typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Escreve (ou atualiza) uma nota do motor.
 * meus: propriedades que, depois de criadas, passam a ser suas (ex.: "aprovado"). O valor do motor só entra na 1ª vez.
 * extra: texto que vai fora do trecho do motor quando a nota é nova (ex.: "## Minhas notas").
 */
export function escreverNota(arquivo: string, props: Record<string, unknown>, conteudo: string, opc: { meus?: string[]; extra?: string } = {}) {
  const velha = lerNota(arquivo);
  const linhas: string[] = [];
  const motor = new Set(Object.keys(props));
  for (const [k, v] of Object.entries(props)) {
    if (velha && opc.meus?.includes(k) && velha.blocos.brutos.has(k)) linhas.push(velha.blocos.brutos.get(k)!);
    else if (v !== undefined) linhas.push(`${k}: ${yaml(v)}`);
  }
  for (const k of velha?.blocos.chaves ?? []) if (!motor.has(k)) linhas.push(velha!.blocos.brutos.get(k)!);
  const trecho = `${INICIO}\n${conteudo.trim()}\n${FIM}`;
  let corpo: string;
  if (!velha) corpo = `${trecho}\n${opc.extra ? `\n${opc.extra}\n` : ""}`;
  else {
    const i = velha.corpo.indexOf("%% motor:inicio");
    const f = velha.corpo.indexOf(FIM);
    corpo = i >= 0 && f > i ? velha.corpo.slice(0, i) + trecho + velha.corpo.slice(f + FIM.length) : `${trecho}\n\n${velha.corpo}`;
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, `---\n${linhas.join("\n")}\n---\n${corpo}`);
}

/** Todas as notas .md de uma pasta do cofre (com subpastas). */
export function notas(pasta: string): string[] {
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(pasta, e.name);
    return e.isDirectory() ? (e.name.startsWith(".") ? [] : notas(p)) : e.name.endsWith(".md") ? [p] : [];
  });
}

export const pastaProdutoNoCofre = (cofre: string, produto: any) => path.join(cofre, RAIZ_COFRE, "Produtos", nomeArquivo(produto.nome ?? produto.id));
export const arquivoLicoes = (cofre: string, produto: any) => path.join(pastaProdutoNoCofre(cofre, produto), "Lições.md");

/**
 * Lições escritas no Obsidian: cada linha que começa com "- " (ou "- [ ] ") é uma lição.
 * Para desligar uma sem apagar, marque a caixinha ("- [x] ") ou risque o texto (~~assim~~).
 */
export function licoesDoCofre(cofre: string, produto: any): string[] {
  const arq = arquivoLicoes(cofre, produto);
  if (!fs.existsSync(arq)) return [];
  const corpo = fs.readFileSync(arq, "utf8").replace(/^---[\s\S]*?\n---\n/, "").replace(/%%[\s\S]*?%%/g, "");
  return corpo
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m) && !/x/i.test(m![1] ?? "") && !/^~~.*~~$/.test(m![2].trim()))
    .map((m) => m[2].trim())
    .filter(Boolean);
}

export function anotarNoCofre(cofre: string, produto: any, texto: string) {
  const arq = arquivoLicoes(cofre, produto);
  if (!fs.existsSync(arq)) criarLicoes(cofre, produto);
  fs.appendFileSync(arq, `- ${texto.trim()} (${new Date().toISOString().slice(0, 10)})\n`);
}

export function criarLicoes(cofre: string, produto: any, iniciais: string[] = []) {
  const arq = arquivoLicoes(cofre, produto);
  if (fs.existsSync(arq)) return;
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(
    arq,
    [
      "---",
      'categoria: "licoes"',
      `produto: ${JSON.stringify(produto.nome)}`,
      "---",
      `# Lições · ${produto.nome}`,
      "",
      "%% A próxima criação (npm run criar) lê cada linha que começa com \"- \". Escreva o que você percebeu nos anúncios:",
      "o que segura, o que o público responde, o que não funciona. Para desligar uma lição sem apagar, marque a caixinha",
      "(- [x]) ou risque o texto (~~assim~~). Esta nota é sua: o motor só acrescenta linhas no fim. %%",
      "",
      ...iniciais.map((l) => `- ${l}`),
      "",
    ].join("\n"),
  );
}

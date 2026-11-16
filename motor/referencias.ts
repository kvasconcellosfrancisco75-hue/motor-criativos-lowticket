/**
 * Classifica referências de criativos coletadas na Biblioteca de Anúncios da Meta
 * (facebook.com/ads/library) pelos sinais públicos de que deram certo.
 *
 *   npm run referencias -- --produto <pasta>
 *
 * Lê <produto>/referencias.csv (separador ";"; modelo em docs/referencias.md) e escreve
 * <produto>/referencias.json e referencias.md com a nota de cada uma.
 *
 * A biblioteca não mostra resultado (vendas, CPA). Os sinais indiretos de que um criativo dá lucro são:
 *  - tempo no ar: ninguém mantém por semanas um anúncio que dá prejuízo;
 *  - versões: "N anúncios usam este criativo e texto" indica que o anunciante está escalando;
 *  - ainda ativo: continua funcionando hoje;
 *  - mesmo público: o que vale para o nicho do produto pesa mais do que um nicho vizinho;
 *  - coletas: em quantas coletas seguidas (npm run coletar) o anúncio apareceu ativo.
 */
import fs from "node:fs";
import path from "node:path";
import { args, salvarJSON } from "./util";

export type Referencia = {
  link: string;
  anunciante: string;
  inicio: string;
  fim?: string;
  ativo: boolean;
  versoes: number;
  formato: string;
  duracao_s?: number;
  publico: "mesmo" | "vizinho" | "outro";
  gancho: string;
  transcricao: string;
  cta: string;
  observacao?: string;
  coletas: number;
  dias: number;
  nota: number;
  nivel: "validado" | "promissor" | "fraco" | "fora";
};

const COLUNAS = ["link", "anunciante", "inicio", "fim", "ativo", "versoes", "formato", "duracao_s", "publico", "gancho", "transcricao", "cta", "observacao", "coletas"];

/** Data no formato dd/mm/aaaa ou aaaa-mm-dd. */
const data = (s: string) => {
  const t = s.trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const d = br ? new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])) : new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: "${s}" (use dd/mm/aaaa)`);
  return d;
};

/** Número de uma célula da planilha; vazio ou inválido vira o padrão. */
const num = (v: string | undefined, padrao: number) => (v && Number.isFinite(Number(v)) ? Number(v) : padrao);

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** relevancia: termos do assunto (ficha, busca.relevancia). Sem nenhum deles na legenda ou na fala, a referência fica "fora". */
export function pontuar(linha: Record<string, string>, hoje = new Date(), relevancia: string[] = [], excluir: string[] = []): Referencia {
  const ativo = /^(s|sim|true|1|ativo)$/i.test(linha.ativo ?? "");
  const fim = ativo || !linha.fim ? hoje : data(linha.fim);
  const dias = Math.max(0, Math.round((fim.getTime() - data(linha.inicio).getTime()) / 86400000));
  const versoes = Math.max(1, num(linha.versoes, 1));
  const publico = (["mesmo", "vizinho", "outro"].includes(linha.publico) ? linha.publico : "vizinho") as Referencia["publico"];
  // Nota de 0 a 100: tempo no ar pesa mais, depois escala (versões), depois se ainda roda e se é o mesmo público.
  const tempo = Math.min(1, Math.log1p(dias) / Math.log1p(90)) * 50;
  const escala = Math.min(1, Math.log1p(versoes - 1) / Math.log1p(10)) * 25;
  const coletas = Math.max(1, num(linha.coletas, 1));
  // Seguir ativo em várias coletas seguidas soma até 10 pontos (nota máxima continua 100).
  const persistencia = Math.min(1, (coletas - 1) / 3) * 10;
  const nota = Math.min(100, Math.round(tempo + escala + (ativo ? 10 : 0) + { mesmo: 15, vizinho: 8, outro: 0 }[publico] + persistencia));
  const conteudo = semAcento(`${linha.gancho ?? ""} ${linha.transcricao ?? ""} ${linha.observacao ?? ""}`);
  // excluir: anunciantes reprovados na revisão (ficha, busca.excluir), para não voltarem a cada coleta.
  const excluido = excluir.some((e) => semAcento(linha.anunciante ?? "") === semAcento(e));
  const noAssunto = !excluido && (!relevancia.length || relevancia.some((t) => conteudo.includes(semAcento(t))));
  const nivel = !noAssunto ? "fora" : ativo && (dias >= 60 || (dias >= 30 && (versoes >= 3 || coletas >= 3))) ? "validado" : dias >= 21 ? "promissor" : "fraco";
  return {
    link: linha.link,
    anunciante: linha.anunciante,
    inicio: linha.inicio,
    fim: linha.fim || undefined,
    ativo,
    versoes,
    formato: linha.formato || "video",
    duracao_s: num(linha.duracao_s, 0) || undefined,
    publico,
    gancho: linha.gancho ?? "",
    transcricao: linha.transcricao ?? "",
    cta: linha.cta ?? "",
    observacao: linha.observacao || undefined,
    coletas,
    dias,
    nota,
    nivel,
  };
}

export function lerReferencias(pastaProduto: string): Referencia[] {
  const json = path.join(pastaProduto, "referencias.json");
  return fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, "utf8")).referencias : [];
}

if (require.main === module) {
  const a = args();
  if (!a.produto) {
    console.error("Uso: npm run referencias -- --produto <pasta>");
    process.exit(1);
  }
  const pasta = path.resolve(a.produto);
  const produto = JSON.parse(fs.readFileSync(path.join(pasta, "produto.json"), "utf8"));
  const csv = path.join(pasta, "referencias.csv");
  if (!fs.existsSync(csv)) {
    fs.writeFileSync(csv, COLUNAS.join(";") + "\n");
    console.log(`Criei ${csv} só com o cabeçalho. Preencha uma linha por anúncio (guia em docs/referencias.md) e rode de novo.`);
    process.exit(0);
  }
  const [cab, ...linhas] = fs.readFileSync(csv, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const nomes = cab.split(";").map((c) => c.trim());
  const faltam = ["link", "inicio", "ativo", "gancho"].filter((c) => !nomes.includes(c));
  if (faltam.length) throw new Error(`Faltam colunas em referencias.csv: ${faltam.join(", ")}`);
  const refs = linhas
    .map((l) => Object.fromEntries(l.split(";").map((v, i) => [nomes[i], v.trim()])))
    .map((l) => pontuar(l, new Date(), produto.busca?.relevancia ?? [], produto.busca?.excluir ?? []))
    .sort((x, y) => y.nota - x.nota);
  salvarJSON(path.join(pasta, "referencias.json"), { atualizado_em: new Date().toISOString(), referencias: refs });
  const md = [
    "# Referências da Biblioteca de Anúncios",
    "",
    "Validado: ainda ativo e no ar há 60+ dias, ou 30+ dias com 3+ versões. Promissor: 21+ dias. Fora: não fala do assunto (busca.relevancia). A criação usa só as validadas (ou as promissoras, se não houver validadas).",
    "",
    "| Nota | Nível | Dias | Versões | Ativo | Público | Anunciante | Gancho |",
    "|---|---|---|---|---|---|---|---|",
    ...refs.filter((r) => r.nivel !== "fora").map((r) => `| ${r.nota} | ${r.nivel} | ${r.dias} | ${r.versoes} | ${r.ativo ? "sim" : "não"} | ${r.publico} | [${r.anunciante}](${r.link}) | ${r.gancho} |`),
  ];
  const fora = refs.filter((r) => r.nivel === "fora");
  if (fora.length) md.push("", `Fora do assunto (${fora.length}): ${fora.map((r) => r.anunciante).join(", ")}`);
  fs.writeFileSync(path.join(pasta, "referencias.md"), md.join("\n") + "\n");
  const n = (k: string) => refs.filter((r) => r.nivel === k).length;
  console.log(`${refs.length} referências: ${n("validado")} validadas, ${n("promissor")} promissoras, ${n("fraco")} fracas, ${n("fora")} fora do assunto → ${path.join(pasta, "referencias.md")}`);
}

/**
 * Gera o lote de variações a partir da ficha do produto.
 *
 *   npm run roteiros -- --produto produtos/exemplo [--formulas dor-situacao-solucao-cta] [--formatos 9x16,4x5] [--lote lote-01] [--saida pasta]
 *
 * Para cada ângulo × gancho × fórmula × formato, escreve em saida/<produto>/<lote>/<variação>/:
 *   variacao.json  — cenas resolvidas (entrada do render)
 *   roteiro.md     — narração para gravar ou gerar a voz
 *   legenda.txt    — texto principal, título e descrição do anúncio
 * e uma planilha variacoes.csv com todas as variações do lote.
 */
import fs from "node:fs";
import path from "node:path";
import type { Cena, Formato, Tema } from "../src/tipos";
import { tempoEstimado } from "./tempo";
import { args, contarPalavras, lerJSON, preencher, salvarJSON, slug } from "./util";

const RAIZ = path.resolve(__dirname, "..");
const a = args();
if (!a.produto) {
  console.error("Uso: npm run roteiros -- --produto <pasta-do-produto> [--formulas a,b] [--formatos 9x16,4x5] [--lote nome]");
  process.exit(1);
}
const pastaProduto = path.resolve(a.produto);
const produto = lerJSON(path.join(pastaProduto, "produto.json"));
const formatos = (a.formatos ?? produto.formatos?.join(",") ?? "9x16").split(",") as Formato[];
const todasFormulas = fs.readdirSync(path.join(RAIZ, "formulas")).filter((f: string) => f.endsWith(".json")).map((f: string) => lerJSON(path.join(RAIZ, "formulas", f)));
const escolhidas = a.formulas ? todasFormulas.filter((f: any) => a.formulas.split(",").includes(f.id)) : todasFormulas.filter((f: any) => (produto.formulas ?? [f.id]).includes(f.id));
const modeloLegenda = lerJSON(path.join(RAIZ, "legendas", "padrao.json"));
const lote = a.lote ?? "lote-" + new Date().toISOString().slice(0, 10);
// --saida <pasta>: grava o lote fora deste repositório (recomendado para produtos privados).
const saida = a.saida ? path.resolve(a.saida, lote) : path.join(RAIZ, "saida", produto.id, lote);

const tema: Tema = {
  claro: produto.visual.cores.claro,
  escuro: produto.visual.cores.escuro,
  destaque: produto.visual.cores.destaque,
  texto: produto.visual.cores.texto,
  fonteTitulo: produto.visual.fontes?.titulo ?? "Bricolage Grotesque",
  fonteCitacao: produto.visual.fontes?.citacao ?? "Instrument Serif",
};

const linhas: string[] = ["variacao;angulo;gancho;formula;formato;palavras;duracao_estimada_s"];
let total = 0;
for (const formula of escolhidas) {
  for (const angulo of produto.angulos) {
    for (const gancho of angulo.ganchos) {
      const ctx = { produto, p: produto, angulo, gancho };
      // Cenas com "requer" só entram se o produto tiver aquele dado (ex.: ativo de vídeo).
      const cenas: Cena[] = formula.cenas
        .filter((c: any) => !c.requer || preencherSeguro(`{{${c.requer}}}`, ctx))
        .map((c: any, i: number) => {
          const { requer, ...resto } = c;
          const cena = preencher(resto, ctx, `${formula.id}.cenas[${i}]`);
          if (cena.personagem && !produto.personagem?.[cena.personagem]) delete cena.personagem;
          else if (cena.personagem) cena.personagem = produto.personagem[cena.personagem];
          return cena;
        });
      const narracao = cenas.map((c) => c.fala).join(" ").replace(/\s+/g, " ").trim();
      const est = tempoEstimado(cenas).reduce((x, y) => x + y, 0) / 30;
      const legenda = preencher(modeloLegenda, ctx, "legenda");
      for (const formato of formatos) {
        const nome = `${slug(formula.id)}_${slug(angulo.id)}_${slug(gancho.texto ?? gancho).slice(0, 24)}_${formato}`;
        const dir = path.join(saida, nome);
        salvarJSON(path.join(dir, "variacao.json"), { produto: produto.id, pastaProduto, formula: formula.id, angulo: angulo.id, formato, tema, cenas });
        fs.writeFileSync(
          path.join(dir, "roteiro.md"),
          `# ${produto.nome} · ${formula.nome}\n\nÂngulo: ${angulo.id} · Formato: ${formato} · ~${est.toFixed(1)} s\n\n## Narração\n\n${narracao}\n\n## Cenas\n\n` +
            cenas.map((c, i) => `${i + 1}. **${c.tipo}**${c.tom ? ` (${c.tom})` : ""}: ${c.fala}`).join("\n") +
            "\n",
        );
        fs.writeFileSync(path.join(dir, "legenda.txt"), `TEXTO PRINCIPAL\n${legenda.texto}\n\nTÍTULO\n${legenda.titulo}\n\nDESCRIÇÃO\n${legenda.descricao}\n\nBOTÃO\n${legenda.botao}\n`);
        linhas.push([nome, angulo.id, JSON.stringify(gancho.texto ?? gancho), formula.id, formato, contarPalavras(narracao), est.toFixed(1)].join(";"));
        total++;
      }
    }
  }
}
fs.mkdirSync(saida, { recursive: true });
fs.writeFileSync(path.join(saida, "variacoes.csv"), linhas.join("\n") + "\n");
console.log(`${total} variações em ${path.relative(RAIZ, saida)}`);

function preencherSeguro(m: string, ctx: any) {
  try {
    return preencher(m, ctx);
  } catch {
    return undefined;
  }
}

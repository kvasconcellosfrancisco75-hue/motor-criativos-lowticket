/**
 * Gera o lote de variações a partir da ficha do produto e de uma criação aprovada.
 *
 *   npm run roteiros -- --produto <pasta> [--criacao <nome>] [--formulas a,b] [--formatos 9x16,4x5] [--lote nome] [--saida pasta]
 *
 * --criacao: ângulos, ganchos e copy gerados por `npm run criar` (<produto>/criacoes/<nome>.json).
 *            Sem ela, usa a criação mais recente; se não houver nenhuma, usa os "angulos" da ficha.
 *            Só entram ângulos e ganchos com "aprovado" diferente de false.
 *
 * Para cada ângulo × gancho × fórmula × formato, escreve em <saida>/<lote>/<variação>/:
 *   variacao.json  — cenas resolvidas (entrada do render)
 *   roteiro.md     — narração para gravar ou gerar a voz
 *   legenda.txt    — texto principal, título e descrição do anúncio
 * e uma planilha variacoes.csv com todas as variações do lote.
 */
import fs from "node:fs";
import path from "node:path";
import type { Formato, Tema } from "../src/tipos";
import { carregarFormulas, montarCenas, narracaoDe, produtoDoAngulo, RAIZ, segundosEstimados } from "./montar";
import { args, contarPalavras, lerJSON, preencher, salvarJSON, slug } from "./util";

const a = args();
if (!a.produto) {
  console.error("Uso: npm run roteiros -- --produto <pasta-do-produto> [--criacao nome] [--formulas a,b] [--formatos 9x16,4x5] [--lote nome] [--saida pasta]");
  process.exit(1);
}
const pastaProduto = path.resolve(a.produto);
const produto = lerJSON(path.join(pastaProduto, "produto.json"));
const formatos = (a.formatos ?? produto.formatos?.join(",") ?? "9x16").split(",") as Formato[];
const todasFormulas = carregarFormulas();
const escolhidas = a.formulas ? todasFormulas.filter((f: any) => a.formulas.split(",").includes(f.id)) : todasFormulas.filter((f: any) => (produto.formulas ?? [f.id]).includes(f.id));
const modeloLegenda = lerJSON(path.join(RAIZ, "legendas", "padrao.json"));

// De onde vêm os ângulos: a criação pedida, a mais recente, ou a própria ficha.
const pastaCriacoes = path.join(pastaProduto, "criacoes");
const criacoes = fs.existsSync(pastaCriacoes)
  ? fs.readdirSync(pastaCriacoes).filter((f) => f.endsWith(".json")).sort((x, y) => fs.statSync(path.join(pastaCriacoes, x)).mtimeMs - fs.statSync(path.join(pastaCriacoes, y)).mtimeMs)
  : [];
const nomeCriacao = a.criacao ?? criacoes[criacoes.length - 1]?.replace(/\.json$/, "");
const criacao = nomeCriacao ? lerJSON(path.join(pastaCriacoes, `${nomeCriacao}.json`)) : undefined;
const angulos: any[] = (criacao?.angulos ?? produto.angulos ?? [])
  .filter((x: any) => x.aprovado !== false)
  .map((x: any) => ({ ...x, ganchos: x.ganchos.filter((g: any) => g.aprovado !== false) }))
  .filter((x: any) => x.ganchos.length);
if (!angulos.length) {
  console.error("Nenhum ângulo aprovado. Rode `npm run criar` ou marque ângulos e ganchos com \"aprovado\": true.");
  process.exit(1);
}

const lote = a.lote ?? nomeCriacao ?? "lote-" + new Date().toISOString().slice(0, 10);
// --saida <pasta>: grava o lote fora deste repositório (recomendado para produtos privados).
const saida = a.saida ? path.resolve(a.saida, lote) : path.join(RAIZ, "saida", produto.id, lote);

const tema: Tema = {
  claro: produto.visual.cores.claro,
  escuro: produto.visual.cores.escuro,
  destaque: produto.visual.cores.destaque,
  texto: produto.visual.cores.texto,
  fonteTitulo: produto.visual.fontes?.titulo ?? "Bricolage Grotesque",
  fonteCitacao: produto.visual.fontes?.citacao ?? "Instrument Serif",
  escalaPersonagem: produto.visual.escala_personagem,
};

const linhas: string[] = ["variacao;angulo;gancho;tipo_gancho;formula;formato;palavras;duracao_estimada_s"];
let total = 0;
for (const formula of escolhidas) {
  for (const angulo of angulos) {
    for (const gancho of angulo.ganchos) {
      const cenas = montarCenas(formula, produto, angulo, gancho);
      const narracao = narracaoDe(cenas);
      const est = segundosEstimados(cenas, produto.ritmo_fala);
      const p = produtoDoAngulo(produto, angulo);
      const legenda = preencher(modeloLegenda, { produto: p, p, angulo, gancho }, "legenda");
      for (const formato of formatos) {
        const nome = `${slug(formula.id)}_${slug(angulo.id)}_${slug(gancho.texto ?? gancho).slice(0, 24)}_${formato}`;
        const dir = path.join(saida, nome);
        salvarJSON(path.join(dir, "variacao.json"), { produto: produto.id, pastaProduto, criacao: nomeCriacao ?? null, formula: formula.id, angulo: angulo.id, formato, tema, cenas });
        fs.writeFileSync(
          path.join(dir, "roteiro.md"),
          `# ${produto.nome} · ${formula.nome}\n\nÂngulo: ${angulo.id} · Gancho: ${gancho.tipo ?? "-"} · Formato: ${formato} · ~${est.toFixed(1)} s\n\n## Narração\n\n${narracao}\n\n## Cenas\n\n` +
            cenas.map((c, i) => `${i + 1}. **${c.tipo}**${c.tom ? ` (${c.tom})` : ""}: ${c.fala}`).join("\n") +
            "\n",
        );
        fs.writeFileSync(path.join(dir, "legenda.txt"), `TEXTO PRINCIPAL\n${legenda.texto}\n\nTÍTULO\n${legenda.titulo}\n\nDESCRIÇÃO\n${legenda.descricao}\n\nBOTÃO\n${legenda.botao}\n`);
        linhas.push([nome, angulo.id, JSON.stringify(gancho.texto ?? gancho), gancho.tipo ?? "", formula.id, formato, contarPalavras(narracao), est.toFixed(1)].join(";"));
        total++;
      }
    }
  }
}
fs.mkdirSync(saida, { recursive: true });
fs.writeFileSync(path.join(saida, "variacoes.csv"), linhas.join("\n") + "\n");
console.log(`${total} variações em ${path.relative(process.cwd(), saida)}${nomeCriacao ? ` (criação ${nomeCriacao})` : " (ângulos da ficha)"}`);

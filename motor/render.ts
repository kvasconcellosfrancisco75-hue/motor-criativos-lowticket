/**
 * Renderiza as variações de um lote.
 *
 *   npm run render -- --lote saida/<produto>/<lote> [--so <nome-da-variação>]
 *
 * Em cada pasta de variação:
 *   - se houver narracao.wav e palavras.json (ver motor/sincronizar.py), as cenas são cortadas nas palavras;
 *   - se houver só narracao.wav, o tempo é estimado e o áudio entra no vídeo;
 *   - sem áudio, o tempo é estimado pelo texto (bom para revisar o visual antes de gravar).
 * Os ativos do produto (personagem, vídeos) são lidos da pasta "ativos" do produto,
 * que pode ficar FORA deste repositório (produtos privados).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { PropsCriativo } from "../src/tipos";
import { tempoEstimado, tempoPelaFala } from "./tempo";
import { args, lerJSON, salvarJSON } from "./util";

const RAIZ = path.resolve(__dirname, "..");
const a = args();
if (!a.lote) {
  console.error("Uso: npm run render -- --lote saida/<produto>/<lote> [--so nome]");
  process.exit(1);
}
const lote = path.resolve(a.lote);
const pastas = fs.readdirSync(lote).filter((d: string) => fs.existsSync(path.join(lote, d, "variacao.json")) && (!a.so || d === a.so));

for (const nome of pastas) {
  const dir = path.join(lote, nome);
  const v = lerJSON(path.join(dir, "variacao.json"));
  const temAudio = fs.existsSync(path.join(dir, "narracao.wav"));
  const temPalavras = fs.existsSync(path.join(dir, "palavras.json"));
  const duracoes = temPalavras ? tempoPelaFala(v.cenas, lerJSON(path.join(dir, "palavras.json"))) : tempoEstimado(v.cenas);

  // Pasta pública desta renderização: ativos do produto + narração.
  const publico = path.join(dir, ".publico");
  fs.rmSync(publico, { recursive: true, force: true });
  fs.mkdirSync(publico, { recursive: true });
  const ativos = path.join(v.pastaProduto, "ativos");
  if (fs.existsSync(ativos)) fs.cpSync(ativos, publico, { recursive: true });
  if (temAudio) fs.copyFileSync(path.join(dir, "narracao.wav"), path.join(publico, "narracao.wav"));

  const props: PropsCriativo = { formato: v.formato, tema: v.tema, cenas: v.cenas, duracoes, audio: temAudio ? "narracao.wav" : undefined };
  salvarJSON(path.join(dir, "props.json"), props);
  const saida = path.join(dir, `${nome}.mp4`);
  console.log(`▶ ${nome} (${(duracoes.reduce((x, y) => x + y, 0) / 30).toFixed(1)} s, ${temPalavras ? "sincronizado pela fala" : temAudio ? "áudio com tempo estimado" : "sem áudio, tempo estimado"})`);
  execFileSync(
    "npx",
    ["remotion", "render", "src/index.ts", "Criativo", saida, `--props=${path.join(dir, "props.json")}`, `--public-dir=${publico}`, "--crf=18", "--log=error"],
    { cwd: RAIZ, stdio: "inherit" },
  );
}
console.log(`${pastas.length} vídeo(s) renderizado(s).`);

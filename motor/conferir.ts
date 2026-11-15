/**
 * Confere os vídeos renderizados de um lote e gera uma folha de quadros por variação.
 *
 *   npm run conferir -- --lote saida/<produto>/<lote> [--teto 30]
 *
 * Verifica: duração dentro do teto, presença de áudio e volume (LUFS), e gera
 * <variação>/quadros.png com um quadro do meio de cada cena para aprovação rápida.
 * Escreve conferencia.md no lote.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { args, lerJSON } from "./util";

const a = args();
if (!a.lote) {
  console.error("Uso: npm run conferir -- --lote saida/<produto>/<lote> [--teto 30]");
  process.exit(1);
}
const lote = path.resolve(a.lote);
const teto = Number(a.teto ?? 30);
/** Roda um comando e devolve stdout + stderr (o ffmpeg escreve as medições no stderr). */
const sh = (cmd: string, argv: string[]) => {
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  return String(r.stdout ?? "") + String(r.stderr ?? "");
};
const linhas = ["| Variação | Duração | Teto | Áudio | Volume (LUFS) | Situação |", "|---|---|---|---|---|---|"];
for (const nome of fs.readdirSync(lote)) {
  const dir = path.join(lote, nome);
  const mp4 = path.join(dir, `${nome}.mp4`);
  if (!fs.existsSync(mp4)) continue;
  const dur = Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).trim());
  const temAudio = sh("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", mp4]).trim().length > 0;
  const lufs = temAudio ? (sh("ffmpeg", ["-hide_banner", "-i", mp4, "-af", "ebur128", "-f", "null", "-"]).match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? "?") : "—";
  const props = fs.existsSync(path.join(dir, "props.json")) ? lerJSON(path.join(dir, "props.json")) : null;
  const temNarracao = Boolean(props?.audio);
  const problemas: string[] = [];
  if (dur > teto) problemas.push(`passa do teto em ${(dur - teto).toFixed(1)} s`);
  if (!temNarracao) problemas.push("sem narração (só efeitos): grave ou gere a voz");
  else if (lufs !== "?" && (Number(lufs) < -20 || Number(lufs) > -12)) problemas.push("volume da narração fora de -20 a -12 LUFS");
  // Folha de quadros: um quadro no meio de cada cena.
  if (props) {
    let t = 0;
    const meios = props.duracoes.map((d: number) => {
      const m = t + Math.floor(d * 0.6);
      t += d;
      return m;
    });
    const sel = meios.map((m: number) => `eq(n\\,${m})`).join("+");
    const cols = Math.min(6, meios.length);
    const rows = Math.ceil(meios.length / cols);
    sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-vf", `select='${sel}',scale=240:-1,tile=${cols}x${rows}:padding=6:color=gray`, "-frames:v", "1", "-vsync", "0", path.join(dir, "quadros.png")]);
  }
  linhas.push(`| ${nome} | ${dur.toFixed(1)} s | ${teto} s | ${temNarracao ? "narração" : temAudio ? "só efeitos" : "não"} | ${lufs} | ${problemas.length ? "⚠ " + problemas.join("; ") : "ok"} |`);
}
fs.writeFileSync(path.join(lote, "conferencia.md"), `# Conferência do lote\n\n${linhas.join("\n")}\n\nAbra quadros.png de cada variação para revisar o visual. Ouça o áudio antes de publicar: a conferência automática não avalia entonação.\n`);
console.log(linhas.join("\n"));

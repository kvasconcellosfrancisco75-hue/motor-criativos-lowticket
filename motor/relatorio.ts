/**
 * Gera o dashboard report.html a partir de uma curadoria (npm run curadoria já chama isto).
 *
 *   npm run relatorio -- --curadoria <produto>/inteligencia/<aaaa-mm-dd>/curadoria.json [--saida report.html]
 *
 * O HTML é um arquivo só: o CSS do Tailwind é compilado na hora e embutido (abre offline), e os dados
 * vão junto. Se a compilação falhar, usa o Tailwind pelo CDN. As mídias vêm direto do CDN da Meta, com
 * referrer desligado para não serem bloqueadas; elas expiram depois de alguns dias.
 */
import fs from "node:fs";
import path from "node:path";
import { args, lerJSON } from "./util";

const TEMA = {
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
      colors: {
        canvas: "#06070B", // não chamar de "base": colide com text-base (tamanho de fonte)
        surface: "#0D0F16",
        raised: "#131622",
        line: "rgba(255,255,255,0.07)",
        ink: "#E9ECF5",
        mute: "#8A90A6",
        accent: "#8B7CFF",
        accent2: "#38E1C6",
      },
      boxShadow: { glow: "0 0 0 1px rgba(139,124,255,.25), 0 20px 60px -20px rgba(139,124,255,.35)" },
    },
  },
};

const pelaCDN = () =>
  `<script src="https://cdn.tailwindcss.com/3.4.17"></script>\n<script>tailwind.config = ${JSON.stringify(TEMA)};</script>`;

/** Compila só as classes usadas no modelo (elas estão escritas por extenso no HTML e no JS dele). */
async function compilarCSS(modelo: string): Promise<string> {
  const postcss = require("postcss");
  const tailwind = require("tailwindcss");
  const r = await postcss([tailwind({ ...TEMA, content: [{ raw: modelo, extension: "html" }] })]).process(
    "@tailwind base;@tailwind components;@tailwind utilities;",
    { from: undefined },
  );
  return r.css;
}

export async function gerarRelatorio(curadoria: any, destino: string) {
  const modelo = fs.readFileSync(path.join(__dirname, "relatorio.html"), "utf8");
  let estilo: string;
  try {
    estilo = `<style>\n${await compilarCSS(modelo)}\n</style>`;
  } catch (e: any) {
    console.log(`  (não consegui compilar o Tailwind: ${e?.message ?? e}; o relatório vai usar o CDN)`);
    estilo = pelaCDN();
  }
  // JSON dentro de <script>: escapa "<" para nenhum texto de anúncio fechar a tag.
  const dados = JSON.stringify(curadoria).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const titulo = String(curadoria.produto?.nome ?? curadoria.produto?.id ?? "Relatório").replace(/[<>&"]/g, "");
  const html = modelo
    .replace("__TAILWIND__", () => estilo)
    .replace("__TITULO__", () => titulo)
    .replace("__DADOS__", () => dados);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, html);
  return destino;
}

if (require.main === module) {
  const a = args();
  if (!a.curadoria) {
    console.error("Uso: npm run relatorio -- --curadoria <pasta>/inteligencia/<data>/curadoria.json [--saida report.html]");
    process.exit(1);
  }
  const arq = path.resolve(a.curadoria);
  const saida = path.resolve(a.saida ?? path.join(path.dirname(arq), "report.html"));
  gerarRelatorio(lerJSON(arq), saida).then((f) => console.log(`Dashboard: ${f}`));
}

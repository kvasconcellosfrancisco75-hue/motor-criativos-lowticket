// Embute os arquivos de public/ no Worker (src/arquivos.js): o app inteiro vai num único script.
import fs from "node:fs";
import path from "node:path";
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const dir = new URL("./public/", import.meta.url).pathname;
const arquivos = {};
for (const nome of fs.readdirSync(dir)) {
  const ext = path.extname(nome);
  if (!TIPOS[ext]) continue;
  arquivos[`/${nome}`] = { tipo: TIPOS[ext], b64: fs.readFileSync(path.join(dir, nome)).toString("base64") };
}
fs.writeFileSync(new URL("./src/arquivos.js", import.meta.url), `// Gerado por embutir.mjs a partir de public/. Não edite.\nexport default ${JSON.stringify(arquivos)};\n`);
console.log(`${Object.keys(arquivos).length} arquivos embutidos em src/arquivos.js`);

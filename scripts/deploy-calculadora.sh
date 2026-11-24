#!/usr/bin/env bash
# Publica site/calculadora como um Cloudflare Worker (calculadora-precificacao.virallab.workers.dev).
# Uso: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... scripts/deploy-calculadora.sh
set -euo pipefail
cd "$(dirname "$0")/../site/calculadora"
OUT=$(mktemp -d)
python3 - "$OUT" <<'PY'
import os, base64, json, sys
out = sys.argv[1]
types = {'.html': 'text/html; charset=utf-8', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png'}
files = {}
for root, _, fs in os.walk('.'):
    for f in fs:
        p = os.path.join(root, f)[1:]
        files[p] = {'t': types[os.path.splitext(f)[1]], 'b': base64.b64encode(open('.' + p, 'rb').read()).decode()}
files['/'] = files['/index.html']
js = '''const FILES = %s;
const bin = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const f = FILES[url.pathname] || FILES['/'];
    const cache = url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('sw.js') ? 'no-cache' : 'public, max-age=86400';
    return new Response(bin(f.b), { headers: { 'content-type': f.t, 'cache-control': cache } });
  }
};
''' % json.dumps(files)
open(out + '/worker.mjs', 'w').write(js)
json.dump({'main_module': 'worker.mjs', 'compatibility_date': '2025-01-01'}, open(out + '/meta.json', 'w'))
PY
curl -sf -X PUT "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calculadora-precificacao" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -F "metadata=@${OUT}/meta.json;type=application/json" \
  -F "worker.mjs=@${OUT}/worker.mjs;type=application/javascript+module" > /dev/null
echo "Publicado: https://calculadora-precificacao.virallab.workers.dev"

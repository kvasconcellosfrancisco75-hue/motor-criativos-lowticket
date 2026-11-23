// Web Push (RFC 8291, aes128gcm) com VAPID (RFC 8292), só com WebCrypto: roda no Cloudflare Workers e no Node.

const texto = new TextEncoder();

export const b64u = {
  cod(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const juntar = (...partes) => {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

async function hkdf(sal, ikm, info, bytes) {
  const chave = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, chave, bytes * 8));
}

/** JWT ES256 do VAPID. `privada` é a chave privada em JWK (JSON), `sub` um mailto: ou https:. */
async function jwtVapid(aud, privada, sub) {
  const cab = b64u.cod(texto.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = b64u.cod(texto.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const chave = await crypto.subtle.importKey("jwk", privada, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const ass = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, texto.encode(`${cab}.${corpo}`));
  return `${cab}.${corpo}.${b64u.cod(ass)}`;
}

/** Cifra a mensagem para uma inscrição (o corpo do POST ao serviço de push). */
export async function cifrar(inscricao, mensagem) {
  const uaPub = b64u.dec(inscricao.keys.p256dh);
  const auth = b64u.dec(inscricao.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaChave = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaChave }, local.privateKey, 256));
  const ikm = await hkdf(auth, segredo, juntar(texto.encode("WebPush: info\0"), uaPub, localPub), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, texto.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, texto.encode("Content-Encoding: nonce\0"), 12);
  const chave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const claro = juntar(texto.encode(typeof mensagem === "string" ? mensagem : JSON.stringify(mensagem)), new Uint8Array([2]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, chave, claro));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return juntar(sal, rs, new Uint8Array([localPub.length]), localPub, cifrado);
}

/** Envia uma notificação. Devolve o status HTTP do serviço de push (404/410: inscrição expirou). */
export async function enviarPush(inscricao, mensagem, env, buscar = fetch) {
  const corpo = await cifrar(inscricao, mensagem);
  const aud = new URL(inscricao.endpoint).origin;
  const jwt = await jwtVapid(aud, JSON.parse(env.VAPID_PRIVADA), env.VAPID_SUB || "https://example.com");
  const r = await buscar(inscricao.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLICA}`,
    },
    body: corpo,
  });
  return r.status;
}

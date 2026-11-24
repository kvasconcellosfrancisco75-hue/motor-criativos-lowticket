// App do Radar: guarda o progresso e os resultados da coleta diária (KV) e avisa no telefone (Web Push).
//
// Rotas do robô (GitHub Actions), com "Authorization: Bearer <RADAR_TOKEN>":
//   POST /api/coleta/evento   progresso de uma etapa
//   POST /api/coleta/fim      resultado final
//   POST /api/coleta/erro     a coleta falhou
//   GET  /api/historico       ativos por oferta na última coleta (para a tendência)
// Rotas do app (cookie de sessão, obtido com o código de acesso APP_SENHA):
//   POST /api/entrar, POST /api/sair, GET /api/agora, GET /api/coletas, GET /api/coleta?data=, GET /api/serie?chave=
//   GET /api/push/chave, POST /api/push/inscrever, POST /api/push/cancelar, POST /api/push/teste

import { enviarPush, b64u } from "./push.js";
import ARQUIVOS from "./arquivos.js";

const SESSAO_DIAS = 180;
const MAX_EVENTOS = 60;
const MAX_INDICE = 120;
const MAX_SERIE = 90;

const json = (dados, status = 200, cab = {}) =>
  new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cab } });

const texto = new TextEncoder();
const igual = (a, b) => {
  const x = texto.encode(String(a));
  const y = texto.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

async function hmac(env, dado) {
  const chave = await crypto.subtle.importKey("raw", texto.encode(`${env.APP_SENHA}|${env.RADAR_TOKEN}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u.cod(await crypto.subtle.sign("HMAC", chave, texto.encode(dado)));
}
async function sessaoValida(req, env) {
  const c = (req.headers.get("cookie") || "").match(/(?:^|;\s*)radar=([^;]+)/)?.[1];
  if (!c) return false;
  const [exp, ass] = c.split(".");
  return Number(exp) > Date.now() && igual(ass, await hmac(env, exp));
}
const robo = (req, env) => !!env.RADAR_TOKEN && igual(req.headers.get("authorization") || "", `Bearer ${env.RADAR_TOKEN}`);

const ler = async (env, chave, padrao) => (await env.DADOS.get(chave, "json")) ?? padrao;
const gravar = (env, chave, valor) => env.DADOS.put(chave, JSON.stringify(valor));

// ───────────── notificações ─────────────

async function notificarTodos(env, mensagem) {
  const lista = await env.DADOS.list({ prefix: "push:" });
  let enviadas = 0;
  for (const k of lista.keys) {
    const insc = await ler(env, k.name);
    if (!insc) continue;
    try {
      const st = await enviarPush(insc, mensagem, env);
      if (st === 404 || st === 410) await env.DADOS.delete(k.name);
      else if (st < 300) enviadas++;
    } catch {}
  }
  return enviadas;
}

const nomeOferta = (o) => o.titulo || o.chave;

// ───────────── rotas do robô ─────────────

async function evento(env, corpo) {
  const atual = await ler(env, "agora", {});
  const novo = atual.execucao !== corpo.execucao;
  const agora = {
    ...(novo ? {} : atual),
    execucao: corpo.execucao,
    inicio: corpo.inicio,
    fonte: corpo.fonte,
    estado: "rodando",
    etapa: corpo.etapa,
    mensagem: corpo.mensagem,
    passo: corpo.passo ?? null,
    total: corpo.total ?? null,
    atualizado: new Date().toISOString(),
  };
  agora.eventos = [...(novo ? [] : atual.eventos || []), { em: agora.atualizado, etapa: corpo.etapa, mensagem: corpo.mensagem }].slice(-MAX_EVENTOS);
  await gravar(env, "agora", agora);
  return { ok: true };
}

async function fim(env, corpo, ctx) {
  await gravar(env, `coleta:${corpo.data}`, corpo);

  const indice = (await ler(env, "indice", [])).filter((x) => x.data !== corpo.data);
  indice.unshift({
    data: corpo.data,
    execucao: corpo.execucao,
    inicio: corpo.inicio,
    fim: corpo.fim,
    contagem: corpo.contagem,
    escaladas: corpo.ofertas.filter((o) => o.status === "escalada").map((o) => ({ chave: o.chave, titulo: o.titulo, preco: o.preco })),
  });
  await gravar(env, "indice", indice.sort((a, b) => (a.data < b.data ? 1 : -1)).slice(0, MAX_INDICE));

  await gravar(env, "historico", { data: corpo.data, historico: corpo.historico || {} });

  // Série de cada oferta (anúncios ativos por dia), para o gráfico da tendência.
  const series = await ler(env, "series", {});
  for (const o of corpo.ofertas) {
    if (!o.aprofundada) continue;
    const s = (series[o.chave] || []).filter((p) => p[0] !== corpo.data);
    s.push([corpo.data, o.ativos, o.status]);
    series[o.chave] = s.slice(-MAX_SERIE);
  }
  await gravar(env, "series", series);

  const atual = await ler(env, "agora", {});
  await gravar(env, "agora", {
    ...atual,
    execucao: corpo.execucao,
    inicio: corpo.inicio,
    estado: "concluida",
    etapa: "fim",
    mensagem: corpo.resumo?.[2] || "Coleta concluída",
    passo: null,
    total: null,
    atualizado: new Date().toISOString(),
    data: corpo.data,
    eventos: [...(atual.execucao === corpo.execucao ? atual.eventos || [] : []), { em: new Date().toISOString(), etapa: "fim", mensagem: "Coleta concluída" }].slice(-MAX_EVENTOS),
  });

  // Aviso: ofertas que viraram "escaladas" pela 1ª vez ganham destaque; senão, o resumo do dia.
  const notificadas = await ler(env, "notificadas", {});
  const escaladas = corpo.ofertas.filter((o) => o.status === "escalada");
  const novas = escaladas.filter((o) => !notificadas[o.chave]);
  for (const o of novas) notificadas[o.chave] = corpo.data;
  await gravar(env, "notificadas", notificadas);
  const c = corpo.contagem || {};
  const mensagem = novas.length
    ? {
        titulo: novas.length === 1 ? "Nova oferta escalada" : `${novas.length} novas ofertas escaladas`,
        corpo: novas.slice(0, 3).map((o) => `${nomeOferta(o)}${o.preco ? ` · R$ ${String(o.preco).replace(".", ",")}` : ""}`).join("\n"),
        url: `/?data=${corpo.data}`,
      }
    : { titulo: "Coleta do dia concluída", corpo: `${c.escaladas ?? 0} escaladas, ${c.quase ?? 0} quase lá, ${c.ofertas ?? 0} ofertas analisadas.`, url: `/?data=${corpo.data}` };
  ctx.waitUntil(notificarTodos(env, mensagem));
  return { ok: true, novas: novas.length };
}

async function erro(env, corpo, ctx) {
  const atual = await ler(env, "agora", {});
  const msg = corpo.mensagem || "A coleta falhou";
  await gravar(env, "agora", {
    ...atual,
    estado: "falhou",
    mensagem: msg,
    atualizado: new Date().toISOString(),
    eventos: [...(atual.eventos || []), { em: new Date().toISOString(), etapa: "erro", mensagem: msg }].slice(-MAX_EVENTOS),
  });
  ctx.waitUntil(notificarTodos(env, { titulo: "A coleta de hoje falhou", corpo: msg, url: "/" }));
  return { ok: true };
}

// ───────────── arquivos do app ─────────────

function arquivo(caminho) {
  const a = ARQUIVOS[caminho === "/" || caminho === "/index.html" ? "/index.html" : caminho] || ARQUIVOS["/index.html"];
  const bin = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
  const imagem = a.tipo.startsWith("image/");
  return new Response(bin, {
    headers: {
      "content-type": a.tipo,
      "cache-control": imagem ? "public, max-age=604800" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...(caminho === "/sw.js" ? { "service-worker-allowed": "/" } : {}),
    },
  });
}

// ───────────── principal ─────────────

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (!p.startsWith("/api/")) return arquivo(p);
    const post = req.method === "POST";
    try {
      if (p.startsWith("/api/coleta/") || p === "/api/historico") {
        if (!robo(req, env)) return json({ erro: "não autorizado" }, 401);
        if (p === "/api/historico") return json(await ler(env, "historico", { historico: {} }));
        const corpo = await req.json();
        if (p === "/api/coleta/evento" && post) return json(await evento(env, corpo));
        if (p === "/api/coleta/fim" && post) return json(await fim(env, corpo, ctx));
        if (p === "/api/coleta/erro" && post) return json(await erro(env, corpo, ctx));
        return json({ erro: "rota desconhecida" }, 404);
      }

      if (p === "/api/entrar" && post) {
        const { codigo } = await req.json().catch(() => ({}));
        if (!env.APP_SENHA || !igual(String(codigo || "").trim(), env.APP_SENHA)) {
          await new Promise((r) => setTimeout(r, 800));
          return json({ erro: "Código incorreto" }, 401);
        }
        const exp = String(Date.now() + SESSAO_DIAS * 86400000);
        const cookie = `radar=${exp}.${await hmac(env, exp)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_DIAS * 86400}`;
        return json({ ok: true }, 200, { "set-cookie": cookie });
      }
      if (p === "/api/sair") return json({ ok: true }, 200, { "set-cookie": "radar=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

      if (!(await sessaoValida(req, env))) return json({ erro: "Entre com o código de acesso" }, 401);

      if (p === "/api/agora") return json(await ler(env, "agora", { estado: "nunca" }));
      if (p === "/api/coletas") return json(await ler(env, "indice", []));
      if (p === "/api/coleta") {
        let data = url.searchParams.get("data");
        if (!data) data = (await ler(env, "indice", []))[0]?.data;
        if (!data) return json(null);
        return json(await ler(env, `coleta:${data}`, null));
      }
      if (p === "/api/serie") return json((await ler(env, "series", {}))[url.searchParams.get("chave")] || []);

      if (p === "/api/push/chave") return json({ chave: env.VAPID_PUBLICA });
      if (p === "/api/push/inscrever" && post) {
        const insc = await req.json();
        if (!insc?.endpoint || !insc?.keys?.p256dh || !insc?.keys?.auth) return json({ erro: "inscrição inválida" }, 400);
        const id = b64u.cod(await crypto.subtle.digest("SHA-256", texto.encode(insc.endpoint))).slice(0, 32);
        await gravar(env, `push:${id}`, { endpoint: insc.endpoint, keys: insc.keys });
        return json({ ok: true });
      }
      if (p === "/api/push/cancelar" && post) {
        const { endpoint } = await req.json();
        const id = b64u.cod(await crypto.subtle.digest("SHA-256", texto.encode(endpoint || ""))).slice(0, 32);
        await env.DADOS.delete(`push:${id}`);
        return json({ ok: true });
      }
      if (p === "/api/push/teste" && post) {
        const n = await notificarTodos(env, { titulo: "Radar de ofertas", corpo: "Notificações funcionando. Você recebe um aviso quando a coleta do dia terminar.", url: "/" });
        return json({ ok: true, enviadas: n });
      }
      return json({ erro: "rota desconhecida" }, 404);
    } catch (e) {
      return json({ erro: String(e?.message || e) }, 500);
    }
  },
};

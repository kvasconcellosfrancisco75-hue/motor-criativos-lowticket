"use strict";

const $app = document.getElementById("app");
const $abas = document.getElementById("abas");
const HORARIO = "06:17"; // horário de Brasília do agendamento (.github/workflows/radar.yml: 09:17 UTC)
const ETAPAS = [
  ["descoberta", "Buscando anúncios"],
  ["preco", "Lendo preços"],
  ["aprofundamento", "Medindo volume"],
];

const estado = {
  tela: "hoje",
  data: new URLSearchParams(location.search).get("data"),
  coleta: undefined,
  agora: undefined,
  indice: undefined,
  status: "escalada",
  abertas: new Set(),
  series: {},
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const brl = (v) => (v == null ? "?" : `R$ ${Number(v).toFixed(2).replace(".", ",")}`);
const dataBR = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "");
const diaSemana = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" });
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const ha = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
};

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    credentials: "same-origin",
    ...opcoes,
    headers: { "content-type": "application/json", ...(opcoes.headers || {}) },
  });
  if (r.status === 401) {
    telaEntrar();
    throw new Error("sem sessão");
  }
  const dados = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dados?.erro || `erro ${r.status}`);
  return dados;
}

// ───────────── entrar ─────────────

function telaEntrar() {
  $abas.hidden = true;
  $app.innerHTML = `
    <form class="entrar" id="form-entrar">
      <img class="logo" src="/icone.svg" alt="">
      <h1>Radar de ofertas</h1>
      <p>Digite o código de acesso para ver as coletas.</p>
      <input class="campo" id="codigo" type="password" autocomplete="current-password" placeholder="Código de acesso" required>
      <div class="erro" id="erro"></div>
      <button class="botao principal" type="submit">Entrar</button>
    </form>`;
  const f = document.getElementById("form-entrar");
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const b = f.querySelector("button");
    b.disabled = true;
    try {
      const r = await fetch("/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo: document.getElementById("codigo").value }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Não deu certo");
      iniciar();
    } catch (e) {
      document.getElementById("erro").textContent = e.message;
      b.disabled = false;
    }
  });
}

// ───────────── coleta em andamento ─────────────

function cartaoColeta() {
  const a = estado.agora || { estado: "nunca" };
  const hoje = hojeISO();
  let st = a.estado;
  const parada = st === "rodando" && a.atualizado && Date.now() - new Date(a.atualizado).getTime() > 25 * 60000;
  if (parada) st = "parada";
  const concluidaHoje = a.estado === "concluida" && a.data === hoje;
  const titulo = {
    rodando: "Coleta em andamento",
    parada: "Coleta sem notícias",
    concluida: concluidaHoje ? "Coleta de hoje concluída" : "Última coleta concluída",
    falhou: "A coleta falhou",
    nunca: "Nenhuma coleta ainda",
  }[st];
  const quando = st === "rodando" || st === "parada" ? `começou ${hora(a.inicio)}` : a.atualizado ? `${dataBR(a.atualizado.slice(0, 10))}, ${hora(a.atualizado)}` : "";
  let msg = a.mensagem || "";
  if (st === "nunca") msg = `A primeira coleta roda no próximo horário agendado (todo dia por volta das ${HORARIO}).`;
  if (st === "parada") msg = `Última notícia ${ha(a.atualizado)}: ${a.mensagem || ""}. Se não voltar, veja o log no GitHub Actions.`;
  if (st === "concluida" && !concluidaHoje) msg = `${msg ? `${msg} · ` : ""}Próxima: todo dia por volta das ${HORARIO}.`;

  let etapas = "";
  if (st === "rodando" || st === "parada") {
    const i = ETAPAS.findIndex(([k]) => k === a.etapa);
    etapas = `<div class="etapas">${ETAPAS.map(([, nome], j) => {
      const pct = j < i ? 100 : j === i && a.total ? Math.round((100 * Math.max(0, (a.passo || 1) - 1)) / a.total) : 0;
      return `<div class="etapa ${j < i ? "feita" : j === i ? "atual" : ""}"><div class="barra"><i style="width:${pct}%"></i></div>${j + 1}. ${nome}</div>`;
    }).join("")}</div>`;
  }
  let numeros = "";
  const c = estado.coleta?.contagem;
  if (c && st !== "rodando") {
    numeros = `<div class="numeros">
      <div class="numero destaque"><b>${c.escaladas}</b><span>escaladas</span></div>
      <div class="numero"><b>${c.quase}</b><span>quase lá</span></div>
      <div class="numero"><b>${c.low_ticket}</b><span>low ticket</span></div>
      <div class="numero"><b>${c.ofertas}</b><span>ofertas vistas</span></div>
    </div>`;
  }
  const eventos = (a.eventos || []).slice().reverse();
  const lista = eventos.length
    ? `<details class="eventos"${st === "rodando" ? " open" : ""}><summary>O que aconteceu (${eventos.length})</summary><ol>${eventos
        .map((e) => `<li><time>${hora(e.em)}</time><span>${esc(e.mensagem)}</span></li>`)
        .join("")}</ol></details>`
    : "";
  return `<section class="coleta">
    <div class="coleta-cab"><span class="ponto ${st}"></span><span class="coleta-titulo">${titulo}</span><span class="coleta-quando">${esc(quando)}</span></div>
    ${msg ? `<p class="coleta-msg">${esc(msg)}</p>` : ""}${etapas}${numeros}${lista}
  </section>`;
}

// ───────────── ofertas ─────────────

function tendencia(o) {
  if (o.anterior == null) return `<b>—</b><span>1ª vez</span>`;
  const d = o.ativos - o.anterior;
  return `<b class="${d > 0 ? "sobe" : d < 0 ? "desce" : ""}">${d > 0 ? "+" : ""}${d}</b><span>vs. anterior</span>`;
}

function graficoSerie(serie) {
  if (!serie || serie.length < 2) return `<p class="nota">O gráfico aparece a partir da segunda coleta desta oferta.</p>`;
  const L = 300, A = 56, m = 6;
  const vals = serie.map((p) => p[1]);
  const max = Math.max(...vals), min = Math.min(...vals);
  const x = (i) => m + (i * (L - 2 * m)) / (serie.length - 1);
  const y = (v) => A - m - ((v - min) / (max - min || 1)) * (A - 2 * m - 10);
  const pts = serie.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const u = serie.length - 1;
  return `<svg class="serie" viewBox="0 0 ${L} ${A + 8}" preserveAspectRatio="none" role="img" aria-label="Anúncios ativos por coleta">
    <polyline points="${pts}"/><circle cx="${x(u)}" cy="${y(vals[u])}" r="3"/>
    <text x="${m}" y="${A + 6}">${dataBR(serie[0][0])}</text><text x="${L - m}" y="${A + 6}" text-anchor="end">${dataBR(serie[u][0])}: ${vals[u]}</text>
  </svg>`;
}

function cartaoOferta(o) {
  const aberta = estado.abertas.has(o.chave);
  const nome = o.titulo || o.chave;
  const corpo = aberta
    ? `<div class="oferta-corpo">
        ${o.falhas?.length ? `<h4>Falta</h4><div class="falta">${o.falhas.map(esc).join("<br>")}</div>` : ""}
        <h4>Anúncios ativos por coleta</h4><div data-serie="${esc(o.chave)}">${graficoSerie(estado.series[o.chave])}</div>
        <h4>Oferta</h4>
        <ul class="lista">
          <li>Preço: <b>${brl(o.preco)}</b>${o.fonte_preco ? ` (lido ${o.fonte_preco === "checkout" ? "no checkout" : "na página"})` : ""}${o.plataforma ? ` · ${esc(o.plataforma)}` : ""}</li>
          <li>Anúncios ativos: <b>${o.estimado ? "≈" : ""}${o.ativos}${o.limitada ? "+" : ""}</b>${o.aprofundada ? (o.estimado ? " (estimado pelo total das páginas)" : "") : " (só o que apareceu na busca)"} · ${o.criativos} criativo(s)</li>
          <li>No ar desde ${esc(o.mais_antigo)} (${o.dias_no_ar} dias) · ${o.novos} criativo(s) novo(s) na semana</li>
        </ul>
        <h4>Anunciantes</h4>
        <ul class="lista">${(o.paginas || []).map((p) => `<li><a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.nome || p.id)}</a> · ${p.anuncios} na amostra</li>`).join("")}</ul>
        ${o.textos?.length ? `<h4>Criativos mais duplicados</h4><ul class="lista">${o.textos.map((t) => `<li class="criativo"><a href="${esc(t.link)}" target="_blank" rel="noopener">${t.versoes}× desde ${esc(t.inicio)}</a><small>${esc(t.texto)}</small></li>`).join("")}</ul>` : ""}
        <div class="acoes">
          ${o.url ? `<a class="botao principal" href="${esc(o.url)}" target="_blank" rel="noopener">Abrir página</a>` : ""}
          ${o.checkout ? `<a class="botao" href="${esc(o.checkout)}" target="_blank" rel="noopener">Checkout</a>` : ""}
          ${o.paginas?.[0] ? `<a class="botao" href="${esc(o.paginas[0].link)}" target="_blank" rel="noopener">Biblioteca</a>` : ""}
        </div>
      </div>`
    : "";
  return `<article class="oferta">
    <button class="oferta-cab" data-abrir="${esc(o.chave)}" aria-expanded="${aberta}">
      <div class="oferta-linha1">
        <div class="oferta-nome">${esc(nome)}${o.titulo ? `<div class="oferta-dominio">${esc(o.chave)}</div>` : ""}</div>
        <div class="preco">${brl(o.preco)}</div>
      </div>
      ${o.plataforma ? `<span class="tag">${esc(o.plataforma)}</span>` : ""}
      <div class="metricas">
        <div class="metrica"><b>${o.estimado ? "≈" : ""}${o.ativos}${o.limitada ? "+" : ""}</b><span>ativos</span></div>
        <div class="metrica">${tendencia(o)}</div>
        <div class="metrica"><b>${o.dias_no_ar}d</b><span>no ar</span></div>
        <div class="metrica"><b>${o.novos}</b><span>novos 7d</span></div>
      </div>
    </button>${corpo}
  </article>`;
}

function listaOfertas() {
  const c = estado.coleta;
  if (!c) return `<div class="vazio"><b>Ainda sem resultados</b>Quando a primeira coleta terminar, as ofertas aparecem aqui.</div>`;
  const por = { escalada: [], quase: [], fora: [] };
  for (const o of c.ofertas || []) por[o.status]?.push(o);
  const seg = [
    ["escalada", "Escaladas"],
    ["quase", "Quase lá"],
    ["fora", "Outras"],
  ];
  const daVez = por[estado.status].slice().sort((a, b) => b.ativos - a.ativos);
  const vazio = {
    escalada: "Nenhuma oferta cumpriu todos os critérios nesta coleta.",
    quase: "Nenhuma oferta ficou a um critério de distância.",
    fora: "Nada por aqui.",
  }[estado.status];
  return `
    <div class="segmentos" role="tablist">${seg.map(([k, n]) => `<button data-status="${k}" class="${estado.status === k ? "ativo" : ""}">${n}<small>${por[k].length}</small></button>`).join("")}</div>
    ${daVez.length ? daVez.map(cartaoOferta).join("") : `<div class="vazio">${vazio}</div>`}
    <p class="nota">Critérios: ${c.criterios?.preco_min != null ? `de ${brl(c.criterios.preco_min)} a` : "até"} ${brl(c.criterios?.preco_max)} · ${c.criterios?.min_ativos}+ anúncios ativos · no ar há ${c.criterios?.min_dias}+ dias · criativo novo em ${c.criterios?.novos_dias} dias · sem queda forte.</p>`;
}

function telaHoje() {
  const c = estado.coleta;
  const passado = estado.data && c && c.data !== hojeISO();
  $app.innerHTML = `
    <header class="topo">
      <div><h1>Radar</h1><div class="sub">${c ? `Coleta de ${diaSemana(c.data)}, ${dataBR(c.data)}` : "Ofertas low ticket escaladas"}</div></div>
      ${passado ? `<button class="voltar" data-hoje>Mais recente</button>` : ""}
    </header>
    ${passado ? "" : cartaoColeta()}
    ${estado.coleta === undefined ? `<div class="carregando">Carregando…</div>` : listaOfertas()}`;
}

// ───────────── histórico ─────────────

function telaHistorico() {
  const ind = estado.indice;
  if (!ind) {
    $app.innerHTML = `<header class="topo"><div><h1>Histórico</h1></div></header><div class="carregando">Carregando…</div>`;
    return;
  }
  const ult = ind.slice(0, 30).reverse();
  const max = Math.max(1, ...ult.map((d) => d.contagem?.escaladas || 0));
  $app.innerHTML = `
    <header class="topo"><div><h1>Histórico</h1><div class="sub">${ind.length} coleta(s)</div></div></header>
    ${ult.length > 1 ? `<div class="barras" role="img" aria-label="Escaladas por dia">${ult.map((d) => `<i style="height:${(100 * (d.contagem?.escaladas || 0)) / max}%" title="${dataBR(d.data)}: ${d.contagem?.escaladas}"></i>`).join("")}</div>` : ""}
    ${ind.length ? ind.map((d) => `
      <button class="dia" data-dia="${d.data}">
        <span class="dia-data">${diaSemana(d.data)}, ${dataBR(d.data)}</span>
        <span class="dia-info">${d.contagem?.quase ?? 0} quase lá · ${d.contagem?.low_ticket ?? 0} low ticket · ${d.contagem?.ofertas ?? 0} ofertas${d.escaladas?.length ? `<br>${d.escaladas.slice(0, 2).map((e) => esc(e.titulo || e.chave)).join(", ")}${d.escaladas.length > 2 ? "…" : ""}` : ""}</span>
        <span class="dia-esc">${d.contagem?.escaladas ?? 0}</span>
      </button>`).join("") : `<div class="vazio"><b>Nenhuma coleta ainda</b>A primeira roda por volta das ${HORARIO}.</div>`}`;
}

// ───────────── avisos ─────────────

const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

async function inscricaoAtual() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return undefined;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function telaAjustes() {
  const suporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const insc = suporta ? await inscricaoAtual().catch(() => null) : null;
  let push;
  if (!suporta && ehIOS && !instalado) push = `<p>No iPhone, as notificações só funcionam com o app na tela inicial: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Abra o Radar por lá e volte aqui.</p>`;
  else if (!suporta) push = `<p>Este navegador não aceita notificações. No Android use o Chrome; no iPhone, iOS 16.4 ou mais novo com o app na tela inicial.</p>`;
  else if (Notification.permission === "denied") push = `<p>As notificações estão bloqueadas para este app. Libere nas configurações do navegador ou do telefone.</p>`;
  else if (insc) push = `<p>Ativadas neste aparelho. Você recebe um aviso quando a coleta do dia termina, com destaque para ofertas que viraram escaladas pela primeira vez.</p>
      <div class="acoes"><button class="botao" id="push-teste">Enviar teste</button><button class="botao" id="push-desligar">Desativar</button></div>`;
  else push = `<p>Receba um aviso quando a coleta do dia terminar e quando aparecer uma oferta escalada nova.</p><div class="acoes"><button class="botao principal" id="push-ligar">Ativar notificações</button></div>`;
  $app.innerHTML = `
    <header class="topo"><div><h1>Avisos</h1><div class="sub">Notificações e app</div></div></header>
    <section class="painel"><h3>Notificações</h3>${push}<div class="erro" id="push-erro"></div></section>
    ${instalado ? "" : `<section class="painel"><h3>Instalar no telefone</h3><p>${ehIOS ? "No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>." : "No Chrome, abra o menu ⋮ e toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>)."}</p></section>`}
    <section class="painel"><h3>Coleta diária</h3><p>Roda sozinha todo dia por volta das ${HORARIO} (horário de Brasília) no GitHub Actions e leva de 30 a 90 minutos. O progresso aparece na aba Hoje enquanto ela acontece.</p></section>
    <section class="painel"><h3>Sessão</h3><p>Este aparelho fica conectado por 180 dias.</p><div class="acoes"><button class="botao" id="sair">Sair</button></div></section>`;
  const erro = (m) => (document.getElementById("push-erro").textContent = m);
  document.getElementById("push-ligar")?.addEventListener("click", async () => {
    try {
      if ((await Notification.requestPermission()) !== "granted") return erro("Permissão negada.");
      const { chave } = await api("/api/push/chave");
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(chave) });
      await api("/api/push/inscrever", { method: "POST", body: JSON.stringify(s) });
      telaAjustes();
    } catch (e) {
      erro(`Não deu para ativar: ${e.message}`);
    }
  });
  document.getElementById("push-teste")?.addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await api("/api/push/teste", { method: "POST", body: "{}" });
      erro(r.enviadas ? "Teste enviado." : "Nenhum aparelho recebeu. Desative e ative de novo.");
    } catch (e) {
      erro(e.message);
    }
    ev.target.disabled = false;
  });
  document.getElementById("push-desligar")?.addEventListener("click", async () => {
    const s = await inscricaoAtual();
    if (s) {
      await api("/api/push/cancelar", { method: "POST", body: JSON.stringify({ endpoint: s.endpoint }) }).catch(() => {});
      await s.unsubscribe();
    }
    telaAjustes();
  });
  document.getElementById("sair")?.addEventListener("click", async () => {
    await fetch("/api/sair", { method: "POST" });
    telaEntrar();
  });
}
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// ───────────── navegação e atualização ─────────────

function desenhar() {
  $abas.hidden = false;
  for (const b of $abas.querySelectorAll(".aba")) b.classList.toggle("ativa", b.dataset.tela === estado.tela);
  if (estado.tela === "hoje") telaHoje();
  else if (estado.tela === "historico") telaHistorico();
  else telaAjustes();
}

async function carregarColeta() {
  estado.coleta = await api(`/api/coleta${estado.data ? `?data=${encodeURIComponent(estado.data)}` : ""}`);
}

let relogio;
async function atualizarAgora() {
  clearTimeout(relogio);
  try {
    const antes = estado.agora;
    estado.agora = await api("/api/agora");
    // Terminou agora: busca o resultado novo.
    if (antes && antes.estado === "rodando" && estado.agora.estado === "concluida" && !estado.data) await carregarColeta();
    if (estado.tela === "hoje" && !estado.data) telaHoje();
  } catch {}
  relogio = setTimeout(atualizarAgora, estado.agora?.estado === "rodando" && document.visibilityState === "visible" ? 5000 : 60000);
}

$abas.addEventListener("click", async (ev) => {
  const b = ev.target.closest(".aba");
  if (!b) return;
  estado.tela = b.dataset.tela;
  desenhar();
  if (estado.tela === "historico") {
    estado.indice = await api("/api/coletas").catch(() => []);
    if (estado.tela === "historico") telaHistorico();
  }
});

$app.addEventListener("click", async (ev) => {
  const t = ev.target;
  const abrir = t.closest("[data-abrir]");
  if (abrir) {
    const k = abrir.dataset.abrir;
    estado.abertas.has(k) ? estado.abertas.delete(k) : estado.abertas.add(k);
    telaHoje();
    if (estado.abertas.has(k) && !estado.series[k]) {
      estado.series[k] = await api(`/api/serie?chave=${encodeURIComponent(k)}`).catch(() => []);
      const alvo = document.querySelector(`[data-serie="${CSS.escape(k)}"]`);
      if (alvo) alvo.innerHTML = graficoSerie(estado.series[k]);
    }
    return;
  }
  const st = t.closest("[data-status]");
  if (st) return ((estado.status = st.dataset.status), telaHoje());
  const dia = t.closest("[data-dia]");
  if (dia) {
    estado.data = dia.dataset.dia;
    estado.tela = "hoje";
    estado.coleta = undefined;
    history.replaceState(null, "", `/?data=${estado.data}`);
    desenhar();
    await carregarColeta().catch(() => (estado.coleta = null));
    return desenhar();
  }
  if (t.closest("[data-hoje]")) {
    estado.data = null;
    estado.coleta = undefined;
    history.replaceState(null, "", "/");
    desenhar();
    await carregarColeta().catch(() => (estado.coleta = null));
    desenhar();
  }
});

document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && atualizarAgora());

async function iniciar() {
  try {
    [estado.agora] = await Promise.all([api("/api/agora"), carregarColeta()]);
  } catch (e) {
    if (e.message === "sem sessão") return;
    $abas.hidden = false;
    $app.innerHTML = `<div class="vazio"><b>Sem conexão</b>${esc(e.message)}</div>`;
    return;
  }
  desenhar();
  atualizarAgora();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
iniciar();

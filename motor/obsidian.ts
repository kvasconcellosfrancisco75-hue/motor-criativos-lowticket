/**
 * O cérebro dentro do Obsidian. O motor escreve o cofre e lê de volta o que você muda nele.
 *
 *   npm run obsidian -- --produto <pasta> [--cofre <pasta do cofre>]   # sincroniza o produto com o cofre
 *   npm run obsidian -- --radar <ofertas.json> [--cofre <pasta>]       # leva uma coleta do radar para o cofre
 *
 * Onde fica o cofre: --cofre, o campo "obsidian.cofre" da ficha ou a variável OBSIDIAN_COFRE.
 * Com o cofre configurado, `criar`, `roteiros`, `resultados` e `cerebro` sincronizam sozinhos.
 *
 * <cofre>/Motor/
 *   Painel.md                              — entrada: produtos, ganchos vencedores e radar
 *   Produtos/<produto>/<produto>.md        — resumo do cérebro do produto
 *   Produtos/<produto>/Lições.md           — SUA nota: cada "- " vira instrução para a próxima criação
 *   Produtos/<produto>/Ângulos/<id>.md     — um por ângulo criado
 *   Produtos/<produto>/Ganchos/<texto>.md  — um por gancho: resultado, veredito e a caixinha "aprovado"
 *   Radar/<dia>.md, Radar/Ofertas/<oferta>.md — coletas do radar e o histórico de cada oferta
 *
 * O que vem do Obsidian para o motor:
 *   - "aprovado" desmarcado num gancho ou ângulo: `npm run roteiros` não gera aquela variação;
 *   - as linhas de Lições.md: entram no pedido de `npm run criar`.
 */
import fs from "node:fs";
import path from "node:path";
import { indicadores, lerCerebro, lerLicoesLocais, metas, padroes, porGancho, type Gancho, type Resultado, veredito as julgar } from "./cerebro";
import { cofreDe, criarLicoes, escreverNota, licoesDoCofre, link, linkT, lerNota, nomeArquivo, notas, pastaProdutoNoCofre, RAIZ_COFRE } from "./cofre";
import { args, lerJSON, salvarJSON, slug } from "./util";

const hoje = () => new Date().toISOString().slice(0, 10);
const pct = (v?: number) => (v === undefined ? "–" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const brl = (v?: number) => (v === undefined ? "–" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const r2 = (v?: number) => (v === undefined ? undefined : Math.round(v * 10000) / 10000);
const EMOJI: Record<string, string> = { vencedor: "🟢", promissor: "🟡", em_teste: "⚪", perdedor: "🔴", fora_do_ar: "⚫" };
const rel = (cofre: string, arq: string) => path.relative(cofre, arq).split(path.sep).join("/");

type Fonte = { criacao: string; arquivo?: string; dados: any };

/** As criações do produto (e os ângulos da ficha, se houver). */
function fontes(pastaProduto: string, produto: any): Fonte[] {
  const out: Fonte[] = [];
  if (produto.angulos?.length) out.push({ criacao: "ficha", dados: { angulos: produto.angulos } });
  const pasta = path.join(pastaProduto, "criacoes");
  if (fs.existsSync(pasta))
    for (const f of fs.readdirSync(pasta).filter((f) => f.endsWith(".json")).sort())
      out.push({ criacao: f.replace(/\.json$/, ""), arquivo: path.join(pasta, f), dados: lerJSON(path.join(pasta, f)) });
  return out;
}

const idAngulo = (criacao: string, an: any) => `${criacao}/${an.id}`;
const idGancho = (criacao: string, an: any, g: any) => `${criacao}/${an.id}/${slug(g.texto ?? g)}`;

/** Mapa motor_id → arquivo, para achar as notas mesmo que você as renomeie ou mova dentro da pasta do produto. */
function indice(pasta: string) {
  const m = new Map<string, string>();
  for (const arq of notas(pasta)) {
    const id = lerNota(arq)?.props.motor_id;
    if (typeof id === "string") m.set(id, arq);
  }
  return m;
}

/** Arquivo de uma nota: o que já existe com esse motor_id, ou um nome novo que não colida com outro. */
function arquivoPara(idx: Map<string, string>, usados: Set<string>, pasta: string, id: string, nome: string, sufixo: string) {
  const existente = idx.get(id);
  if (existente) return usados.add(existente), existente;
  let arq = path.join(pasta, `${nomeArquivo(nome)}.md`);
  if (usados.has(arq) || (fs.existsSync(arq) && !idx.has(id))) arq = path.join(pasta, `${nomeArquivo(nome)} (${sufixo}).md`);
  usados.add(arq);
  return arq;
}

/** Lê "aprovado" das notas e grava nas criações. Devolve quantas mudanças houve. */
export function importarAprovacoes(cofre: string, pastaProduto: string, produto: any): number {
  const idx = indice(pastaProdutoNoCofre(cofre, produto));
  const aprov = (id: string) => {
    const arq = idx.get(id);
    const v = arq ? lerNota(arq)?.props.aprovado : undefined;
    return typeof v === "boolean" ? v : undefined;
  };
  let mudancas = 0;
  for (const f of fontes(pastaProduto, produto)) {
    if (!f.arquivo) continue; // ângulos da ficha: aprove ou reprove na própria ficha
    let mudou = false;
    for (const an of f.dados.angulos ?? []) {
      const va = aprov(idAngulo(f.criacao, an));
      if (va !== undefined && va !== (an.aprovado !== false)) (an.aprovado = va), (mudou = true), mudancas++;
      for (const g of an.ganchos ?? []) {
        const vg = aprov(idGancho(f.criacao, an, g));
        if (vg !== undefined && vg !== (g.aprovado !== false)) (g.aprovado = vg), (mudou = true), mudancas++;
      }
    }
    if (mudou) salvarJSON(f.arquivo, f.dados);
  }
  return mudancas;
}

/** Escreve todas as notas do produto no cofre. */
export function exportarProduto(cofre: string, pastaProduto: string, produto: any) {
  const base = pastaProdutoNoCofre(cofre, produto);
  const idx = indice(base);
  const usados = new Set<string>();
  const cerebro = lerCerebro(pastaProduto, produto.id);
  const m = metas(produto);
  const resultados = Object.values(cerebro.resultados);
  const porG = new Map(porGancho(cerebro, m).map((g) => [`${g.angulo}|${g.gancho}`, g]));
  const nomeHub = nomeArquivo(produto.nome ?? produto.id);
  const hub = path.join(base, `${nomeHub}.md`);
  const licoes = path.join(base, "Lições.md");
  // Na 1ª vez, as lições de cerebro/licoes.md vão para a nota do cofre.
  criarLicoes(cofre, produto, lerLicoesLocais(pastaProduto));

  type Linha = { arq: string; g: any; an: any; criacao: string; res?: Gancho };
  const linhasG: Linha[] = [];
  const angulosFeitos: { arq: string; an: any; criacao: string; ganchos: Linha[] }[] = [];

  for (const f of fontes(pastaProduto, produto)) {
    for (const an of f.dados.angulos ?? []) {
      const arqA = arquivoPara(idx, usados, path.join(base, "Ângulos"), idAngulo(f.criacao, an), an.id, f.criacao);
      const ganchos: Linha[] = [];
      for (const g of an.ganchos ?? []) {
        const texto = g.texto ?? g;
        const arqG = arquivoPara(idx, usados, path.join(base, "Ganchos"), idGancho(f.criacao, an, g), texto, f.criacao);
        const l = { arq: arqG, g, an, criacao: f.criacao, res: porG.get(`${an.id}|${texto}`) };
        ganchos.push(l);
        linhasG.push(l);
      }
      angulosFeitos.push({ arq: arqA, an, criacao: f.criacao, ganchos });
    }
  }

  const vered = (l: Linha) => l.res?.veredito ?? "fora_do_ar";
  const nomeVered = (v: string) => `${EMOJI[v] ?? ""} ${v.replace(/_/g, " ")}`;

  // Ganchos
  for (const l of linhasG) {
    const { g, an, res } = l;
    const texto = g.texto ?? g;
    const i = res ? indicadores(res) : undefined;
    const arqA = angulosFeitos.find((x) => x.an === an)!.arq;
    const variacoes = resultados.filter((r) => r.angulo === an.id && r.gancho === texto);
    const corpo = [
      `# “${texto}”`,
      "",
      `**${nomeVered(vered(l))}** · ${link(rel(cofre, arqA), `ângulo ${an.id}`)}${g.tipo ? ` · gancho de ${g.tipo}` : ""} · ${link(rel(cofre, hub), produto.nome)}`,
      "",
      g.linhas?.length ? `> [!quote] Na tela\n> ${g.linhas.join("<br>")}${g.marca ? `\n> Destaque: **${g.marca}**` : ""}` : "",
      "",
      res
        ? [
            "## Resultado no ar",
            "",
            "| Gasto | Compras | CPA | Taxa de gancho (3 s) | CTR | ROAS |",
            "|---|---|---|---|---|---|",
            `| ${brl(res.gasto)} | ${res.compras} | ${brl(i!.cpa)} | ${pct(i!.gancho)} | ${pct(i!.ctr)} | ${i!.roas === undefined ? "–" : i!.roas.toFixed(2).replace(".", ",") + "x"} |`,
            "",
            `Meta: CPA até ${brl(m.cpa_alvo)}, julgado depois de ${brl(m.gasto_minimo)} de gasto.`,
            "",
            "**Variações**",
            "",
            ...variacoes.map((r) => {
              const iv = indicadores(r);
              return `- \`${r.variacao}\` — ${brl(r.gasto)}, ${r.compras} compra(s), CPA ${brl(iv.cpa)}, gancho ${pct(iv.gancho)} ${EMOJI[julgar(r, m)]}`;
            }),
          ].join("\n")
        : "## Resultado no ar\n\nAinda sem números. Suba o anúncio com o nome da variação e importe com `npm run resultados`.",
      "",
      problemasDe(g),
      an.referencia && an.referencia !== "nenhuma" ? `**Baseado em:** ${an.referencia}${an.aproveita ? ` — ${an.aproveita}` : ""}` : "",
      "",
      "*Desmarque **aprovado** nas propriedades para tirar este gancho dos próximos lotes (`npm run roteiros`).*",
    ];
    escreverNota(
      l.arq,
      {
        categoria: "gancho",
        motor_id: idGancho(l.criacao, an, g),
        produto: link(rel(cofre, hub), produto.nome),
        angulo: link(rel(cofre, arqA), an.id),
        aprovado: l.criacao === "ficha" ? undefined : g.aprovado !== false,
        veredito: vered(l),
        tipo_gancho: g.tipo,
        base: an.base,
        consciencia: an.consciencia,
        criacao: l.criacao,
        gasto: r2(res?.gasto),
        compras: res?.compras,
        cpa: r2(i?.cpa),
        taxa_gancho: r2(i?.gancho),
        ctr: r2(i?.ctr),
        roas: r2(i?.roas),
        atualizado: hoje(),
        tags: ["motor/gancho"],
      },
      corpo.filter((x) => x !== undefined).join("\n").replace(/\n{3,}/g, "\n\n"),
      { meus: ["aprovado", "tags"], extra: "## Minhas notas\n\n" },
    );
  }

  // Ângulos
  for (const a of angulosFeitos) {
    const { an } = a;
    const doAngulo = resultados.filter((r) => r.angulo === an.id && a.ganchos.some((l) => (l.g.texto ?? l.g) === r.gancho));
    const soma = doAngulo.reduce((s, r) => ({ gasto: s.gasto + r.gasto, compras: s.compras + r.compras }), { gasto: 0, compras: 0 });
    const corpo = [
      `# Ângulo ${an.id}`,
      "",
      `${link(rel(cofre, hub), produto.nome)} · criação \`${a.criacao}\`${an.base ? ` · base ${an.base}` : ""}${an.consciencia ? ` · consciência ${an.consciencia}` : ""}`,
      "",
      an.dor ? `**Dor:** ${an.dor}` : "",
      an.legenda_gancho ? `**Legenda:** ${an.legenda_gancho}` : "",
      an.promessa?.fala ? `**Promessa que não se cumpre:** ${an.promessa.fala}` : "",
      an.numero?.fala ? `**Número que dói:** ${an.numero.fala}` : "",
      "",
      "## Ganchos",
      "",
      ...a.ganchos.map((l) => `- ${EMOJI[vered(l)]} ${link(rel(cofre, l.arq), l.g.texto ?? l.g)}${l.res ? ` — CPA ${brl(indicadores(l.res).cpa)}, gancho ${pct(indicadores(l.res).gancho)}` : ""}`),
      "",
      soma.gasto ? `**No total:** ${brl(soma.gasto)} gastos, ${soma.compras} compra(s), CPA ${brl(soma.compras ? soma.gasto / soma.compras : undefined)}.` : "",
      an.copy?.mecanismo?.fala ? `\n## Copy\n\n${[an.copy.mecanismo.fala, an.copy.entregaveis?.fala, an.copy.diferencial?.fala, an.copy.slogan?.fala, an.copy.oferta?.fala, an.copy.cta?.fala].filter(Boolean).join(" ")}` : "",
      problemasDe(an),
    ];
    escreverNota(
      a.arq,
      {
        categoria: "angulo",
        motor_id: idAngulo(a.criacao, an),
        produto: link(rel(cofre, hub), produto.nome),
        aprovado: a.criacao === "ficha" ? undefined : an.aprovado !== false,
        base: an.base,
        consciencia: an.consciencia,
        criacao: a.criacao,
        gasto: r2(soma.gasto) || undefined,
        compras: soma.gasto ? soma.compras : undefined,
        atualizado: hoje(),
        tags: ["motor/angulo"],
      },
      corpo.join("\n").replace(/\n{3,}/g, "\n\n"),
      { meus: ["aprovado", "tags"], extra: "## Minhas notas\n\n" },
    );
  }

  // Resumo do produto
  const ordenados = linhasG.filter((l) => l.res).sort((x, y) => (indicadores(x.res!).cpa ?? Infinity) - (indicadores(y.res!).cpa ?? Infinity) || (indicadores(y.res!).gancho ?? 0) - (indicadores(x.res!).gancho ?? 0));
  const total = resultados.reduce((s, r) => ({ gasto: s.gasto + r.gasto, compras: s.compras + r.compras, receita: s.receita + r.receita }), { gasto: 0, compras: 0, receita: 0 });
  const pad = (campo: keyof Resultado, titulo: string) => {
    const ps = padroes(cerebro, campo);
    if (ps.length < 2) return "";
    return [`**${titulo}**`, "", "| | Ganchos | Gasto | CPA | Gancho 3 s |", "|---|---|---|---|---|", ...ps.map((p) => `| ${p.valor} | ${p.ganchos} | ${brl(p.gasto)} | ${brl(indicadores(p).cpa)} | ${pct(indicadores(p).gancho)} |`), ""].join("\n");
  };
  const lic = licoesDoCofre(cofre, produto);
  const pastaRel = rel(cofre, base);
  const corpoHub = [
    `# ${produto.nome}`,
    "",
    `Meta: CPA até **${brl(m.cpa_alvo)}**, julgado depois de ${brl(m.gasto_minimo)} de gasto · ${linhasG.length} ganchos criados, ${ordenados.length} com números · ${link(rel(cofre, licoes), `${lic.length} lição(ões)`)}`,
    "",
    total.gasto ? `**No total:** ${brl(total.gasto)} gastos, ${total.compras} compras, CPA ${brl(total.compras ? total.gasto / total.compras : undefined)}, ROAS ${total.gasto ? (total.receita / total.gasto).toFixed(2).replace(".", ",") + "x" : "–"}.` : "> [!info] Ainda sem resultados\n> Suba os anúncios com o nome da variação e rode `npm run resultados`. Os ganchos aparecem aqui do melhor para o pior.",
    "",
    "## Ganchos no ar",
    "",
    ordenados.length
      ? ["| | Gancho | Ângulo | Tipo | Gasto | CPA | Gancho 3 s |", "|---|---|---|---|---|---|---|", ...ordenados.map((l) => `| ${EMOJI[vered(l)]} | ${linkT(rel(cofre, l.arq), nomeArquivo(l.g.texto ?? l.g, 50))} | ${l.an.id} | ${l.g.tipo ?? "–"} | ${brl(l.res!.gasto)} | ${brl(indicadores(l.res!).cpa)} | ${pct(indicadores(l.res!).gancho)} |`)].join("\n")
      : "Nenhum ainda.",
    "",
    "## Padrões",
    "",
    [pad("tipo_gancho", "Tipo de gancho"), pad("base", "Base do ângulo"), pad("consciencia", "Nível de consciência"), pad("formula", "Fórmula"), pad("formato", "Formato")].filter(Boolean).join("\n") || "Aparecem quando houver números de pelo menos dois grupos diferentes.",
    "",
    "## Lições em uso",
    "",
    lic.length ? lic.map((l) => `- ${l}`).join("\n") : `Nenhuma. Escreva em ${link(rel(cofre, licoes), "Lições")}.`,
    "",
    "## Aguardando teste",
    "",
    linhasG.filter((l) => !l.res && l.g.aprovado !== false && l.an.aprovado !== false).map((l) => `- ${link(rel(cofre, l.arq), l.g.texto ?? l.g)} (${l.an.id})`).join("\n") || "Nada.",
    "",
    "## Consulta viva (plugin Dataview)",
    "",
    "```dataview",
    "TABLE veredito, cpa AS \"CPA\", taxa_gancho AS \"Gancho 3s\", gasto, tipo_gancho AS \"Tipo\", aprovado",
    `FROM "${pastaRel}/Ganchos"`,
    "SORT choice(cpa, cpa, 999999) ASC, taxa_gancho DESC",
    "```",
  ];
  escreverNota(hub, { categoria: "produto", motor_id: `produto/${produto.id}`, produto_id: produto.id, cpa_alvo: m.cpa_alvo, gasto_minimo: m.gasto_minimo, atualizado: hoje(), tags: ["motor/produto"] }, corpoHub.join("\n"), { meus: ["tags"], extra: "## Minhas notas\n\n" });

  // Notas de ganchos que sumiram das criações ficam onde estão (são suas), só deixam de ser atualizadas.
  escreverPainel(cofre);
  return { ganchos: linhasG.length, angulos: angulosFeitos.length, hub };
}

const problemasDe = (x: any) => (x.problemas?.length ? `> [!warning] A validação do motor apontou\n> ${x.problemas.join("\n> ")}` : "");

// ───────────────────────────── radar ─────────────────────────────

/** Leva uma coleta do radar (radar/dados/<dia>/ofertas.json) para o cofre: nota do dia e uma nota por oferta. */
export function exportarRadar(cofre: string, arquivoOfertas: string) {
  const { data, ofertas } = lerJSON(arquivoOfertas) as { data: string; ofertas: any[] };
  const base = path.join(cofre, RAIZ_COFRE, "Radar");
  const histArq = path.join(cofre, RAIZ_COFRE, ".motor", "radar-historico.json");
  const hist: Record<string, { dia: string; ativos: number; status: string; preco?: number }[]> = fs.existsSync(histArq) ? lerJSON(histArq) : {};
  const relevantes = ofertas.filter((o) => o.status !== "fora");
  const notaDia = path.join(base, `${data}.md`);
  const linhaOferta = (o: any) => {
    const arq = path.join(base, "Ofertas", `${nomeArquivo(o.chave)}.md`);
    return `| ${o.status === "escalada" ? "🔥" : "⏳"} | ${linkT(rel(cofre, arq), o.chave)} | ${o.verificacao?.titulo ? nomeArquivo(o.verificacao.titulo, 40) : "–"} | ${brl(o.preco)} | ${o.metricas.ativos} | ${o.metricas.diasNoAr} | ${o.verificacao?.plataforma ?? "?"} |`;
  };
  for (const o of relevantes) {
    const h = (hist[o.chave] ??= []).filter((x) => x.dia !== data);
    h.push({ dia: data, ativos: o.metricas.ativos, status: o.status, preco: o.preco });
    h.sort((x, y) => x.dia.localeCompare(y.dia));
    hist[o.chave] = h;
    const v = o.verificacao;
    const mt = o.metricas;
    const corpo = [
      `# ${o.chave}${v?.titulo ? ` — ${v.titulo}` : ""}`,
      "",
      `**${o.status === "escalada" ? "🔥 escalada" : "⏳ quase lá"}** na coleta de ${link(rel(cofre, notaDia), data)}`,
      "",
      "| Preço | Checkout | Anúncios ativos | Criativos | Mais antigo | Novos |",
      "|---|---|---|---|---|---|",
      `| ${brl(o.preco)} | ${v?.plataforma ?? "?"} | ${mt.ativos} | ${mt.criativos} | ${mt.diasNoAr} dias | ${mt.novos} |`,
      "",
      `- Página: https://${mt.destino}`,
      v?.checkout ? `- Checkout: ${v.checkout}` : null,
      v?.bumps?.length ? `- Order bumps: ${v.bumps.map((b: any) => `${b.nome || "sem nome"} (${brl(b.preco)})`).join("; ")}` : null,
      mt.paginas?.length ? `- Anunciantes: ${mt.paginas.slice(0, 5).map((p: any) => `${p.nome || p.id} (${p.anuncios})`).join(", ")}` : null,
      o.falhas?.length ? `- Falta: ${o.falhas.join("; ")}` : null,
      "",
      mt.textos?.length ? ["## Criativos mais duplicados", "", ...mt.textos.map((t: any) => `- [${t.versoes}× desde ${t.inicio}](${t.link}) ${t.texto}`)].join("\n") : null,
      "",
      "## Histórico",
      "",
      "| Dia | Status | Anúncios ativos | Preço |",
      "|---|---|---|---|",
      ...h.map((x) => `| ${linkT(rel(cofre, path.join(base, x.dia)), x.dia)} | ${x.status} | ${x.ativos} | ${brl(x.preco)} |`),
      "",
      "*Para estudar esta oferta e criar o seu ângulo, anote abaixo o que faz ela vender (estrutura, gancho, promessa). Nunca copie as frases.*",
    ];
    escreverNota(
      path.join(base, "Ofertas", `${nomeArquivo(o.chave)}.md`),
      { categoria: "oferta", motor_id: `oferta/${o.chave}`, status: o.status, preco: o.preco, plataforma: v?.plataforma, ativos: mt.ativos, dias_no_ar: mt.diasNoAr, primeira_coleta: h[0].dia, ultima_coleta: data, coletas: h.length, tags: ["motor/oferta"] },
      corpo.filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n"),
      { meus: ["tags"], extra: "## Minhas notas\n\n" },
    );
  }
  salvarJSON(histArq, hist);
  const esc = relevantes.filter((o) => o.status === "escalada").sort((x, y) => y.metricas.ativos - x.metricas.ativos);
  const quase = relevantes.filter((o) => o.status === "quase").sort((x, y) => y.metricas.ativos - x.metricas.ativos);
  const tabela = (l: any[]) => (l.length ? ["| | Oferta | Título | Preço | Ativos | Dias no ar | Checkout |", "|---|---|---|---|---|---|---|", ...l.map(linhaOferta)].join("\n") : "Nenhuma.");
  escreverNota(
    notaDia,
    { categoria: "radar", motor_id: `radar/${data}`, data, escaladas: esc.length, quase: quase.length, ofertas: ofertas.length, tags: ["motor/radar"] },
    [`# Radar · ${data.split("-").reverse().join("/")}`, "", `${ofertas.length} ofertas vistas · **${esc.length} escaladas** · ${quase.length} quase lá`, "", "## 🔥 Escaladas", "", tabela(esc), "", "## ⏳ Quase lá (falta um critério)", "", tabela(quase)].join("\n"),
    { meus: ["tags"], extra: "## Minhas notas\n\n" },
  );
  escreverPainel(cofre);
  return { dia: notaDia, ofertas: relevantes.length };
}

// ───────────────────────────── painel ─────────────────────────────

/** A página de entrada do cofre: produtos, melhores ganchos de todos e o radar mais recente. */
export function escreverPainel(cofre: string) {
  const raiz = path.join(cofre, RAIZ_COFRE);
  const todas = notas(raiz).map((arq) => ({ arq, n: lerNota(arq)! })).filter((x) => x.n);
  const produtos = todas.filter((x) => x.n.props.categoria === "produto");
  const ganchos = todas.filter((x) => x.n.props.categoria === "gancho" && typeof x.n.props.cpa === "number");
  const radares = todas.filter((x) => x.n.props.categoria === "radar").sort((a, b) => String(b.n.props.data).localeCompare(String(a.n.props.data)));
  const vencedores = ganchos.filter((x) => x.n.props.veredito === "vencedor" || x.n.props.veredito === "promissor").sort((a, b) => (a.n.props.cpa as number) - (b.n.props.cpa as number)).slice(0, 10);
  const ultimo = radares[0];
  const corpo = [
    "# Painel do motor",
    "",
    "O segundo cérebro dos criativos: o que está no ar, o que vendeu e o que o mercado está escalando.",
    "",
    "## Produtos",
    "",
    produtos.length ? produtos.map((p) => `- ${link(rel(cofre, p.arq), path.basename(p.arq, ".md"))} · meta de CPA ${brl(p.n.props.cpa_alvo as number)}`).join("\n") : "Nenhum ainda. Rode `npm run obsidian -- --produto <pasta>`.",
    "",
    "## 🟢 Ganchos que estão vendendo",
    "",
    vencedores.length
      ? ["| Gancho | Produto | CPA | Gancho 3 s |", "|---|---|---|---|", ...vencedores.map((g) => `| ${linkT(rel(cofre, g.arq), nomeArquivo(path.basename(g.arq, ".md"), 50))} | ${String(g.n.props.produto ?? "").replace(/\|/g, "\\|")} | ${brl(g.n.props.cpa as number)} | ${pct(g.n.props.taxa_gancho as number)} |`)].join("\n")
      : "Nenhum vencedor ainda.",
    "",
    "## 📡 Radar",
    "",
    ultimo ? `Última coleta: ${link(rel(cofre, ultimo.arq), String(ultimo.n.props.data))} · **${ultimo.n.props.escaladas} escaladas**, ${ultimo.n.props.quase} quase lá.` : "Nenhuma coleta no cofre. Rode `npm run obsidian -- --radar radar/dados/<dia>/ofertas.json`.",
    radares.length > 1 ? `\nAnteriores: ${radares.slice(1, 8).map((r) => link(rel(cofre, r.arq), String(r.n.props.data))).join(" · ")}` : "",
    "",
    "## Consultas vivas (plugin Dataview)",
    "",
    "Ganchos vencedores de todos os produtos:",
    "",
    "```dataview",
    `TABLE produto, cpa AS "CPA", taxa_gancho AS "Gancho 3s", tipo_gancho AS "Tipo"`,
    `FROM "${RAIZ_COFRE}/Produtos"`,
    `WHERE categoria = "gancho" AND (veredito = "vencedor" OR veredito = "promissor")`,
    "SORT cpa ASC",
    "```",
    "",
    "Ofertas escaladas há mais tempo:",
    "",
    "```dataview",
    `TABLE preco AS "Preço", ativos AS "Ativos", coletas AS "Coletas", ultima_coleta AS "Última"`,
    `FROM "${RAIZ_COFRE}/Radar/Ofertas"`,
    `WHERE status = "escalada"`,
    "SORT coletas DESC, ativos DESC",
    "```",
  ];
  escreverNota(path.join(raiz, "Painel.md"), { categoria: "painel", atualizado: hoje(), tags: ["motor"] }, corpo.join("\n"), { meus: ["tags"] });
}

/** Sincroniza um produto: primeiro o que você mudou no cofre, depois o que o motor sabe. Silencioso sem cofre. */
export function sincronizar(pastaProduto: string, produto: any, arg?: string, log = true) {
  const cofre = cofreDe(pastaProduto, produto, arg);
  if (!cofre) return undefined;
  const mudancas = importarAprovacoes(cofre, pastaProduto, produto);
  const r = exportarProduto(cofre, pastaProduto, produto);
  if (log) console.log(`Obsidian: ${r.ganchos} gancho(s) e ${r.angulos} ângulo(s) em ${path.relative(process.cwd(), path.dirname(r.hub))}${mudancas ? ` · ${mudancas} aprovação(ões) lidas do cofre` : ""}`);
  return { cofre, mudancas, ...r };
}

if (require.main === module) {
  const a = args();
  if (!a.produto && !a.radar) {
    console.error("Uso: npm run obsidian -- --produto <pasta> [--cofre <pasta>]   ou   npm run obsidian -- --radar <ofertas.json> [--cofre <pasta>]");
    process.exit(1);
  }
  if (a.produto) {
    const pasta = path.resolve(a.produto);
    const produto = lerJSON(path.join(pasta, "produto.json"));
    if (!sincronizar(pasta, produto, a.cofre)) {
      console.error('Onde fica o cofre? Use --cofre <pasta>, o campo "obsidian": { "cofre": "..." } na ficha ou a variável OBSIDIAN_COFRE.');
      process.exit(1);
    }
  }
  if (a.radar) {
    const cofre = cofreDe(undefined, undefined, a.cofre);
    if (!cofre) {
      console.error("Onde fica o cofre? Use --cofre <pasta> ou a variável OBSIDIAN_COFRE.");
      process.exit(1);
    }
    const r = exportarRadar(cofre, path.resolve(a.radar));
    console.log(`Obsidian: ${r.ofertas} oferta(s) do radar em ${path.relative(process.cwd(), r.dia)}`);
  }
}

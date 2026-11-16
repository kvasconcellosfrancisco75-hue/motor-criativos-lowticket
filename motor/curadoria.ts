/**
 * Curadoria com IA: dos anúncios minerados (npm run minerar), separa os que estão ativos há mais tempo
 * (os "validados") e pede à IA uma análise da copy de cada um: fit com o seu produto (0 a 100),
 * ângulo de venda, estratégia e como adaptar. No fim, gera o report.html.
 *
 *   npm run curadoria -- --produto <pasta>
 *   [--coleta aaaa-mm-dd]     qual coleta usar (padrão: a mais recente)
 *   [--selecionar 30]         quantos anúncios analisar
 *   [--sem-imagens]           não manda a imagem do criativo para a IA (só o texto)
 *   [--sem-midia]             não baixa as mídias (o report usa os links do CDN da Meta, que expiram)
 *   [--modo manual]           não chama a API: escreve pedido-curadoria.md para colar num chat
 *   [--de-arquivo resp.json]  importa a resposta do modo manual
 *   [--modelo claude-opus-5-5]
 *
 * Precisa de credencial da Anthropic no modo api (ANTHROPIC_API_KEY ou `ant auth login`).
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { levaAOferta, type AnuncioFB } from "./anuncio";
import { gerarRelatorio } from "./relatorio";
import { args, lerJSON, salvarJSON } from "./util";

const a = args();
if (!a.produto) {
  console.error("Uso: npm run curadoria -- --produto <pasta> [--coleta aaaa-mm-dd] [--selecionar 30] [--modo manual | --de-arquivo resp.json]");
  process.exit(1);
}
const pasta = path.resolve(a.produto);
const produto = lerJSON(path.join(pasta, "produto.json"));
const cfg = { ...(produto.busca ?? {}), ...(produto.inteligencia ?? {}) };
const pastaInt = path.join(pasta, "inteligencia");
const coletas = fs.existsSync(pastaInt) ? fs.readdirSync(pastaInt).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
const dia = a.coleta ?? coletas[coletas.length - 1];
if (!dia || !fs.existsSync(path.join(pastaInt, dia, "anuncios.json"))) {
  console.error(`Nenhuma coleta em ${pastaInt}. Rode antes: npm run minerar -- --produto ${a.produto}`);
  process.exit(1);
}
const pastaColeta = path.join(pastaInt, dia);
const coleta = lerJSON(path.join(pastaColeta, "anuncios.json"));
const nSelecionar = Number(a.selecionar ?? cfg.selecionar ?? 30);
const objetivo: "modelar" | "ofertas" | "ambos" = cfg.objetivo ?? "ambos";

// ---------- 1. Seleção: os ativos há mais tempo ----------

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const excluir: string[] = (cfg.excluir ?? []).map(sem);

function selecionar(todos: AnuncioFB[]) {
  const motivos: Record<string, number> = {};
  const fora = (m: string) => ((motivos[m] = (motivos[m] ?? 0) + 1), false);

  let lista = todos.filter((x) => {
    if (cfg.so_ativos !== false && !x.ativo) return fora("inativo");
    if (excluir.some((e) => sem(x.pagina).includes(e))) return fora("anunciante excluído");
    if (cfg.so_oferta !== false && cfg.so_infoproduto !== false && !levaAOferta(x, cfg.aceitar_whatsapp !== false)) return fora("não leva a página de venda");
    if (!x.texto && !x.titulo && !x.midias.length) return fora("sem conteúdo");
    return true;
  });

  // Um criativo por grupo: a própria biblioteca agrupa (collation_id), e o mesmo anunciante com o mesmo
  // texto é o mesmo criativo rodando em vários anúncios. Fica o mais antigo; as versões somam.
  const grupos = new Map<string, AnuncioFB & { ids: string[] }>();
  for (const x of lista) {
    const k = x.texto ? `${sem(x.pagina)}|${sem(x.texto).replace(/\W+/g, "").slice(0, 140)}` : `c|${x.colecao}`;
    const g = grupos.get(k);
    if (!g) grupos.set(k, { ...x, ids: [x.id] });
    else {
      g.ids.push(x.id);
      g.versoes = Math.max(g.versoes, x.versoes, g.ids.length);
      if (x.dias > g.dias) Object.assign(g, { ...x, ids: g.ids, versoes: g.versoes });
    }
  }
  const unicos = [...grupos.values()];
  const repetidos = lista.length - unicos.length;
  if (repetidos) motivos["mesmo criativo (agrupado)"] = repetidos;

  // Mais tempo no ar primeiro; empate decide quem escala mais (versões) e quem aparece antes na busca.
  unicos.sort((x, y) => y.dias - x.dias || y.versoes - x.versoes || x.posicao - y.posicao);

  // Variedade: no máximo N criativos por anunciante.
  const maxPorPagina = Number(cfg.max_por_anunciante ?? 3);
  const porPagina = new Map<string, number>();
  const escolhidos: typeof unicos = [];
  for (const x of unicos) {
    const n = porPagina.get(x.pagina) ?? 0;
    if (n >= maxPorPagina) {
      fora(`acima de ${maxPorPagina} por anunciante`);
      continue;
    }
    porPagina.set(x.pagina, n + 1);
    escolhidos.push(x);
    if (escolhidos.length >= nSelecionar) break;
  }
  return { escolhidos, motivos, unicos: unicos.length };
}

// ---------- 2. Formato da análise ----------

const ANGULOS = ["dor", "desejo", "transformacao", "identificacao", "prova_social", "autoridade", "curiosidade", "mecanismo_novo", "oferta_preco", "urgencia_escassez", "medo_perda", "quebra_objecao", "contraste", "historia"] as const;

const Analise = z.object({
  id: z.string().describe("O id do anúncio, exatamente como veio."),
  fit: z.number().int().describe("Fit com o produto da ficha, de 0 a 100, pela régua do sistema."),
  fit_motivo: z.string().describe("Uma ou duas frases: por que essa nota (público, dor, promessa, formato de oferta)."),
  angulo: z.enum(ANGULOS).describe("O ângulo de venda principal."),
  angulo_nome: z.string().describe("Nome curto e específico do ângulo, 2 a 5 palavras (ex.: 'Vergonha de postar sem roteiro')."),
  estrategia: z.string().describe("Como a copy vende: a sequência de ideias, o gatilho principal e por que provavelmente funciona para esse público. 2 a 4 frases."),
  gancho: z.string().describe("O gancho (a primeira frase ou a primeira ideia que prende), como aparece no anúncio."),
  tipo_gancho: z.enum(["pergunta", "afirmacao_chocante", "numero", "identificacao", "contradicao", "promessa", "historia", "chamada_publico", "objecao", "curiosidade"]),
  publico: z.string().describe("Para quem o anúncio fala, em poucas palavras."),
  promessa: z.string().describe("A promessa central, em uma frase."),
  oferta: z.string().describe("O que se vende e como (produto, preço, bônus, garantia), só o que aparece no anúncio. Vazio se não aparece."),
  gatilhos: z.array(z.string()).describe("2 a 5 gatilhos mentais usados (ex.: prova social, escassez, autoridade, novidade)."),
  estrutura: z.array(z.string()).describe("A estrutura da copy em 3 a 6 passos curtos (ex.: 'Gancho de dor', 'Agitação', 'Mecanismo', 'Oferta', 'CTA')."),
  como_adaptar: z.string().describe("Como modelar esse anúncio para o produto da ficha sem copiar frases: o ângulo, a estrutura e um exemplo de gancho novo. 2 a 3 frases."),
  gancho_adaptado: z.string().describe("Um gancho novo, escrito para o produto da ficha, que usa a mesma mecânica (não a mesma frase)."),
  potencial_oferta: z.number().int().describe("0 a 100: o quanto essa OFERTA (não só o criativo) parece validada e replicável como produto low ticket."),
  alerta: z.string().describe("Risco de política de anúncios ou promessa exagerada que não se deve copiar. Vazio se não há."),
});
const Lote = z.object({ analises: z.array(Analise) });
const Resumo = z.object({
  panorama: z.string().describe("3 a 4 frases sobre o que o mercado está fazendo nesses anúncios validados."),
  padroes: z.array(z.string()).describe("4 a 6 padrões que se repetem nos anúncios de maior fit (ganchos, formatos, ofertas)."),
  oportunidades: z.array(z.string()).describe("3 a 5 lacunas ou ângulos pouco explorados que o produto da ficha pode ocupar."),
  ganchos_para_testar: z.array(z.string()).describe("5 ganchos novos para o produto da ficha, inspirados nos anúncios de maior fit."),
  recomendacao: z.string().describe("A próxima ação recomendada, em 2 frases: o que modelar primeiro e por quê."),
});
type TAnalise = z.infer<typeof Analise>;
type TResumo = z.infer<typeof Resumo>;

// ---------- 3. Pedido ----------

const fichaResumo = () => {
  const p = produto;
  const linhas = [
    `Produto: ${p.nome ?? "(sem nome)"}${p.marca ? ` (${p.marca})` : ""}`,
    p.inteligencia?.descricao && `O que é: ${p.inteligencia.descricao}`,
    p.publico && `Público: ${p.publico}`,
    p.promessa && `Promessa: ${p.promessa}`,
    p.entregaveis?.resumo && `Entrega: ${p.entregaveis.resumo}. ${p.entregaveis.detalhe ?? ""}`,
    p.diferencial?.fala && `Diferencial: ${p.diferencial.fala}`,
    p.oferta?.resumo && `Oferta: ${p.oferta.resumo}`,
    p.angulos?.length && `Dores já mapeadas: ${p.angulos.map((x: any) => x.dor).filter(Boolean).join("; ")}`,
    p.inteligencia?.contexto && `Contexto extra: ${p.inteligencia.contexto}`,
    p.restricoes?.length && `Restrições: ${p.restricoes.join("; ")}`,
  ];
  return linhas.filter(Boolean).join("\n");
};

const FOCO = {
  modelar: "O objetivo é achar criativos validados para MODELAR o produto da ficha. Dê mais peso ao fit e ao 'como adaptar'.",
  ofertas: "O objetivo é descobrir OFERTAS que já vendem, para criar ou ajustar um produto. Dê atenção especial à oferta e ao 'potencial_oferta'.",
  ambos: "O objetivo é duplo: achar criativos para modelar o produto da ficha e ofertas validadas que valham a pena replicar.",
}[objetivo];

const SISTEMA = `Você é estrategista de growth e copywriter de resposta direta, especialista em infoprodutos low ticket no Brasil.
Você analisa anúncios da Biblioteca de Anúncios da Meta que estão no ar há muito tempo (sinal indireto de que dão lucro) e explica, com precisão, por que funcionam.

O produto que você está ajudando a vender:
${fichaResumo()}

${FOCO}

Régua de fit (0 a 100) com o produto acima:
- 85 a 100: mesmo público E mesma dor ou promessa. Dá para modelar quase direto.
- 65 a 84: mesmo público ou mesma promessa, com outro produto. Adaptar o ângulo.
- 40 a 64: nicho vizinho; o ângulo ou a estrutura servem, o público não.
- 0 a 39: pouco a ver; serve só como referência de formato.

Regras:
- Analise o que está no anúncio (copy, título, CTA, destino e a imagem, se houver). Não invente preço, resultado ou depoimento que não aparece.
- Seja específico: "gancho de identificação com a rotina da nutri que perde a tarde gravando" e não "gancho emocional".
- No "como_adaptar" e no "gancho_adaptado", use só fatos do produto acima e respeite as restrições. Nunca copie frases do anúncio.
- Escreva em português do Brasil, frases curtas, sem jargão desnecessário.`;

const blocoAnuncio = (x: AnuncioFB) =>
  [
    `### Anúncio ${x.id}`,
    `Anunciante: ${x.pagina} | no ar há ${x.dias} dias (desde ${x.inicio}) | ${x.versoes} versão(ões) | formato: ${x.formato || "?"} | destino: ${x.dominio || "?"}`,
    x.titulo && `Título: ${x.titulo}`,
    x.texto && `Copy:\n${x.texto.slice(0, 2500)}`,
    x.cards.length > 1 && `Cards do carrossel:\n${x.cards.map((c, i) => `${i + 1}. ${c.titulo} — ${c.texto}`.slice(0, 300)).join("\n")}`,
    x.descricao_link && `Descrição do link: ${x.descricao_link}`,
    x.cta && `Botão: ${x.cta}`,
  ]
    .filter(Boolean)
    .join("\n");

const imagemDe = (x: AnuncioFB) => {
  const m = x.midias[0];
  return m ? (m.tipo === "video" ? m.poster : m.url) : undefined;
};

// ---------- 4. Chamada à API ----------

const client = new Anthropic();
const modelo = a.modelo ?? "claude-opus-5-5";

async function analisarLote(lote: AnuncioFB[], comImagens: boolean): Promise<TAnalise[]> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: `Analise estes ${lote.length} anúncios. Devolva uma análise por anúncio, na mesma ordem, com o id exato.` }];
  for (const x of lote) {
    const img = comImagens ? imagemDe(x) : undefined;
    if (img) content.push({ type: "image", source: { type: "url", url: img } });
    content.push({ type: "text", text: blocoAnuncio(x) });
  }
  const stream = client.beta.messages.stream({
    model: modelo,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Lote) },
    system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("O modelo recusou analisar um lote.");
  if (msg.stop_reason === "max_tokens") throw new Error("A resposta de um lote passou do limite; use lotes menores (--lote 5).");
  const r = msg.parsed_output as z.infer<typeof Lote> | null;
  if (!r) throw new Error("A resposta não veio no formato esperado.");
  return r.analises;
}

async function analisarPelaApi(escolhidos: AnuncioFB[]) {
  const tam = Number(a.lote ?? 6);
  const lotes: AnuncioFB[][] = [];
  for (let i = 0; i < escolhidos.length; i += tam) lotes.push(escolhidos.slice(i, i + tam));
  console.log(`Analisando ${escolhidos.length} anúncios com ${modelo} em ${lotes.length} lotes...`);
  let feitos = 0;
  const resultados = await Promise.all(
    lotes.map(async (lote, i) => {
      let r: TAnalise[];
      try {
        r = await analisarLote(lote, !a["sem-imagens"]);
      } catch (e) {
        // Imagem do CDN da Meta expirada ou inacessível derruba o pedido: tenta de novo só com o texto.
        if (e instanceof Anthropic.BadRequestError && !a["sem-imagens"]) {
          console.log(`  lote ${i + 1}: imagem inacessível, refazendo só com o texto.`);
          r = await analisarLote(lote, false);
        } else throw e;
      }
      feitos += lote.length;
      console.log(`  ${feitos}/${escolhidos.length}`);
      return r;
    }),
  );
  const analises = resultados.flat();

  console.log("Escrevendo o resumo estratégico...");
  const compacto = escolhidos.map((x) => {
    const an = analises.find((y) => y.id === x.id);
    return `- [fit ${an?.fit ?? "?"}] ${x.pagina}, ${x.dias} dias no ar, ${x.versoes} versões. Ângulo: ${an?.angulo_nome}. Gancho: "${an?.gancho}". Oferta: ${an?.oferta || "-"}. Estratégia: ${an?.estrategia}`;
  });
  const stream = client.beta.messages.stream({
    model: modelo,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(Resumo) },
    system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Estas são as análises dos ${escolhidos.length} anúncios validados do nicho. Escreva o resumo estratégico.\n\n${compacto.join("\n")}` }],
  });
  const msg = await stream.finalMessage();
  const resumo = (msg.parsed_output as TResumo | null) ?? undefined;
  return { analises, resumo, modelo: msg.model };
}

// ---------- 5. Modo manual (sem chave da API) ----------

function escreverPedidoManual(escolhidos: AnuncioFB[]) {
  const formato = z.toJSONSchema(z.object({ analises: z.array(Analise), resumo: Resumo }));
  const arq = path.join(pastaColeta, "pedido-curadoria.md");
  const md = [
    "# Pedido de curadoria (cole num chat com o Claude)",
    "",
    SISTEMA,
    "",
    `Analise os ${escolhidos.length} anúncios abaixo e escreva o resumo estratégico. Responda SÓ com um JSON válido neste formato:`,
    "```json",
    JSON.stringify(formato, null, 1),
    "```",
    "",
    ...escolhidos.map(blocoAnuncio),
  ].join("\n\n");
  fs.writeFileSync(arq, md);
  console.log(`Pedido escrito em ${arq}.\nCole num chat, salve a resposta como JSON e rode:\n  npm run curadoria -- --produto ${a.produto} --coleta ${dia} --de-arquivo resposta.json`);
}

// ---------- 6. Mídias locais ----------

/**
 * Os links do CDN da Meta são assinados e expiram em poucos dias. Baixa a mídia dos selecionados para
 * <coleta>/midia/ (o report usa o caminho relativo); se não der, fica o link remoto.
 * Usa o curl, que respeita HTTPS_PROXY (o fetch do Node ignora proxy).
 */
function baixarMidias(lista: AnuncioFB[]) {
  const pastaMidia = path.join(pastaColeta, "midia");
  fs.mkdirSync(pastaMidia, { recursive: true });
  let ok = 0, falhas = 0;
  const baixar = (url: string | undefined, nome: string) => {
    if (!url || !/^https?:/.test(url)) return url;
    const ext = (new URL(url).pathname.match(/\.(mp4|jpe?g|png|webp|gif)$/i)?.[1] ?? (nome.startsWith("v") ? "mp4" : "jpg")).toLowerCase();
    const arq = path.join(pastaMidia, `${nome}.${ext}`);
    if (!(fs.existsSync(arq) && fs.statSync(arq).size > 0)) {
      const r = spawnSync("curl", ["-sfL", "--max-time", "90", "-o", arq, url]);
      if (r.status !== 0) {
        fs.rmSync(arq, { force: true });
        falhas++;
        return url;
      }
    }
    ok++;
    return `midia/${path.basename(arq)}`;
  };
  for (const x of lista) {
    x.pagina_foto = baixar(x.pagina_foto, `p${x.pagina_id || x.id}`) ?? "";
    x.midias = x.midias.map((m, i) => ({
      ...m,
      url: baixar(m.url, `${m.tipo === "video" ? "v" : "i"}${x.id}-${i}`)!,
      poster: m.poster ? baixar(m.poster, `c${x.id}-${i}`) : undefined,
    }));
  }
  if (!ok && falhas) fs.rmSync(pastaMidia, { recursive: true, force: true });
  console.log(ok ? `Mídias salvas em ${pastaMidia} (${ok} arquivos${falhas ? `, ${falhas} falharam e ficam com o link remoto` : ""}).` : `Não consegui baixar as mídias (rede bloqueia *.fbcdn.net?); o report usa os links remotos, que expiram em alguns dias.`);
}

// ---------- 7. Juntar e salvar ----------

async function main() {
  const todos: AnuncioFB[] = coleta.anuncios;
  const { escolhidos, motivos, unicos } = selecionar(todos);
  console.log(`Coleta ${dia}: ${todos.length} anúncios, ${unicos} criativos únicos aproveitáveis, ${escolhidos.length} selecionados (ativos há mais tempo).`);
  for (const [m, n] of Object.entries(motivos)) console.log(`  fora: ${n} × ${m}`);
  if (!escolhidos.length) throw new Error("Nenhum anúncio passou nos filtros. Revise os termos ou desligue so_oferta na ficha.");

  let analises: TAnalise[];
  let resumo: TResumo | undefined;
  let usado = modelo;
  if (a["de-arquivo"]) {
    const r = lerJSON(path.resolve(a["de-arquivo"]));
    analises = Lote.parse({ analises: r.analises }).analises;
    resumo = r.resumo ? Resumo.parse(r.resumo) : undefined;
    usado = a.modelo ?? "importado";
  } else if (a.modo === "manual") {
    return escreverPedidoManual(escolhidos);
  } else {
    ({ analises, resumo, modelo: usado } = await analisarPelaApi(escolhidos));
  }

  if (!a["sem-midia"] && cfg.baixar_midia !== false) baixarMidias(escolhidos);

  const porId = new Map(analises.map((x) => [x.id, x]));
  const semAnalise = escolhidos.filter((x) => !porId.has(x.id));
  if (semAnalise.length) console.log(`  atenção: ${semAnalise.length} anúncio(s) ficaram sem análise: ${semAnalise.map((x) => x.id).join(", ")}`);
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const selecionados = escolhidos.map((x) => {
    const an = porId.get(x.id);
    return { ...x, analise: an ? { ...an, fit: clamp(an.fit), potencial_oferta: clamp(an.potencial_oferta) } : undefined };
  });

  const curadoria = {
    produto: { id: produto.id, nome: produto.nome, marca: produto.marca },
    coleta: dia,
    gerado_em: new Date().toISOString(),
    modelo: usado,
    objetivo,
    termos: coleta.termos,
    pais: coleta.pais,
    total_minerado: todos.length,
    criativos_unicos: unicos,
    filtros: motivos,
    resumo,
    selecionados,
  };
  salvarJSON(path.join(pastaColeta, "curadoria.json"), curadoria);
  const html = await gerarRelatorio(curadoria, path.join(pastaColeta, "report.html"));
  // Cópia na pasta de inteligência (sempre a última coleta), com o caminho das mídias locais ajustado.
  const copia = JSON.parse(JSON.stringify(curadoria).split('"midia/').join(`"${dia}/midia/`));
  await gerarRelatorio(copia, path.join(pastaInt, "report.html"));
  const fits = selecionados.map((x) => x.analise?.fit ?? 0).sort((x, y) => y - x);
  console.log(`\nFit médio ${Math.round(fits.reduce((s, n) => s + n, 0) / fits.length)} · ${fits.filter((f) => f >= 65).length} anúncios com fit alto (65+).`);
  console.log(`Curadoria: ${path.join(pastaColeta, "curadoria.json")}`);
  console.log(`Dashboard: ${html}  (cópia em ${path.join(pastaInt, "report.html")})`);
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) console.error("Sem credencial da Anthropic. Defina ANTHROPIC_API_KEY, rode `ant auth login`, ou use --modo manual.");
  else if (err instanceof Anthropic.RateLimitError) console.error("Limite de uso da API atingido. Tente de novo em alguns minutos.");
  else if (err instanceof Anthropic.APIError) console.error(`Erro da API (${err.status}): ${err.message}`);
  else console.error(err?.message ?? err);
  process.exit(1);
});

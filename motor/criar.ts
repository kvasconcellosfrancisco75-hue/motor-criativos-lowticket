/**
 * Cria ângulos, ganchos e copy NOVOS a partir dos fatos da ficha do produto. A cada rodada o motor
 * lê tudo o que já foi criado para o produto e recusa o que se repete: ângulo, gancho e copy variam sempre.
 *
 *   npm run criar -- --produto <pasta> [--angulos 3] [--ganchos 3] [--nome criacao-01]
 *   npm run criar -- --produto <pasta> --modo manual            # só escreve o pedido (pedido.md) para colar num chat
 *   npm run criar -- --produto <pasta> --importar resposta.json # valida e salva uma resposta feita fora do motor
 *
 * Modo api (padrão): chama a API da Anthropic (precisa de ANTHROPIC_API_KEY ou `ant auth login`).
 * Saída em <produto>/criacoes/<nome>.json (entrada de `npm run roteiros`) e <nome>.md (folha de revisão).
 * Para reprovar algo, troque "aprovado" para false no .json antes de gerar os roteiros.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { lerReferencias } from "./referencias";
import { carregarFormulas, montarCenas, narracaoDe, segundosEstimados } from "./montar";
import { args, contarPalavras, lerJSON, salvarJSON, slug } from "./util";

// ---------- Formato da resposta ----------

const Linhas = z.array(z.string()).describe("Texto na tela, quebrado em 2 a 4 linhas curtas (até 24 caracteres cada).");
const Gancho = z.object({
  tipo: z.enum(["identificacao", "numero", "contradicao", "pergunta", "cena", "objecao", "curiosidade"]),
  texto: z.string().describe("Fala do gancho, números por extenso."),
  linhas: Linhas,
  marca: z.string().describe("Palavra ou trecho das linhas que fica destacado."),
});
const Angulo = z.object({
  id: z.string().describe("Nome curto em kebab-case."),
  referencia: z.string().describe("Link da referência validada em que este ângulo se baseia, ou \"nenhuma\"."),
  aproveita: z.string().describe("O que foi aproveitado da referência: estrutura, tipo de gancho, ritmo, virada. Nunca as frases."),
  base: z.enum(["dor", "desejo", "objecao", "inimigo", "identidade", "custo"]),
  consciencia: z.enum(["inconsciente", "problema", "solucao", "produto"]),
  dor: z.string().describe("A dor ou o desejo deste ângulo, numa frase."),
  legenda_gancho: z.string().describe("Primeira frase da legenda do anúncio."),
  ganchos: z.array(Gancho),
  promessa: z.object({ fala: z.string(), antes: z.string(), citacao: z.string() }).describe("A promessa ou crença que a pessoa repete e não se cumpre."),
  numero: z.object({ fala: z.string(), antes: z.string(), valor: z.number(), depois: z.string() }).describe("Um número da situação da pessoa que dói (ilustrativo, não é dado do produto)."),
  copy: z.object({
    mecanismo: z.object({ fala: z.string(), linhas: Linhas }),
    entregaveis: z.object({ fala: z.string(), antes: z.string(), unidade_frase: z.string(), marca: z.string(), fala_itens: z.string(), titulo_itens: z.string(), itens: z.array(z.string()) }),
    diferencial: z.object({ fala: z.string(), linhas: Linhas, marca: z.string() }),
    slogan: z.object({ fala: z.string(), palavras: z.array(z.string()).describe("Exatamente 3 batidas.") }),
    oferta: z.object({ fala: z.string() }),
    como_usar: z.string(),
    cta: z.object({ fala: z.string(), pergunta: Linhas, complemento: z.array(z.string()), marca: z.string() }),
  }),
});
const Resposta = z.object({ angulos: z.array(Angulo) });
type TResposta = z.infer<typeof Resposta>;

// ---------- Entrada ----------

const a = args();
if (!a.produto) {
  console.error("Uso: npm run criar -- --produto <pasta> [--angulos 3] [--ganchos 3] [--nome nome] [--modo api|manual] [--importar arquivo.json]");
  process.exit(1);
}
const pastaProduto = path.resolve(a.produto);
const produto = lerJSON(path.join(pastaProduto, "produto.json"));
// Referências da Biblioteca de Anúncios: com modelos validados, testa-se menos variações (2 × 2 em vez de 3 × 3).
const todasRefs = lerReferencias(pastaProduto);
const validadas = todasRefs.filter((r) => r.nivel === "validado");
const refs = (validadas.length ? validadas : todasRefs.filter((r) => r.nivel === "promissor")).slice(0, 5);
const nAngulos = Number(a.angulos ?? (refs.length ? Math.min(2, refs.length) : 3));
const nGanchos = Number(a.ganchos ?? (refs.length ? 2 : 3));
const teto = Number(produto.teto_segundos ?? 30);
const pastaCriacoes = path.join(pastaProduto, "criacoes");
const agora = new Date();
const nome = a.nome ?? `criacao-${agora.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-")}`;
const formulas = carregarFormulas().filter((f) => (produto.formulas ?? [f.id]).includes(f.id));

// ---------- Histórico: tudo o que já foi criado para este produto ----------

const historico = { angulos: [] as string[], ganchos: [] as string[], copy: [] as string[] };
if (fs.existsSync(pastaCriacoes)) {
  for (const f of fs.readdirSync(pastaCriacoes).filter((f) => f.endsWith(".json") && f !== `${nome}.json`)) {
    for (const an of lerJSON(path.join(pastaCriacoes, f)).angulos ?? []) {
      historico.angulos.push(an.dor);
      for (const g of an.ganchos ?? []) historico.ganchos.push(g.texto);
      if (an.copy) historico.copy.push(an.copy.mecanismo?.fala, an.copy.slogan?.fala, an.copy.cta?.fala, an.promessa?.fala, an.numero?.fala);
    }
  }
}
// Criativos aprovados antes do motor (ex.: um vídeo que já está no ar) também contam como "já usado".
for (const r of produto.referencias ?? []) historico.copy.push(...String(r.narracao ?? r).split(/(?<=[.?!])\s+/));
historico.copy = historico.copy.filter(Boolean);

// ---------- Pedido ----------

const palavrasMax = Math.floor((teto - 1.5 - 7 * 0.3 - 1.5) * 2.8);

const SISTEMA = `Você é redator de anúncios em vídeo (Reels, Stories e Feed) para infoprodutos de baixo preço, em português do Brasil.
Seu trabalho é criar ÂNGULOS, GANCHOS e COPY novos para um produto, a partir só dos fatos da ficha.

Como pensar:
- Ângulo é a porta de entrada: uma dor, um desejo, uma objeção, um inimigo comum, uma identidade ou um custo escondido do público. Cada ângulo da rodada deve partir de uma base diferente e, se possível, de um nível de consciência diferente.
- Gancho são os 3 primeiros segundos: precisa fazer a pessoa do público parar. Use tipos diferentes entre os ganchos do mesmo ângulo (identificação, número, contradição, pergunta, cena reconhecível, objeção, curiosidade). Concreto vence genérico: uma cena do dia a dia, um número, uma frase que a pessoa já disse.
- A copy de cada ângulo conta UMA história curta: dor → situação em que ela pesa (promessa que não se cumpre, número que dói) → virada (mecanismo do produto) → o que a pessoa recebe → slogan em 3 batidas → pergunta final e chamada. A copy deve conversar com o ângulo; não reaproveite a mesma copy entre ângulos.
- Escreva como se fala: frases curtas, sem jargão de marketing, sem exagero.

Regras que não podem ser quebradas:
- Use só fatos da ficha. Todo número sobre o produto (quantidades, preço, garantia, resultados) precisa estar na ficha. O "número que dói" é da situação da pessoa e pode ser ilustrativo, mas tem de ser verossímil.
- Respeite as restrições da ficha e as políticas de anúncios da Meta: sem promessa de resultado garantido, sem antes e depois, sem afirmar atributos pessoais sensíveis de quem assiste (saúde, peso, finanças).
- Nas falas (campos "fala" e "texto"), escreva números por extenso ("cem", "oitenta e três"): a voz lê melhor. No texto da tela (linhas, antes, depois, unidade_frase, itens), use algarismos.
- O destaque ("marca") precisa aparecer exatamente, letra por letra, nas linhas a que se refere.
- Nas linhas do mecanismo, escreva o nome da marca exatamente como na ficha.
- A pergunta do CTA (cta.pergunta) é o texto da tela; cta.fala é a pergunta falada seguida de "Toque em" e o texto do botão.
- Slogan: exatamente 3 batidas curtas.
- Duração: a narração inteira de um vídeo (gancho + promessa + número + mecanismo + entregáveis + slogan + CTA) deve ter no máximo ${palavrasMax} palavras, para caber em ${teto} segundos.
- NÃO repita nem parafraseie de perto nada da lista "já usado". Variar sempre é o objetivo: ângulo, gancho e copy novos a cada rodada.

Quando o pedido trouxer "modelos que já provaram funcionar" (anúncios que estão há semanas no ar na Biblioteca de Anúncios):
- Baseie cada ângulo em um modelo diferente e diga qual no campo "referencia" (o link) e o que aproveitou no campo "aproveita".
- Aproveite o que fez o modelo funcionar: a estrutura, o tipo e a mecânica do gancho, a ordem das ideias, o ritmo, a virada. Adapte ao produto e ao público da ficha.
- Nunca copie frases do modelo nem cite o anunciante. Os fatos continuam vindo só da ficha.`;

const fatos = { ...produto };
for (const k of ["visual", "personagem", "ativos", "angulos", "referencias", "formatos", "formulas", "observacao"]) delete fatos[k];

const pedido = `Ficha do produto (fatos):
${JSON.stringify(fatos, null, 2)}

Já usado (não repetir):
- Ângulos: ${historico.angulos.length ? historico.angulos.map((x) => `"${x}"`).join("; ") : "nenhum"}
- Ganchos: ${historico.ganchos.length ? historico.ganchos.map((x) => `"${x}"`).join("; ") : "nenhum"}
- Frases de copy: ${historico.copy.length ? historico.copy.map((x) => `"${x}"`).join("; ") : "nenhuma"}

${
  refs.length
    ? `Modelos que já provaram funcionar (do mais forte para o mais fraco):\n${refs
        .map((r) => `- ${r.link} · ${r.dias} dias no ar · ${r.versoes} versão(ões) · público ${r.publico} · formato ${r.formato}${r.duracao_s ? ` · ${r.duracao_s} s` : ""}\n  Gancho: "${r.gancho}"\n  Transcrição: "${r.transcricao}"\n  CTA: "${r.cta}"${r.observacao ? `\n  Observação: ${r.observacao}` : ""}`)
        .join("\n")}\n\n`
    : ""
}Crie ${nAngulos} ângulos, cada um com ${nGanchos} ganchos e a copy completa.`;

// ---------- Validação ----------

type Problema = { angulo: number; gancho?: number; msg: string };

const tokens = (s: string) =>
  new Set(
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
// A chamada final ("Toque em Saiba Mais") é igual em todo criativo: não conta como repetição.
const semChamada = (s: string) => s.replace(new RegExp(`toque em\\s+${(produto.cta?.botao ?? "saiba mais").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?`, "gi"), "");
const parecido = (x: string, y: string) => {
  const A = tokens(semChamada(x));
  const B = tokens(semChamada(y));
  // Frases muito curtas ("Já foram cem reels.") dariam falso positivo com qualquer texto.
  if (A.size < 4 || B.size < 4) return 0;
  let comum = 0;
  for (const w of A) if (B.has(w)) comum++;
  return comum / Math.min(A.size, B.size);
};
const contem = (lista: string[] | string, trecho: string) => (Array.isArray(lista) ? lista.join(" ") : lista).includes(trecho);
const numerosPermitidos = new Set(
  JSON.stringify(fatos)
    .match(/\d+/g)
    ?.map(String) ?? [],
);

function validar(r: TResposta): Problema[] {
  const p: Problema[] = [];
  if (r.angulos.length !== nAngulos) p.push({ angulo: -1, msg: `Pedi ${nAngulos} ângulos e vieram ${r.angulos.length}.` });
  r.angulos.forEach((an, i) => {
    const e = (msg: string, gancho?: number) => p.push({ angulo: i, gancho, msg });
    if (an.ganchos.length !== nGanchos) e(`Pedi ${nGanchos} ganchos e vieram ${an.ganchos.length}.`);
    if (refs.length) {
      if (!refs.some((r) => r.link === an.referencia)) e(`A referência "${an.referencia}" não está entre os modelos validados.`);
      else if (refs.length >= nAngulos && r.angulos.slice(0, i).some((o) => o.referencia === an.referencia)) e("Dois ângulos baseados na mesma referência; use modelos diferentes.");
      const textosRef = refs.flatMap((x) => [x.gancho, ...x.transcricao.split(/(?<=[.?!])\s+/)]).filter(Boolean);
      for (const f of [...an.ganchos.map((g) => g.texto), an.promessa.fala, an.numero.fala, an.copy.mecanismo.fala, an.copy.slogan.fala, an.copy.cta.fala])
        for (const t of textosRef) if (parecido(f, t) >= 0.6) e(`"${f}" copia a referência: "${t}".`);
    }
    const falas = [an.promessa.fala, an.numero.fala, an.copy.mecanismo.fala, an.copy.entregaveis.fala, an.copy.diferencial.fala, an.copy.slogan.fala, an.copy.oferta.fala, an.copy.cta.fala];
    falas.forEach((f) => /\d/.test(f) && e(`Número em algarismo na fala "${f}": escreva por extenso.`));
    const tela = [...an.copy.mecanismo.linhas, an.copy.entregaveis.antes, an.copy.entregaveis.unidade_frase, ...an.copy.entregaveis.itens, ...an.copy.diferencial.linhas];
    for (const n of tela.join(" ").match(/\d+/g) ?? []) if (!numerosPermitidos.has(n)) e(`O número ${n} aparece na tela mas não está na ficha.`);
    if (produto.marca && !contem(an.copy.mecanismo.linhas, produto.marca)) e(`As linhas do mecanismo não trazem a marca "${produto.marca}".`);
    if (!contem(an.copy.entregaveis.unidade_frase, an.copy.entregaveis.marca)) e(`O destaque "${an.copy.entregaveis.marca}" não está em entregaveis.unidade_frase.`);
    if (!contem(an.copy.diferencial.linhas, an.copy.diferencial.marca)) e(`O destaque "${an.copy.diferencial.marca}" não está nas linhas do diferencial.`);
    if (!contem(an.copy.cta.pergunta, an.copy.cta.marca)) e(`O destaque "${an.copy.cta.marca}" não está na pergunta do CTA.`);
    if (an.copy.slogan.palavras.length !== 3) e("O slogan precisa de exatamente 3 batidas.");
    for (const proibida of produto.proibidas ?? []) for (const f of [...falas, an.legenda_gancho]) if (f.toLowerCase().includes(String(proibida).toLowerCase())) e(`Expressão proibida pela ficha: "${proibida}".`);
    for (const h of historico.angulos) if (parecido(an.dor, h) >= 0.6) e(`Ângulo parecido com um já usado: "${h}".`);
    for (const f of [an.copy.mecanismo.fala, an.copy.slogan.fala, an.copy.cta.fala, an.promessa.fala, an.numero.fala])
      for (const h of historico.copy) if (parecido(f, h) >= 0.7) e(`"${f}" repete uma frase já usada: "${h}".`);
    r.angulos.slice(0, i).forEach((outro) => parecido(an.dor, outro.dor) >= 0.6 && e(`Ângulo parecido com "${outro.id}" desta mesma rodada.`));
    an.ganchos.forEach((g, j) => {
      if (/\d/.test(g.texto)) e(`Número em algarismo no gancho "${g.texto}".`, j);
      if (g.linhas.length < 2 || g.linhas.length > 4) e("O gancho precisa de 2 a 4 linhas na tela.", j);
      if (g.linhas.some((l) => l.length > 26)) e("Linha do gancho longa demais para a tela (máx. 26 caracteres).", j);
      if (!contem(g.linhas, g.marca)) e(`O destaque "${g.marca}" não está nas linhas do gancho.`, j);
      for (const h of historico.ganchos) if (parecido(g.texto, h) >= 0.5) e(`Gancho parecido com um já usado: "${h}".`, j);
      for (const h of historico.copy) if (parecido(g.texto, h) >= 0.6) e(`Gancho repete uma frase já usada: "${h}".`, j);
      r.angulos.forEach((an2, i2) => an2.ganchos.forEach((g2, j2) => (i2 < i || (i2 === i && j2 < j)) && parecido(g.texto, g2.texto) >= 0.5 && e(`Gancho parecido com outro desta rodada: "${g2.texto}".`, j)));
      for (const f of formulas) {
        try {
          const cenas = montarCenas(f, produto, an, g);
          const seg = segundosEstimados(cenas);
          if (seg > teto) e(`Com a fórmula ${f.id} o vídeo fica com ~${seg.toFixed(1)} s (${contarPalavras(narracaoDe(cenas))} palavras); o teto é ${teto} s.`, j);
        } catch (err: any) {
          e(`A fórmula ${f.id} não fecha: ${err.message}`, j);
        }
      }
    });
  });
  return p;
}

const descrever = (r: TResposta, p: Problema) =>
  p.angulo < 0 ? p.msg : `[${r.angulos[p.angulo]?.id}${p.gancho !== undefined ? ` / gancho ${p.gancho + 1}` : ""}] ${p.msg}`;

// ---------- Geração ----------

async function gerarPelaApi(): Promise<{ r: TResposta; modelo: string; problemas: Problema[] }> {
  const client = new Anthropic();
  const modelo = a.modelo ?? "claude-opus-5-5";
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: pedido }];
  for (let rodada = 1; ; rodada++) {
    process.stdout.write(`Rodada ${rodada}: pedindo ${nAngulos} ângulos × ${nGanchos} ganchos a ${modelo}... `);
    const stream = client.beta.messages.stream({
      model: modelo,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(Resposta) },
      system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
      messages,
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("O modelo recusou o pedido. Revise a ficha (restrições, termos sensíveis) e tente de novo.");
    if (msg.stop_reason === "max_tokens") throw new Error("A resposta passou do limite de tamanho. Peça menos ângulos ou ganchos por rodada.");
    const r = msg.parsed_output as TResposta | null;
    if (!r) throw new Error("A resposta não veio no formato esperado.");
    const problemas = validar(r);
    console.log(problemas.length ? `${problemas.length} problema(s).` : "ok.");
    if (!problemas.length || rodada >= 3) return { r, modelo: msg.model, problemas };
    // Devolve os problemas para o modelo corrigir, mantendo a conversa como está.
    messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    messages.push({ role: "user", content: `A validação do motor encontrou estes problemas. Corrija-os e devolva a resposta completa de novo (todos os ângulos):\n${problemas.map((p) => "- " + descrever(r, p)).join("\n")}` });
  }
}

function salvar(r: TResposta, modelo: string, problemas: Problema[]) {
  const ruins = new Set(problemas.filter((p) => p.gancho === undefined).map((p) => p.angulo));
  const ganchosRuins = new Set(problemas.filter((p) => p.gancho !== undefined).map((p) => `${p.angulo}/${p.gancho}`));
  const angulos = r.angulos.map((an, i) => ({
    ...an,
    id: slug(an.id),
    aprovado: !ruins.has(i),
    problemas: problemas.filter((p) => p.angulo === i && p.gancho === undefined).map((p) => p.msg),
    ganchos: an.ganchos.map((g, j) => ({ ...g, aprovado: !ganchosRuins.has(`${i}/${j}`), problemas: problemas.filter((p) => p.angulo === i && p.gancho === j).map((p) => p.msg) })),
  }));
  salvarJSON(path.join(pastaCriacoes, `${nome}.json`), { produto: produto.id, criado_em: agora.toISOString(), modelo, angulos });

  const f = formulas[0];
  const md = [`# ${produto.nome} · ${nome}`, "", `${angulos.length} ângulos, ${angulos.reduce((s, x) => s + x.ganchos.length, 0)} ganchos. Gerado por ${modelo}.`, "Para reprovar, troque \"aprovado\" para false no .json.", ""];
  for (const an of angulos) {
    md.push(`## ${an.aprovado ? "" : "⚠ "}${an.id} · ${an.base} · consciência: ${an.consciencia}`, "", `**Dor:** ${an.dor}`, "");
    if (an.referencia && an.referencia !== "nenhuma") md.push(`**Baseado em:** ${an.referencia} — ${an.aproveita}`, "");
    md.push("**Ganchos**", "");
    an.ganchos.forEach((g) => md.push(`- ${g.aprovado ? "" : "⚠ "}(${g.tipo}) ${g.texto}${g.problemas.length ? ` — ${g.problemas.join(" ")}` : ""}`));
    if (f) {
      try {
        const cenas = montarCenas(f, produto, an, an.ganchos[0]);
        md.push("", `**Narração com o 1º gancho (${f.id}, ~${segundosEstimados(cenas).toFixed(1)} s)**`, "", narracaoDe(cenas));
      } catch {}
    }
    md.push("", `**Legenda:** ${an.legenda_gancho}`);
    if (an.problemas.length) md.push("", `**Problemas:** ${an.problemas.join(" ")}`);
    md.push("");
  }
  fs.writeFileSync(path.join(pastaCriacoes, `${nome}.md`), md.join("\n"));
  const aprov = angulos.reduce((s, x) => s + (x.aprovado ? x.ganchos.filter((g) => g.aprovado).length : 0), 0);
  console.log(`Criação salva: ${path.join(pastaCriacoes, nome)}.json/.md (${aprov} gancho(s) aprovados pela validação)`);
  if (problemas.length) for (const p of problemas) console.log("  ⚠ " + descrever(r, p));
}

async function main() {
  if (a.modo === "manual") {
    fs.mkdirSync(pastaCriacoes, { recursive: true });
    const arq = path.join(pastaCriacoes, `${nome}.pedido.md`);
    fs.writeFileSync(arq, `# Instruções\n\n${SISTEMA}\n\n# Pedido\n\n${pedido}\n\n# Responda só com JSON neste formato\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(Resposta), null, 2)}\n\`\`\`\n`);
    console.log(`Pedido escrito em ${arq}. Depois: npm run criar -- --produto ${a.produto} --nome ${nome} --importar <resposta.json>`);
    return;
  }
  if (a.importar) {
    const r = Resposta.parse(lerJSON(path.resolve(a.importar)));
    const problemas = validar(r);
    salvar(r, a.modelo ?? "importado", problemas);
    return;
  }
  const { r, modelo, problemas } = await gerarPelaApi();
  salvar(r, modelo, problemas);
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) console.error("Sem credencial da Anthropic. Defina ANTHROPIC_API_KEY, rode `ant auth login`, ou use --modo manual.");
  else if (err instanceof Anthropic.RateLimitError) console.error("Limite de uso da API atingido. Tente de novo em alguns minutos.");
  else if (err instanceof Anthropic.APIError) console.error(`Erro da API (${err.status}): ${err.message}`);
  else console.error(err.message ?? err);
  process.exit(1);
});

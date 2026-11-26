/**
 * Importa os números dos anúncios no ar para o cérebro do produto.
 *
 *   npm run resultados -- --produto <pasta> --csv <exportação.csv>
 *
 * A planilha pode ser a exportação do Gerenciador de Anúncios da Meta (em português ou inglês, separada por
 * vírgula ou ponto e vírgula) ou uma feita à mão com as colunas: variacao;gasto;impressoes;plays3s;cliques;compras;receita.
 *
 * Como o motor sabe qual anúncio é qual variação: o nome do anúncio precisa conter o nome da variação
 * (a pasta que `npm run roteiros` criou, por exemplo "dor-situacao-solucao-cta_tempo_voce-chega-em-casa-cansado_9x16").
 * O formato no fim é opcional. Basta colar o nome da pasta no nome do anúncio ao subir.
 *
 * Exporte o período inteiro ("Máximo"): a cada importação, os números de uma variação substituem os anteriores.
 */
import fs from "node:fs";
import path from "node:path";
import { carregarFormulas } from "./montar";
import { lerCerebro, type Numeros, type Resultado, resumo, salvarCerebro, pastaCerebro } from "./cerebro";
import { sincronizar } from "./obsidian";
import { args, lerJSON, slug } from "./util";

const sem = (t: string) => t.replace(/^﻿/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Lê CSV com aspas, detectando o separador pela primeira linha. */
export function lerCSV(texto: string): { separador: string; linhas: string[][] } {
  const primeira = texto.split(/\r?\n/)[0] ?? "";
  const separador = [";", "\t", ","].sort((x, y) => primeira.split(y).length - primeira.split(x).length)[0];
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') (campo += '"'), i++;
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === separador) linha.push(campo), (campo = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo), (campo = "");
      if (linha.some((c) => c.trim())) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c.trim())) linhas.push(linha);
  return { separador, linhas };
}

/** "R$ 1.234,56", "1,234.56", "12,5" ou "12.5" viram número. Vazio ou "-" vira 0. */
export function numero(v: string | undefined, separador: string): number {
  let t = (v ?? "").replace(/[^\d.,-]/g, "");
  if (!t || t === "-") return 0;
  const virgula = t.lastIndexOf(",");
  const ponto = t.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) t = virgula > ponto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (virgula >= 0) t = /^-?\d{1,3}(,\d{3})+$/.test(t) && separador !== ";" ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
  else if (ponto >= 0 && separador === ";" && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

// Cada número, as colunas que podem trazê-lo (da mais exata para a mais solta). Custos e taxas ficam de fora.
const FORA = /custo por|cost per|taxa|rate|ctr|cpc|cpm|por resultado|per result/;
const COLUNAS: Record<keyof Numeros | "nome", RegExp[]> = {
  nome: [/^nome do anuncio$/, /^ad name$/, /^variacao$/, /^anuncio$/, /nome do anuncio|ad name/],
  gasto: [/^valor usado/, /^amount spent/, /^gasto/, /^investimento/],
  impressoes: [/^impressoes$/, /^impressions$/],
  plays3s: [/^plays3s$/, /3 segundos|3-second|3 second/],
  cliques: [/^cliques no link$/, /^link clicks$/, /^cliques$/, /^clicks$/],
  compras: [/^compras$/, /^purchases$/, /^compras no site$/, /^website purchases$/],
  receita: [/^receita$/, /valor de conversao (de|das) compras/, /purchases conversion value/, /purchase conversion value/],
};

export function mapearColunas(cabecalho: string[]) {
  const nomes = cabecalho.map(sem);
  const achar = (padroes: RegExp[]) => {
    for (const p of padroes) {
      const i = nomes.findIndex((n) => p.test(n) && !FORA.test(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  return Object.fromEntries(Object.entries(COLUNAS).map(([k, ps]) => [k, achar(ps)])) as Record<keyof typeof COLUNAS, number>;
}

/** Todas as variações que o motor pode ter gerado para o produto: criações × fórmulas × ganchos × formatos. */
function candidatas(pastaProduto: string, produto: any) {
  const formulas = carregarFormulas().filter((f) => (produto.formulas ?? [f.id]).includes(f.id));
  const formatos: string[] = produto.formatos ?? ["9x16", "4x5"];
  const fontes: { criacao: string; angulos: any[] }[] = [{ criacao: "ficha", angulos: produto.angulos ?? [] }];
  const pasta = path.join(pastaProduto, "criacoes");
  if (fs.existsSync(pasta))
    for (const f of fs.readdirSync(pasta).filter((f) => f.endsWith(".json"))) fontes.push({ criacao: f.replace(/\.json$/, ""), angulos: lerJSON(path.join(pasta, f)).angulos ?? [] });
  const out: { chave: string; meta: Omit<Resultado, keyof Numeros | "variacao" | "formato" | "anuncios" | "atualizado_em"> }[] = [];
  for (const { criacao, angulos } of fontes)
    for (const an of angulos)
      for (const g of an.ganchos ?? [])
        for (const f of formulas) {
          const texto = g.texto ?? g;
          // Mesmo nome que `npm run roteiros` dá à pasta da variação, sem o formato.
          const chave = `${slug(f.id)}_${slug(an.id)}_${slug(texto).slice(0, 24)}`;
          out.push({ chave, meta: { criacao, formula: f.id, angulo: an.id, base: an.base, consciencia: an.consciencia, dor: an.dor, gancho: texto, tipo_gancho: g.tipo, referencia: an.referencia } });
        }
  return { lista: out, formatos };
}

if (require.main === module) {
  const a = args();
  if (!a.produto || !a.csv) {
    console.error("Uso: npm run resultados -- --produto <pasta> --csv <exportação.csv>");
    process.exit(1);
  }
  const pasta = path.resolve(a.produto);
  const produto = lerJSON(path.join(pasta, "produto.json"));
  const { separador, linhas } = lerCSV(fs.readFileSync(path.resolve(a.csv), "utf8"));
  const [cab, ...dados] = linhas;
  const col = mapearColunas(cab ?? []);
  if (col.nome < 0) throw new Error(`Não achei a coluna com o nome do anúncio (esperava "Nome do anúncio", "Ad name" ou "variacao"). Colunas: ${cab?.join(" | ")}`);
  const faltam = (["gasto", "impressoes", "compras"] as const).filter((k) => col[k] < 0);
  if (faltam.length) console.warn(`⚠ Colunas não encontradas (ficam zeradas): ${faltam.join(", ")}. Inclua-as na exportação.`);
  if (col.plays3s < 0) console.warn("⚠ Sem a coluna de reproduções de 3 segundos: a taxa de gancho não será calculada.");

  const { lista, formatos } = candidatas(pasta, produto);
  // Chaves mais longas primeiro: o gancho mais específico ganha quando um nome contém outro.
  lista.sort((x, y) => y.chave.length - x.chave.length);
  const cerebro = lerCerebro(pasta, produto.id);
  const agora = new Date().toISOString();
  const novos: Record<string, Resultado> = {};
  const semPar: string[] = [];
  let casadas = 0;
  for (const l of dados) {
    const nome = (l[col.nome] ?? "").trim();
    if (!nome || /^(total|resultados? (gerais|totais))/i.test(sem(nome))) continue;
    // Só letras e números: o nome do anúncio pode ter prefixos, colchetes e separadores diferentes.
    const s = sem(nome).replace(/[^a-z0-9]/g, "");
    const c = lista.find((c) => s.includes(c.chave.replace(/[^a-z0-9]/g, "")));
    if (!c) {
      semPar.push(nome);
      continue;
    }
    casadas++;
    const formato = formatos.find((f) => sem(nome).includes(f)) ?? "?";
    const variacao = `${c.chave}_${formato}`;
    const n: Numeros = {
      gasto: numero(l[col.gasto], separador),
      impressoes: numero(l[col.impressoes], separador),
      plays3s: numero(l[col.plays3s], separador),
      cliques: numero(l[col.cliques], separador),
      compras: numero(l[col.compras], separador),
      receita: numero(l[col.receita], separador),
    };
    const ant = novos[variacao];
    novos[variacao] = ant
      ? { ...ant, ...Object.fromEntries((Object.keys(n) as (keyof Numeros)[]).map((k) => [k, ant[k] + n[k]])), anuncios: [...ant.anuncios, nome] }
      : { ...c.meta, ...n, variacao, formato, anuncios: [nome], atualizado_em: agora };
  }
  Object.assign(cerebro.resultados, novos);
  cerebro.importacoes.push({ data: agora.slice(0, 10), arquivo: path.basename(a.csv), linhas: dados.length, casadas, sem_par: semPar });
  salvarCerebro(pasta, cerebro);
  fs.writeFileSync(path.join(pastaCerebro(pasta), "cerebro.md"), resumo(pasta, produto));
  console.log(`${casadas} anúncio(s) casados com ${Object.keys(novos).length} variação(ões); ${semPar.length} sem par. Cérebro: ${path.join(pastaCerebro(pasta), "cerebro.md")}`);
  for (const s of semPar.slice(0, 10)) console.log(`  ? ${s}`);
  if (semPar.length) console.log("  Dica: o nome do anúncio precisa conter o nome da pasta da variação (veja variacoes.csv do lote).");
  sincronizar(pasta, produto, a.cofre);
}

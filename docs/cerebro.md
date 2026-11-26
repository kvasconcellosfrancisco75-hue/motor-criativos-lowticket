# Cérebro do produto

O motor cria, renderiza e confere. O cérebro fecha o ciclo: guarda **o que aconteceu no ar** com cada variação e
leva isso para a próxima criação. A cada rodada, os ganchos novos partem do que vendeu, evitam o que gastou sem
vender e seguem as lições que você anotou.

```
criar ─► roteiros ─► render ─► anúncios no ar ─► npm run resultados ─► cérebro ─┐
  ▲                                                                              │
  └──────────────── a próxima criação lê vencedores, perdedores e lições ◄───────┘
```

O cérebro fica em `<produto>/cerebro/`, junto da ficha. Como a ficha de um produto real fica numa pasta privada,
os números de venda também ficam lá, fora deste repositório público.

| Arquivo | O que guarda |
|---|---|
| `resultados.json` | Números de cada variação (gasto, impressões, reproduções de 3 s, cliques, compras, receita) e de que criação, ângulo, gancho e fórmula ela veio. |
| `licoes.md` | O que você aprendeu e quer que o motor siga. Uma lição por linha, começando com `- `. Pode editar à mão. |
| `cerebro.md` | O resumo: ganchos do melhor para o pior, padrões e lições. |

## 1. Dar nome aos anúncios

Ao subir um vídeo no Gerenciador de Anúncios, **coloque no nome do anúncio o nome da pasta da variação**
(está em `variacoes.csv` do lote), por exemplo:

```
dor-situacao-solucao-cta_tempo_voce-chega-em-casa-cansa_9x16
```

Pode ter outras coisas antes ou depois (`[CBO] ... - teste 2`). É assim que o motor sabe qual anúncio é qual gancho.

## 2. Importar os resultados

No Gerenciador de Anúncios, no nível de **anúncio**, escolha o período **Máximo** e exporte a tabela
(Exportar → CSV). Garanta que as colunas incluam: nome do anúncio, valor usado, impressões, reproduções de
3 segundos do vídeo, cliques no link, compras e valor de conversão das compras.

```bash
npm run resultados -- --produto ../meu-repo-privado/produtos/meu-produto --csv ~/Downloads/export.csv
```

Serve a exportação em português ou em inglês. Sem exportação, uma planilha feita à mão também vale:

```
variacao;gasto;impressoes;plays3s;cliques;compras;receita
dor-situacao-solucao-cta_tempo_voce-chega-em-casa-cansa_9x16;82,50;10400;3900;210;4;148,00
```

A cada importação os números de uma variação **substituem** os anteriores (por isso o período Máximo).
Anúncios sem variação correspondente aparecem no fim do `cerebro.md`.

## 3. Ler e anotar

```bash
npm run cerebro -- --produto <pasta>                                       # atualiza e mostra o resumo
npm run cerebro -- --produto <pasta> --licao "Chamar a nutri pelo nome segura mais que pergunta"
```

O resumo traz:

- **Ganchos**, cada um somando os formatos e fórmulas em que rodou, com veredito:
  - *vencedor*: gastou o mínimo e o CPA ficou na meta;
  - *promissor*: CPA na meta, mas ainda gastou pouco;
  - *em teste*: gastou pouco e ainda não vendeu na meta;
  - *perdedor*: gastou o mínimo e o CPA ficou acima da meta.
- **Padrões**: o resultado somado por tipo de gancho, base do ângulo, nível de consciência, fórmula e formato.
- **Taxa de gancho** (reproduções de 3 s ÷ impressões): o termômetro dos 3 primeiros segundos, mesmo antes de haver vendas.

## Metas

Na ficha, campo opcional `cerebro`:

```json
"cerebro": { "cpa_alvo": 35, "gasto_minimo": 70 }
```

| Campo | Padrão | Uso |
|---|---|---|
| `cpa_alvo` | o preço da oferta (`oferta.valor`) | Custo por compra que ainda dá lucro. No low ticket, empatar no front é o normal: o lucro vem dos order bumps e do upsell. Se o seu ticket médio é maior que o front, suba a meta. |
| `gasto_minimo` | 2 × `cpa_alvo` | Quanto um gancho precisa gastar antes de ser julgado. |

## No Obsidian

Com um cofre do Obsidian configurado, o cérebro também vira notas: uma por gancho e por ângulo, um resumo por
produto e um Painel. As lições passam a ser escritas na nota **Lições** do cofre, e a caixinha **aprovado** de cada
gancho decide o que entra nos lotes. Veja [obsidian.md](obsidian.md).

## O que a criação faz com o cérebro

`npm run criar` inclui no pedido, quando o cérebro tem algo:

- até 5 ganchos vencedores ou promissores, para explorar a **mecânica** com palavras novas;
- até 5 perdedores, para evitar a mesma mecânica e a mesma dor;
- a ordem dos tipos de gancho, das bases e dos níveis de consciência pelo CPA (só os que já gastaram o mínimo);
- todas as lições de `licoes.md` e da nota Lições do Obsidian;
- o pedido para que pelo menos um ângulo explore algo ainda não testado, para o cérebro continuar aprendendo.

As regras de sempre continuam valendo: nada de repetir ganchos já usados, fatos só da ficha, restrições respeitadas.

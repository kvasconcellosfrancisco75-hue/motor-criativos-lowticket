# Ficha do produto (`produto.json`)

A ficha é a raiz do motor: tudo o que aparece no vídeo e na legenda sai daqui. As fórmulas
(`formulas/*.json`) leem os campos pelo nome, com a sintaxe `{{produto.campo}}`, `{{angulo.campo}}`
e `{{gancho.campo}}`. Se uma fórmula usa um campo que a ficha não tem, o motor para com erro ao montar
o lote, para nunca gerar um criativo com buraco.

Há um exemplo completo, de um produto fictício, em [`produtos/exemplo/produto.json`](../produtos/exemplo/produto.json).

## Identificação e regras

| Campo | Para que serve |
|---|---|
| `id` | Nome curto, sem espaços. Vira o nome da pasta em `saida/`. |
| `nome`, `marca`, `pagina` | Nome do produto, marca e página de vendas. |
| `teto_segundos` | Duração máxima dos vídeos (padrão 30). |
| `formatos` | `["9x16", "4x5"]`: Reels/Stories e Feed. |
| `formulas` | Quais fórmulas usar para este produto. |
| `publico`, `promessa` | Referência para quem escreve os ângulos e revisa os roteiros. |
| `restricoes` | O que não pode aparecer (por exemplo, antes e depois ou promessa de resultado). |
| `ritmo_fala` | Palavras por segundo da narração, medido num criativo aprovado (padrão 2,8). Usado para estimar a duração e o limite de palavras. |
| `chamada_publico` | Como o anúncio chama o público logo no começo, por exemplo `["nutricionista", "nutri"]`. A criação recusa gancho que não traga um desses nomes nas primeiras palavras da fala e nas primeiras linhas da tela. |
| `nucleo_aprovado` | `true` quando o produto já tem um corpo de anúncio que funciona. Mecanismo, entregáveis, slogan e CTA ficam fixos (vêm da ficha) e a criação varia só o começo: ângulo, gancho, promessa e número. Assim se testa gancho contra o mesmo corpo. |

## Ângulos (`angulos[]`)

Cada ângulo é uma dor do público. Dentro dele:

| Campo | Formato |
|---|---|
| `id` | Nome curto, por exemplo `"tempo"`. |
| `ganchos[]` | `{ "texto": "fala do gancho", "linhas": ["texto", "na tela"], "marca": "palavra destacada" }` |
| `promessa` | A promessa que a pessoa faz e não cumpre: `{ "fala", "antes", "citacao" }` |
| `numero` | O número que dói: `{ "fala", "antes", "valor", "depois" }` |
| `legenda_gancho` | Primeira frase da legenda do anúncio para este ângulo. |

Cada gancho gera uma variação, então é aqui que se testa mais.

## Produto, oferta e chamada

| Campo | Uso |
|---|---|
| `mecanismo` | A virada para a solução: `{ "fala", "linhas" }`. |
| `entregaveis` | O que a pessoa recebe: quantidade e textos para o contador, a lista e a legenda. `prefixo` vai antes do número do contador: `"+"` para "mais de", `""` quando o número é exato. |
| `diferencial` | O que torna fácil (por exemplo, "sem aparecer"). |
| `como_usar` | Uma frase para a legenda. |
| `slogan` | Três batidas: `{ "fala", "palavras": ["Uma.", "Duas.", "E três."] }`. |
| `oferta` | Preço, moeda, preço "de", selos, frase falada e textos da legenda. |
| `titulo_anuncio` | Título do anúncio. |
| `cta` | Pergunta final em linhas, complemento opcional, palavra marcada, texto do botão e a fala. |
| `comparacao` | Para a fórmula `comparacao-prova-oferta`: `{ "fala", "titulo", "marca", "esquerda": { "img", "rotulo", "ok": false }, "direita": { "img", "rotulo", "ok": true } }`. As imagens ficam em `ativos/` (por exemplo, o print de um reel sem formato e o do reel original do formato). |

## Visual e ativos

| Campo | Uso |
|---|---|
| `visual.cores` | `claro`, `escuro`, `destaque` e `texto`, em hexadecimal. Cada cena usa um tom: claro, escuro ou destaque. |
| `visual.fontes` | Fonte dos títulos e da citação. Já vêm instaladas a Bricolage Grotesque e a Instrument Serif. |
| `personagem` | Poses ligadas a arquivos em `ativos/`: `neutra`, `confiante`, `frustrada` e `apontando`. Se faltar uma pose, a cena fica sem personagem. |
| `ativos.prova_video` | Vídeo de prova em `ativos/` (por exemplo, a gravação de tela do produto). Se estiver vazio, a cena vira um contador. |

## Cuidados

- Na **fala**, escreva os números por extenso ("cento e vinte"), porque a voz lê melhor. Na tela, use o número.
- Confira se todo número citado é verdadeiro e bate com a página de vendas.
- Mantenha as fichas de produtos reais num repositório privado.

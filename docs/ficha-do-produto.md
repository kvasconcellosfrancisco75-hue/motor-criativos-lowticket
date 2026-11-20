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

## Mercado, submercado e nicho (`mercado`)

Segundo Russell Brunson (*DotCom Secrets*), toda compra nasce do desejo de melhorar uma de três áreas, os
**mercados centrais**: saúde, dinheiro e relacionamento. Mas ninguém vende no nível do mercado
("emagreça", "ganhe dinheiro"): ali todo mundo compete. Desce-se para um **submercado** e dali para um
**nicho**, que é um público específico com um problema específico.

```json
"mercado": {
  "central": "saude",
  "submercado": "alimentação prática",
  "nicho": "quem trabalha fora, chega cansado e acaba no delivery",
  "termos_nicho": ["receita", "cozinh", "jantar", "delivery"]
}
```

| Campo | Para que serve |
|---|---|
| `central` | `saude`, `dinheiro` ou `relacionamento`. Define os cuidados de política de anúncios que a criação segue e confere. |
| `submercado`, `nicho` | Onde o produto compete. Entram nas instruções da criação para os ângulos saírem no nível do nicho. |
| `termos_nicho` | Palavras do submercado e do nicho, sem acento (valem como prefixo: `cozinh` pega "cozinhar" e "cozinha"). Todo gancho precisa tocar um deles (ou a `chamada_publico`), e as referências que falam deles ganham até 10 pontos. |

O que o motor faz com isso:

- **Criação** (`npm run criar`): recusa ganchos e legendas genéricos de mercado ("renda extra", "perder peso", "reconquistar") e ganchos que não tocam o nicho.
- **Política de anúncios**: em todos os mercados, recusa frases que afirmam atributo sensível de quem assiste ("você que está endividado"). Por mercado:

| Mercado | O que a validação recusa |
|---|---|
| Saúde | Antes e depois, promessa de perda de peso ou medida, promessa de cura. |
| Dinheiro | Promessa de ganho em valor ou prazo ("ganhe 5 mil por mês"), dinheiro fácil ou garantido. |
| Relacionamento | Promessa de que a pessoa volta, promessa sobre o que o outro vai fazer. |

- **Referências** (`npm run referencias`): anúncios do mesmo submercado sobem na nota e aparecem marcados em `referencias.md`.

Fichas sem `mercado` continuam funcionando; só ficam sem essas conferências.

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
| `entregaveis` | O que a pessoa recebe: quantidade e textos para o contador, a lista e a legenda. |
| `diferencial` | O que torna fácil (por exemplo, "sem aparecer"). |
| `como_usar` | Uma frase para a legenda. |
| `slogan` | Três batidas: `{ "fala", "palavras": ["Uma.", "Duas.", "E três."] }`. |
| `oferta` | Preço, moeda, preço "de", selos, frase falada e textos da legenda. |
| `titulo_anuncio` | Título do anúncio. |
| `cta` | Pergunta final em linhas, complemento opcional, palavra marcada, texto do botão e a fala. |

## Visual e ativos

| Campo | Uso |
|---|---|
| `visual.cores` | `claro`, `escuro`, `destaque` e `texto`, em hexadecimal. Cada cena usa um tom: claro, escuro ou destaque. |
| `visual.fontes` | Fonte dos títulos e da citação. Já vêm instaladas a Bricolage Grotesque e a Instrument Serif. |
| `visual.escala_personagem` | Opcional. Abaixo de 1 (por exemplo `0.42`), as imagens de `personagem` viram ícones: quadrados, menores e acima da borda. Serve para usar ícones (de um banco de imagens ou do Canva) no lugar de uma personagem. |
| `personagem` | Poses ligadas a arquivos em `ativos/`: `neutra`, `confiante`, `frustrada` e `apontando`. Se faltar uma pose, a cena fica sem personagem. |
| `ativos.prova_video` | Vídeo de prova em `ativos/` (por exemplo, a gravação de tela do produto). Se estiver vazio, a cena vira um contador. |

## Cuidados

- Na **fala**, escreva os números por extenso ("cento e vinte"), porque a voz lê melhor. Na tela, use o número.
- Confira se todo número citado é verdadeiro e bate com a página de vendas.
- Mantenha as fichas de produtos reais num repositório privado.

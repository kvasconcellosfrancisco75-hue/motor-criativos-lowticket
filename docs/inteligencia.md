# Inteligência competitiva: anúncios validados do nicho

Três comandos minam a Biblioteca de Anúncios da Meta, escolhem os anúncios que estão no ar há mais tempo
e pedem à IA uma leitura de cada um, com o fit com o seu produto, o ângulo de venda e como adaptar.
O resultado é um dashboard (`report.html`).

```
minerar (Apify) ─► brutos.json + anuncios.json ─► curadoria (IA) ─► curadoria.json ─► report.html
   100 anúncios          dados de referência        top 30 + análise       tudo junto      dashboard
```

```bash
npm run minerar   -- --produto <pasta>   # ~100 anúncios por impressões, pelos termos da ficha
npm run curadoria -- --produto <pasta>   # seleciona 30, analisa com a IA e gera o report.html
npm run minerar   -- --produto <pasta> --qualquer-ordem --termos "a,b"   # completa a coleta do dia com outros termos
npm run relatorio -- --curadoria <pasta>/inteligencia/<data>/curadoria.json   # só refaz o HTML
```

## Configuração na ficha (`produto.json`)

```json
"inteligencia": {
  "descricao": "pack digital de receitas rápidas com lista de compras, vendido por R$27",
  "contexto": "Público majoritariamente feminino, 25 a 45 anos, que trabalha fora.",
  "termos": ["receitas rápidas", "cardápio semanal", "marmitas fit", "receitas fáceis"],
  "pais": "BR",
  "total": 100,
  "selecionar": 30,
  "max_por_anunciante": 3,
  "midia": "all",
  "objetivo": "ambos",
  "so_oferta": true,
  "aceitar_whatsapp": true,
  "excluir": []
}
```

| Campo | Padrão | O que faz |
|---|---|---|
| `termos` | `busca.termos` | Buscas na biblioteca. Cada termo vira uma busca ordenada por impressões. |
| `frase_exata` | `true` | Busca a frase exata (menos ruído). `false` aceita as palavras em qualquer ordem. |
| `pais` | `BR` | Código do país, ou `ALL`. |
| `idioma` | | Filtra pelo idioma do anúncio (ex.: `pt`). |
| `total` | `100` | Anúncios guardados no total, divididos igualmente entre os termos. |
| `status` | `active` | `active` só traz ativos; `all` inclui os que saíram do ar. |
| `midia` | `all` | `all`, `video` ou `image`. |
| `selecionar` | `30` | Quantos anúncios vão para a análise. |
| `max_por_anunciante` | `3` | Variedade: no máximo N criativos de um mesmo anunciante. |
| `objetivo` | `ambos` | `modelar` (criativos para o seu produto), `ofertas` (ofertas que já vendem) ou `ambos`. |
| `so_oferta` | `true` | Descarta anúncios que levam a perfil, loja de apps ou TikTok. |
| `aceitar_whatsapp` | `true` | Muito infoproduto low ticket vende pelo WhatsApp, então ele conta como oferta. |
| `excluir` | `[]` | Anunciantes que não devem voltar (ruído reprovado na revisão). |
| `baixar_midia` | `true` | Baixa as mídias dos selecionados para `midia/` (os links da Meta expiram). |
| `descricao`, `contexto` | | Contexto extra do produto para a IA, além dos campos da ficha. |

### Como escolher os termos

- **Busque pela oferta, não pelo público.** "receitas rápidas" e "cardápio semanal" trazem quem vende algo
  parecido; "mulher que trabalha fora" traz qualquer coisa.
- Misture **o nome do produto** ("pack de receitas"), **a promessa** ("receitas em 15 minutos") e
  **a dor** ("o que fazer de janta").
- Use de 4 a 6 termos de 1 a 3 palavras. Rode, veja quem apareceu no `report.html` e ponha os anunciantes
  irrelevantes em `excluir`.

## Como a seleção funciona

1. Fica só o que está **ativo**, leva a uma **oferta** e não está em `excluir`.
2. **Agrupa** o mesmo criativo (mesmo `collation_id`, ou mesmo anunciante com o mesmo texto). Fica o mais
   antigo, e as versões somam: várias versões indicam que o anunciante está escalando aquele criativo.
3. Ordena por **dias no ar**, depois por versões e depois pela posição na busca.
4. Corta em `max_por_anunciante` por página e pega os `selecionar` primeiros.

A Biblioteca não mostra vendas nem custo. Tempo no ar é o melhor sinal público: ninguém mantém por meses
um anúncio que dá prejuízo.

## A análise da IA

Para cada anúncio (copy, título, CTA, destino e a imagem ou capa do vídeo), a IA devolve:

- **fit** de 0 a 100 com o produto da ficha, e o motivo
  (85+: mesmo público e mesma promessa; 65 a 84: adaptar; 40 a 64: nicho vizinho; abaixo de 40: só formato);
- **ângulo de venda** (dor, desejo, prova social, mecanismo novo, quebra de objeção…) com um nome específico;
- **estratégia**: a sequência de ideias e por que funciona;
- gancho, tipo de gancho, estrutura da copy, gatilhos, público, promessa e oferta;
- **como adaptar** e um **gancho novo** já escrito para o seu produto, respeitando as `restricoes`;
- **potencial da oferta**, de 0 a 100, e alertas de política de anúncios.

No fim, um resumo estratégico com panorama, padrões, oportunidades, 5 ganchos para testar e a próxima ação.

Modelo padrão: `claude-opus-5-5` (troque com `--modelo`). Ele roda em lotes de 6 anúncios em paralelo
(`--lote N`) e precisa de `ANTHROPIC_API_KEY` ou de `ant auth login`.

**Sem chave da API:** `--modo manual` escreve `pedido-curadoria.md`. Cole num chat com o Claude, salve
a resposta como `resposta.json` e rode `npm run curadoria -- --produto <pasta> --de-arquivo resposta.json`.

## Arquivos

```
<produto>/inteligencia/
  report.html                  ← sempre a última curadoria
  2026-11-16/
    brutos.json                o que o Actor devolveu, sem mexer
    anuncios.json              os mesmos anúncios num formato limpo
    curadoria.json             selecionados + análises + resumo
    report.html                o dashboard desta coleta
    midia/                     vídeos e imagens dos selecionados
    pedido-curadoria.md        (modo manual)
```

## Custos e limites

- **Apify**: o Actor `curious_coder/facebook-ads-library-scraper` cobra cerca de US$ 0,75 a cada 1.000
  anúncios entregues. Ele pode entregar até 30 a mais por termo do que o pedido (o motor guarda só `total`),
  então 100 anúncios em 4 termos custam em torno de US$ 0,10 a 0,20.
- **IA**: 30 anúncios com imagem são 5 lotes e um resumo, alguns centavos de dólar no Opus.
- **Mídias**: os links do CDN da Meta (`*.fbcdn.net`) expiram em alguns dias. Por isso a curadoria baixa
  os arquivos. O report usa `<meta name="referrer" content="no-referrer">` para o CDN não bloquear as mídias.
- O dashboard é um arquivo só: o CSS do Tailwind é compilado e embutido, e abre offline (as fontes vêm do
  Google Fonts quando há internet).
- Dados de anúncios de terceiros: guarde a pasta do produto num repositório **privado**. A pasta
  `inteligencia/` fica fora do git deste repositório.
- Modele estruturas e ângulos, nunca copie frases ou criativos. Siga os termos de uso da Meta e do Apify.

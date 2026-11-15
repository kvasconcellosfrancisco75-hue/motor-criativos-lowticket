# Referências da Biblioteca de Anúncios

O objetivo é começar pelo que já deu certo no mercado e testar menos variações até validar.
A Biblioteca de Anúncios da Meta ([facebook.com/ads/library](https://www.facebook.com/ads/library))
é pública e mostra os anúncios ativos de qualquer anunciante.

## Como saber se um anúncio "deu certo"

A biblioteca não mostra vendas nem custo. Os sinais indiretos são:

| Sinal | Onde aparece no anúncio | Por que importa |
|---|---|---|
| Tempo no ar | "Começou a ser veiculado em…" | Ninguém mantém por semanas um anúncio que dá prejuízo. |
| Versões | "N anúncios usam este criativo e texto" | O anunciante está escalando aquele criativo. |
| Ainda ativo | Selo "Ativo" | Continua funcionando hoje. |
| Mesmo público | Pelo anunciante e pela oferta | O que funciona no seu nicho pesa mais. |

O motor dá uma nota de 0 a 100 e classifica cada referência:

- **validado:** ativo e no ar há 60+ dias, ou 30+ dias com 3+ versões;
- **promissor:** 21+ dias no ar;
- **fraco:** o resto (pode ser só um teste do anunciante).

## Como coletar

1. Na biblioteca, escolha **Brasil**, **Todos os anúncios** e pesquise por palavras do nicho e da oferta
   (por exemplo, "roteiros", "reels", "pack", "nutricionista", "instagram para nutricionistas").
2. Filtre por **ativos** e por **vídeo**. Abra os anunciantes que vendem infoproduto parecido.
3. Prefira anúncios antigos que ainda estão ativos e os que têm várias versões.
4. Para cada anúncio escolhido, preencha uma linha em `<produto>/referencias.csv`.

Rode `npm run referencias -- --produto <pasta>` uma vez para criar a planilha só com o cabeçalho.

## Colunas de `referencias.csv` (separador `;`)

| Coluna | Exemplo | Obrigatória |
|---|---|---|
| `link` | link do anúncio na biblioteca | sim |
| `anunciante` | nome da página | |
| `inicio` | `01/08/2026` (data de início da veiculação) | sim |
| `fim` | só se já saiu do ar | |
| `ativo` | `sim` ou `não` | sim |
| `versoes` | `6` | |
| `formato` | `video`, `imagem`, `carrossel` | |
| `duracao_s` | `24` | |
| `publico` | `mesmo`, `vizinho` ou `outro` | |
| `gancho` | o que se fala ou se vê nos 3 primeiros segundos | sim |
| `transcricao` | a fala inteira do vídeo | |
| `cta` | a chamada final | |
| `observacao` | por exemplo, "depoimento falado", "tela dividida" | |

Depois:

```bash
npm run referencias -- --produto <pasta>   # nota e nível de cada referência → referencias.md
npm run criar -- --produto <pasta>         # com referências validadas: 2 ângulos × 2 ganchos
```

Na criação, cada ângulo parte de uma referência validada diferente. Ele aproveita a estrutura, o tipo de
gancho e o ritmo, e nunca as frases: a validação recusa textos parecidos demais com a referência.
Ganhando um criativo no teste, as próximas rodadas variam a partir dele.

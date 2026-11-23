# Do motor à plataforma: esboço

Hoje o motor é uma linha de comando que leva **uma referência validada a um vídeo pronto**. As plataformas de
"ofertas escaladas" do mercado vendem outra coisa: um **catálogo de ofertas** e um punhado de **geradores genéricos**
(headline, copy, página, áudio), cada um isolado, mais um conector MCP. Nenhum deles entrega o criativo final.

A proposta é juntar as duas coisas na ordem certa:

```
radar de ofertas ─► análise da oferta ─► ficha do produto ─► criação ─► vídeos, página, legenda
 (mineração)         (página + funil)     (rascunho por IA)   (já existe)  (já existe / novo)
```

A vantagem que já temos é o que vem depois do catálogo: criação presa aos fatos da ficha, recusa de repetição,
roteiro sincronizado com a voz e vídeos renderizados em lote. O catálogo vira a porta de entrada, não o produto.

## O que já existe e o que falta

| Função | Situação | Onde |
|---|---|---|
| Mineração na Biblioteca de Anúncios | **existe** (por produto) | `motor/coletar.ts` (Apify) |
| Nota de "escalando" (dias no ar, versões, coletas seguidas) | **existe** | `motor/referencias.ts` |
| Transcrição do gancho falado | **existe** | `motor/transcrever.py` (Whisper) |
| Ângulos, ganchos e copy a partir de modelos validados | **existe** | `motor/criar.ts` (Claude) |
| Vídeos em lote, legendas, conferência | **existe** | `motor/roteiros.ts`, `render.ts`, `conferir.ts` |
| Radar por nicho, sem produto (catálogo de ofertas) | falta | fase 1 |
| Agrupar anúncios em **ofertas** (pela página de destino) | falta | fase 1 |
| Análise da página e do funil a partir de uma URL | falta | fase 1 |
| Rascunho de `produto.json` a partir da oferta analisada | falta | fase 1 |
| Voz gerada (fim da gravação manual) | falta | fase 2 |
| Página de vendas gerada pela ficha e publicada | falta | fase 2 |
| Headlines e textos de anúncio em lote | parcial (sai na criação) | fase 2 |
| Checagem de termos sensíveis antes de subir | falta | fase 2 |
| Login, planos, pagamento, painel web | falta | fase 3 |
| Servidor MCP (usar tudo de dentro do Claude/ChatGPT) | falta | fase 3 |

## Fase 1 — Radar e análise (continua CLI, sem servidor)

**1. `npm run radar -- --nicho <arquivo>`**
Uma lista de termos por nicho (`radar/<nicho>.json`), sem precisar de ficha. Reaproveita a coleta do
`coletar.ts`, mas agrupa os anúncios **por domínio da página de destino**: vários anunciantes e criativos
apontando para o mesmo checkout são uma oferta só. Para cada oferta:

- anúncios ativos, anunciantes distintos, dias no ar do anúncio mais antigo;
- variação semana a semana (a coleta roda toda semana: quem cresce é o "escalando" de verdade);
- plataforma de checkout detectada na URL (Hotmart, Kiwify, Eduzz, Cakto, Monetizze…);
- ganchos transcritos dos três criativos mais fortes.

Saída: `radar/<nicho>/<data>/ofertas.json` e `ofertas.md`, ordenados pela nota.

**2. `npm run analisar -- --url <página>`**
Abre a página com Playwright (o Chromium já está na máquina), salva print e HTML e extrai: headline,
promessa, mecanismo, entregáveis, bônus, preço e parcelas, garantia, prova, tipo de funil
(VSL, quiz, página longa), link de checkout e order bumps. Com o texto da página e os ganchos do radar,
o Claude escreve um **briefing**: o que faz a oferta vender, para quem e com que ângulo.

**3. `npm run ficha -- --de-analise <pasta>`**
Transforma o briefing num **rascunho** de `produto.json` para o **seu** produto, com os campos que a IA
não pode inventar (preço, entregáveis reais, prova, garantia) marcados como `"PREENCHER"`. O `criar.ts`
já recusa números fora da ficha, então nada inventado chega ao vídeo.

Custo da fase 1: só Apify (por resultado) e tokens do Claude. Dá para rodar semanal com um agendamento.

## Fase 2 — Ativos que faltam para a oferta inteira

- **Voz**: `npm run voz` gera `narracao.wav` por variação com um serviço de texto para fala (ElevenLabs ou
  outro), e o `sincronizar.py` segue igual. É o maior gargalo de hoje.
- **Página de vendas**: `npm run pagina` monta um HTML a partir da ficha (mesmas cores, fontes e promessa dos
  vídeos) com blocos fixos: dobra, dor, mecanismo, entregáveis, prova, oferta, garantia, FAQ. Publicação no
  Cloudflare Pages (conta já conectada), com UTM e pixel configuráveis.
- **Textos de anúncio**: títulos e textos principais em lote para cada variação, na mesma checagem da criação.
- **Checagem antes de subir**: lista de termos e alegações que as políticas da Meta costumam reprovar
  (promessa de resultado, saúde, renda, "antes e depois"), avisando quem revisa **para reescrever**,
  junto das `restricoes` que a ficha já tem.

## Fase 3 — Plataforma

```
 navegador ─► app web (React) ─► Supabase: login, banco, arquivos, funções
                                     │
                                     ├─ função "radar"      → Apify
                                     ├─ função "analisar"   → Playwright (worker) + Claude
                                     ├─ função "criar"      → Claude (o mesmo prompt do criar.ts)
                                     ├─ função "voz"        → texto para fala
                                     ├─ fila de render ────► worker com Remotion (VPS ou Remotion Lambda)
                                     ├─ webhook de pagamento (Hotmart/Kiwify/Cakto) → libera o plano
                                     └─ servidor MCP        → Claude, ChatGPT, Cursor
```

- O render **não** cabe numa função de borda: precisa de um worker com Chrome e ffmpeg puxando uma fila.
- O motor atual vira biblioteca: os scripts de `motor/` passam a exportar funções que a CLI e o worker chamam.
- Tabelas mínimas: `nichos`, `ofertas`, `anuncios`, `coletas` (histórico semanal), `analises`, `produtos`
  (a ficha em JSON), `criacoes`, `lotes`, `variacoes`, `assinaturas`, `uso` (créditos).
- **MCP** com poucas ferramentas e bem feitas: `buscar_ofertas`, `analisar_oferta`, `criar_ficha`,
  `gerar_criacao`, `gerar_lote`, `status_do_lote`. É o que faz a plataforma funcionar dentro do chat do cliente.
- Cobrança por plano com créditos: minerar e analisar consomem pouco; voz e render consomem mais.

## O que fica de fora de propósito

Algumas ferramentas comuns nesse mercado existem para enganar a revisão das plataformas ou o comprador.
Elas derrubam contas de anúncio e trazem risco com o Código de Defesa do Consumidor e o CONAR, então não entram:

- remover metadados ou marca d'água e "criptografar" texto para o anúncio passar por inédito;
- depoimentos, prints de WhatsApp, DMs ou resultados fabricados ("dark posts");
- copiar a página ou o criativo do concorrente. O radar serve para **entender a estrutura**; o `criar.ts`
  já proíbe copiar frases ou citar o anunciante.

## Próximos passos sugeridos

1. `radar`: agrupar a coleta por oferta e guardar o histórico semanal (reaproveita `coletar.ts`).
2. `analisar`: Playwright mais Claude, com briefing em Markdown.
3. `ficha --de-analise`: rascunho de `produto.json` com os campos `"PREENCHER"`.
4. `voz`: fechar o ciclo sem gravação manual.

Com os quatro, o fluxo inteiro roda pela linha de comando: **nicho → ofertas → briefing → ficha → vídeos com voz**.
A plataforma web só começa quando esse fluxo estiver dando resultado nos seus próprios produtos.

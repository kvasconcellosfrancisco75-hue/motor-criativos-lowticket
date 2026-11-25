# Radar diário e app no telefone

O radar roda sozinho todo dia no GitHub Actions, sem Apify e sem custo. O progresso e o resultado vão para um app
no Cloudflare, que você instala na tela inicial do telefone e que avisa quando a coleta termina.

```
GitHub Actions (06:17, todo dia)                 Cloudflare Worker (app/)                 Telefone
 npm run radar ── progresso de cada etapa ──►  /api/coleta/evento ─► KV "agora"  ◄── app atualiza a cada 5 s
   1. busca na Biblioteca (navegador próprio)   /api/coleta/fim ───► KV coleta:<dia>,   ◄── Hoje / Histórico
   2. preço na página e no checkout                                   histórico, séries
   3. total de anúncios das páginas            Web Push ─────────────────────────────────►  notificação
   4. critérios + tendência  ◄── /api/historico (coleta anterior)
```

## Onde fica cada coisa

| Parte | Arquivo |
|---|---|
| Coletor próprio da Biblioteca de Anúncios | `motor/biblioteca.ts` |
| Radar (etapas, critérios, envio ao app) | `motor/radar.ts`, `radar/config.json` |
| Agendamento diário | `.github/workflows/radar.yml` |
| App (servidor, notificações e telas) | `app/src/index.js`, `app/src/push.js`, `app/public/` |

## Colocar para rodar (uma vez)

1. **Segredos no GitHub**: no repositório, *Settings → Secrets and variables → Actions → New repository secret*:
   - `RADAR_API` = `https://radar-ofertas.virallab.workers.dev`
   - `RADAR_TOKEN` = o token do robô (o mesmo gravado no Worker)
2. **Levar o workflow para a branch principal.** O GitHub só agenda workflows que estão na branch padrão.
3. **Primeira execução**: *Actions → Radar diário → Run workflow*. Depois disso, ele roda sozinho todo dia.
4. **No telefone**: abra o endereço do app, entre com o código de acesso e instale:
   - Android (Chrome): menu ⋮ → *Instalar app*.
   - iPhone (Safari): *Compartilhar* → *Adicionar à Tela de Início*. Abra pelo ícone novo.
5. **Notificações**: no app, aba *Avisos* → *Ativar notificações* → *Enviar teste*.

## O que o app mostra

- **Hoje**: a coleta em andamento (etapa, progresso, o que está acontecendo) ou a última concluída; as ofertas
  **escaladas**, **quase lá** (falta um critério) e as outras.
  Tocar numa oferta mostra o preço do front e os order bumps (lidos no checkout), anunciantes, criativos mais
  duplicados e o gráfico de anúncios ativos por dia.
- **Histórico**: as escaladas por dia e cada coleta passada.
- **Avisos**: notificações, instalação e sessão.

Notificação: quando uma oferta vira escalada pela primeira vez, o aviso diz qual é; nos outros dias, chega o resumo
da coleta. Se a execução falhar, também chega um aviso, com o link do log.

## Limites do coletor próprio

- A partir de servidores (GitHub, nuvem), o Facebook devolve parte das visitas vazia. O coletor tenta de novo
  (`tentativas`, padrão 8). Uma busca que falha em todas fica de fora do dia e aparece no resumo.
- Cada busca rende os ~30 anúncios de mais impressões, então a amplitude vem do **número de frases** em
  `radar/config.json`. A página de cada anunciante traz o **total** de anúncios ativos; o radar estima quantos levam à
  oferta pela amostra (o "≈" no app).
- Se um dia o Facebook mudar a página e a coleta parar de achar anúncios, o app mostra a falha. Dá para rodar
  pelo Apify com `--fonte apify` enquanto o coletor é ajustado.

## Preço e order bumps

O preço registrado é sempre o do **checkout**, nunca o do criativo ou da legenda:

1. Na página de vendas, o radar acha o link do checkout. Sem link direto, clica no botão de compra e segue até ele.
2. No checkout, troca o país para **Brasil** quando a página vem em outra moeda (Hotmart, Eduzz e Greenn usam o país
   do IP, e os servidores do GitHub ficam nos EUA) e espera verificações anti-robô.
3. O front é o valor "à vista", o "total" ou o "1x de" do produto principal; os blocos de order bump ficam de fora.
4. Os **order bumps** são registrados com nome e preço. Se nenhum aparecer, o radar preenche **"Kaike"** no nome
   completo e lê de novo, porque alguns só aparecem depois disso. Ele nunca preenche e-mail, telefone, documento ou
   cartão e nunca envia o formulário.

**Produto físico sai do radar**: loja virtual (Shopify, Nuvemshop, Loja Integrada, VTEX, Tray) ou checkout/página
com frete e entrega física ("calcular frete", "prazo de entrega", Sedex, Correios...). Lojas WooCommerce que vendem
arquivo digital continuam. No app, essas ofertas ficam em "Outras" com o motivo.

Sem checkout encontrado, a oferta fica sem preço ("checkout não encontrado"). Para usar o preço da página de vendas
nesses casos, ligue `preco_da_pagina_sem_checkout` em `radar/config.json`.

## Ajustes

- Frases, critérios e limites: `radar/config.json` (vale na próxima execução).
- Horário: `cron` em `.github/workflows/radar.yml` (em UTC; 09:17 UTC = 06:17 em Brasília).
- O GitHub pausa agendamentos de repositórios sem atividade por 60 dias; um commit qualquer reativa.
- Publicar mudanças no app: `cd app && npm run publicar` (precisa de `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`).
- Trocar o código de acesso: `cd app && npx wrangler secret put APP_SENHA` (desconecta os aparelhos).

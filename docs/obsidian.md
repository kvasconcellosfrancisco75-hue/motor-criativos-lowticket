# O cérebro no Obsidian

O [Obsidian](https://obsidian.md) é um app gratuito de notas (computador e celular) que trabalha com uma pasta de
arquivos Markdown, o **cofre**. O motor escreve o cérebro de cada produto e o radar dentro desse cofre, e lê de volta
o que você muda nele. Você revisa ganchos, aprova, reprova e anota lições pelo Obsidian, inclusive no celular,
sem abrir JSON nem planilha.

```
                 escreve: ganchos, ângulos, resultados, padrões, radar
   motor  ──────────────────────────────────────────────────────────►  cofre do Obsidian
          ◄──────────────────────────────────────────────────────────
                 lê: caixinha "aprovado" e a nota Lições
```

## Configurar (uma vez)

1. Instale o Obsidian e crie um cofre, ou use um que você já tem. O motor só mexe na pasta `Motor/` dentro dele.
   **Guarde o cofre numa pasta privada**: ele tem os números de venda dos seus anúncios.
2. Diga ao motor onde está o cofre, de um destes jeitos:
   - na ficha do produto: `"obsidian": { "cofre": "../../cofre" }` (caminho relativo à pasta do produto);
   - na variável de ambiente `OBSIDIAN_COFRE=/caminho/do/cofre` (vale para todos os produtos e para o radar);
   - em cada comando: `--cofre /caminho/do/cofre`.
3. Primeira exportação:

   ```bash
   npm run obsidian -- --produto ../meu-repo-privado/produtos/meu-produto
   ```

4. Recomendado: instale o plugin da comunidade **Dataview** (Configurações → Plugins da comunidade). As notas
   funcionam sem ele, mas com ele o Painel ganha tabelas que se atualizam sozinhas.

Com o cofre configurado, **não precisa rodar `npm run obsidian` à mão**: `criar`, `roteiros`, `resultados` e
`cerebro` sincronizam sozinhos, e o `radar` grava a coleta do dia no cofre.

## O que aparece no cofre

```
Motor/
├── Painel.md                      ← comece por aqui: produtos, ganchos que estão vendendo, último radar
├── Produtos/
│   └── <produto>/
│       ├── <produto>.md           ← resumo: ranking de ganchos, padrões, lições em uso, o que falta testar
│       ├── Lições.md              ← SUA nota: cada linha "- ..." vira instrução para a próxima criação
│       ├── Ângulos/<id>.md        ← dor, promessa, número, copy e os ganchos do ângulo
│       └── Ganchos/<texto>.md     ← um por gancho: texto da tela, resultado, veredito, caixinha "aprovado"
└── Radar/
    ├── <dia>.md                   ← ofertas escaladas e quase lá da coleta
    └── Ofertas/<oferta>.md        ← cada oferta, com o histórico de todas as coletas em que apareceu
```

Cada gancho tem propriedades (`veredito`, `cpa`, `taxa_gancho`, `gasto`, `tipo_gancho`, `base`, `consciencia`,
`aprovado`), que dá para filtrar e ordenar no Obsidian ou no Dataview. Os vereditos aparecem com cor:
🟢 vencedor, 🟡 promissor, ⚪ em teste, 🔴 perdedor, ⚫ ainda não foi ao ar.

## O que você faz no Obsidian

| Você faz | O motor faz |
|---|---|
| Desmarca **aprovado** nas propriedades de um gancho ou de um ângulo | `npm run roteiros` não gera aquela variação |
| Escreve uma linha `- ...` em **Lições** | `npm run criar` segue a lição na próxima rodada |
| Marca a caixinha (`- [x] ...`) ou risca (`~~...~~`) uma lição | a lição deixa de valer, sem você precisar apagar |
| Escreve suas notas em qualquer nota, **fora** do trecho `%% motor:inicio %% … %% motor:fim %%` | nada: o motor nunca toca no que está fora desse trecho |
| Adiciona tags ou outras propriedades | ficam como estão |
| Renomeia ou move uma nota dentro da pasta do produto | continua achando a nota (pela propriedade `motor_id`) |

Os ângulos que estão na própria ficha (`angulos` do `produto.json`) aparecem no cofre, mas são aprovados ou
reprovados na ficha. Só os ângulos das criações (`npm run criar`) têm a caixinha.

## No celular

O Obsidian do celular abre o mesmo cofre se a pasta estiver sincronizada. Recomendo o **Obsidian Sync**
(pago, oficial, funciona sem configurar nada). A alternativa grátis é deixar o cofre num repositório **privado**
do GitHub e usar o plugin **Obsidian Git** no computador e no celular.

## Radar

```bash
OBSIDIAN_COFRE=/caminho/do/cofre npm run radar                   # coleta e grava no cofre
npm run obsidian -- --radar radar/dados/2026-11-26/ofertas.json   # leva uma coleta já feita para o cofre
```

A coleta diária do GitHub Actions continua indo para o app do telefone (veja [app.md](app.md)): ela roda num
servidor do GitHub, que não enxerga o seu cofre. Para ter o radar no Obsidian, rode o radar no seu computador
com o cofre configurado, ou importe uma coleta com `--radar`.

## Fluxo de uma semana

1. `npm run criar`: os ganchos novos aparecem no cofre como ⚫ "ainda não foi ao ar".
2. No Obsidian, você lê cada gancho e desmarca o que não gostou.
3. `npm run roteiros` e `npm run render`: só entram os aprovados.
4. Sobe os anúncios com o nome da variação, deixa rodar, exporta e roda `npm run resultados`.
5. No Obsidian, o Painel mostra o que vendeu. Você anota em **Lições** o que percebeu.
6. Volta ao passo 1: a criação parte dos vencedores e das suas lições.

# Motor de criativos low ticket

Gera criativos em vídeo para anúncios (Reels, Stories e Feed) a partir de **uma ficha do produto**.
Você descreve o produto uma vez; o motor monta os roteiros, as cenas e as legendas e renderiza as
variações em lote. Para um produto novo, troca-se só a ficha e os ativos. O motor continua o mesmo.

```
fatos do produto ─► criação (ângulos, ganchos, copy) ─► fórmulas ─► cenas ─► voz ─► sincronia ─► vídeos + legendas
 (produto.json)      (npm run criar → criacoes/)          (formulas/) (src/)          (palavras)    (saida/)
```

## Como funciona

| Camada | Onde | O que faz |
|---|---|---|
| 1. Ficha do produto | `produtos/<id>/produto.json` | Público, dores, promessa, mecanismo, entregáveis, oferta, restrições, cores, personagem e ativos. É a raiz de tudo. |
| 2. Criação | `npm run criar` → `<produto>/criacoes/` | Gera ângulos, ganchos e copy novos a partir dos fatos. Lê tudo o que já foi criado e recusa repetições, números fora da ficha, falas longas demais e destaques que não aparecem na tela. Você aprova ou reprova cada item no `.json`. |
| 3. Fórmulas | `formulas/*.json` | Moldes de roteiro com espaços `{{...}}` que a ficha preenche. |
| 4. Cenas | `src/cenas` | Cenas animadas genéricas (título, citação, contador, lista, prova em vídeo, slogan, preço, CTA). Não sabem qual é o produto: cores e fontes vêm da ficha. |
| 5. Produção | `motor/` | Gera o lote, prepara a voz, sincroniza as cenas com a fala, renderiza e confere. |
| 6. Saída | `saida/<produto>/<lote>/` | Um vídeo por variação e formato, `roteiro.md`, `legenda.txt`, `quadros.png` e a planilha `variacoes.csv`. |
| 7. Cérebro | `<produto>/cerebro/` | Os resultados dos anúncios no ar e as suas lições. A próxima criação parte do que vendeu e evita o que não vendeu. Veja [docs/cerebro.md](docs/cerebro.md). |
| 8. Obsidian | seu cofre, pasta `Motor/` | O cérebro e o radar como notas ligadas. Você aprova ganchos e escreve lições no Obsidian (até no celular) e o motor lê de volta. Veja [docs/obsidian.md](docs/obsidian.md). |

### Fórmulas incluídas

- **`dor-situacao-solucao-cta`**: uma história só. Gancho de dor, a promessa que não se cumpre ("toda semana você jura…"), um número que dói, a solução, a prova, um slogan em três batidas e o CTA. Sem preço no vídeo: a legenda e a página cuidam da oferta.
- **`numero-lista-oferta`**: gancho de dor, o número do produto logo no começo, a lista do que a pessoa recebe, o diferencial, a oferta com preço e garantia, e o CTA.

## Começando

Requisitos: Node.js 18+, ffmpeg e Chrome/Chromium. Para sincronizar com a fala: Python 3 e `pip install faster-whisper numpy`.

```bash
npm install

# 0. (recomendado) Classificar referências da Biblioteca de Anúncios: veja docs/referencias.md
npm run referencias -- --produto produtos/exemplo

# Radar diário de ofertas low ticket escaladas, com app no telefone: veja docs/app.md
npm run radar

# 1. Criar ângulos, ganchos e copy novos (API da Anthropic; ou --modo manual para colar num chat)
npm run criar -- --produto produtos/exemplo --angulos 3 --ganchos 3
#    revise criacoes/<nome>.md e reprove o que quiser no .json

# 2. Gerar o lote de variações a partir da criação aprovada
npm run roteiros -- --produto produtos/exemplo --lote lote-01

# 3. (opcional) Colocar a narração de cada variação e sincronizar
bash motor/preparar-audio.sh gravacao.m4a saida/exemplo-receitas/lote-01/<variação>/narracao.wav
python motor/sincronizar.py saida/exemplo-receitas/lote-01/<variação>

# 4. Renderizar (todas as variações, ou uma com --so <nome>)
npm run render -- --lote saida/exemplo-receitas/lote-01

# 5. Conferir duração e volume e gerar a folha de quadros
npm run conferir -- --lote saida/exemplo-receitas/lote-01

# 6. Depois que os anúncios rodarem: importar os resultados para o cérebro (veja docs/cerebro.md)
npm run resultados -- --produto produtos/exemplo --csv export-do-gerenciador.csv
npm run cerebro -- --produto produtos/exemplo --licao "o que você aprendeu"

# (recomendado) Tudo isso dentro do Obsidian: veja docs/obsidian.md
OBSIDIAN_COFRE=~/MeuCofre npm run obsidian -- --produto produtos/exemplo
```

Sem narração, o motor estima o tempo de cada cena pelo texto (cerca de 2,8 palavras por segundo). Serve
para revisar o visual antes de gravar. Com `narracao.wav` e `palavras.json`, cada cena é cortada na
primeira palavra da sua fala.

A narração pode ser uma gravação sua ou uma voz gerada por qualquer ferramenta de texto para fala.
Escreva os números da fala por extenso ("cento e vinte"): a voz lê melhor.

Se o Chrome não estiver no caminho padrão, informe-o com `CHROME_PATH=/caminho/do/chrome`.
Para ver e ajustar as cenas no navegador: `npm run studio`.

## Produtos reais ficam fora deste repositório

Este repositório é público. **Não coloque aqui** fichas, vozes, gravações ou imagens de produtos reais.
Guarde-os num repositório ou pasta privada e aponte o motor para lá:

```bash
npm run roteiros -- --produto ../meu-repo-privado/produtos/meu-produto --saida ../meu-repo-privado/saida
npm run render -- --lote ../meu-repo-privado/saida/<lote>
```

Com `--saida`, os vídeos, roteiros e legendas do produto também ficam na pasta privada.

O render lê os ativos (`ativos/`) da pasta do produto, onde quer que ela esteja. A pasta
`produtos-privados/` também é ignorada pelo git, se você preferir mantê-los nesta cópia local.

## Criar um produto novo

1. Copie `produtos/exemplo` para a sua pasta privada.
2. Preencha `produto.json`. O guia campo a campo está em [docs/ficha-do-produto.md](docs/ficha-do-produto.md).
3. Coloque em `ativos/` as imagens da personagem (PNG transparente) e, se tiver, o vídeo de prova (por exemplo, a gravação de tela do produto).
4. Gere o lote, revise `roteiro.md` e `quadros.png`, grave ou gere a voz, sincronize e renderize.

## O que o motor já cuida

- **Gancho em primeiro lugar:** é o que mais muda o resultado de um anúncio, então cada ângulo tem vários ganchos e cada gancho vira uma variação.
- **Teto de duração** por produto (`teto_segundos`, padrão 30 s), checado na conferência.
- **Margens seguras:** nada importante no rodapé, que o Reels e o Stories cobrem com a interface.
- **Restrições na ficha** (por exemplo, sem antes e depois, sem promessa de resultado), para quem revisa os roteiros.

- **Aprender com o resultado:** o cérebro do produto aponta os ganchos vencedores e perdedores pelo CPA e pela taxa de
  gancho, e a criação seguinte parte deles.

O que continua sendo humano: ouvir a voz, checar as regras da plataforma de anúncios e os números
citados, e decidir quanto escalar cada vencedor.

## Licença

MIT. Veja [LICENSE](LICENSE).

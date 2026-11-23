# Regras para criar vídeos e motion graphics com o Claude

Registro de 23/11/2026. Junta o que li em tutoriais e na documentação oficial com o que aprendemos fazendo os criativos deste projeto. Cada regra diz de onde veio: **[fonte]** foi lida; **[projeto]** foi aprendida na prática aqui.

Não consegui assistir a vídeos do YouTube (acesso bloqueado). Tudo abaixo vem de texto.

## 1. Como a coisa funciona

- O Claude **escreve o código ou o HTML** da animação, e um programa renderiza o MP4. Não existe "Claude gera vídeo" nativo. No chat do Claude ele escreve o código mas não roda; no Claude Code ele cria o projeto, instala e renderiza. **[fonte]**
- **Remotion** (React): controle por quadro, bom para sincronizar com voz e legenda. É o que usamos.
- **HyperFrames** (HTML + GSAP, da HeyGen): vem com comandos de planejar, validar, ver quadros e renderizar, e com cerca de 450 blocos prontos (transições, títulos, legendas, gráficos, 3D). **[fonte]**
- Remotion e HyperFrames servem para peças **desenhadas** (títulos, UI, gráficos). Para **cortar e legendar vídeo já gravado**, use ffmpeg ou uma skill de edição. Combine os dois quando precisar. **[fonte]**
- O servidor MCP do Remotion está descontinuado; a documentação atual vem pela skill `/remotion-docs`. **[fonte]**

## 2. Instalar as skills oficiais (ainda não instaladas aqui)

- Remotion: `claude plugin marketplace add remotion-dev/claude-code-plugin` e `claude plugin install remotion@remotion`, ou, dentro do projeto, `npx remotion skills add`. Use uma rota só. Depois, **abra uma sessão nova** do Claude. **[fonte]**
- HyperFrames: `npx skills add heygen-com/hyperframes` (grupo "Core Skills") ou `npx hyperframes skills update`. Comece pelo `/hyperframes`. **[fonte]**
- Skills úteis: `/remotion-create`, `/remotion-markup`, `/remotion-render`, `/remotion-captions`, `/remotion-docs`; no HyperFrames, `/hyperframes-registry` (usar **antes** de construir à mão algo que já exista) e `/reverse-any-video` (refaz um vídeo de referência como projeto editável, conferindo quadro a quadro). **[fonte]**
- Licença do Remotion: grátis para pessoas, ONGs e empresas com até 3 funcionários; empresas maiores precisam de licença. **[fonte]**

## 3. Como pedir (o briefing)

Todo pedido de vídeo deve trazer, nesta ordem: **[fonte]**
1. Formato, resolução, taxa de quadros e duração.
2. Cenas na ordem, **com tempo** de cada uma.
3. Textos que devem aparecer **palavra por palavra**.
4. Arquivos que podem ser usados (caminhos).
5. Cores, fontes e estilo de movimento.
6. O que o Claude **não** deve inventar nem baixar.

E ainda: **[fonte] + [projeto]**
- Se há referência (imagem ou vídeo), diga o que copiar: só o movimento, o layout ou o estilo todo.
- Peça **uma mudança concreta por vez** (encurtar uma cena, aumentar o contraste, mover um elemento tantos px).
- Em projeto existente, diga "preserve as composições atuais e reutilize fontes e cores". Confira o diff antes de aceitar.
- Se a instrução for ambígua, o Claude **diz como entendeu** antes de fazer, e confirma só se a dúvida mudar muito o resultado.

## 4. O ciclo de trabalho (obrigatório)

1. **Medir antes de desenhar:** largura dos textos no navegador, sempre que trocar fonte ou tamanho. **[projeto]**
2. **Ver quadros parados** nos momentos que importam antes de renderizar (`remotion still ... --frame=N`). Foi assim que achamos legenda em 3 linhas, cartão cobrindo dia do calendário e texto duplicado. **[fonte] + [projeto]**
3. **Renderizar só o bloco** em ajuste (`--frames=INI-FIM`), uns 4 s, antes do vídeo inteiro. **[projeto]**
4. **Assistir ao clipe inteiro em velocidade normal.** Cena parada por 3 s é erro fácil de perder no código. **[fonte]**
5. Só então renderizar o vídeo inteiro, enviar com **folha de quadros** e dizer o que foi e o que não foi conferido (o Claude vê quadros, não assiste ao movimento).
6. Guardar cópia do arquivo antes de mudar (`*_backup.tsx.txt`) e **apagar a versão substituída**, deixando só a atual.

## 5. Qualidade do movimento

- Dar a cada tipo de elemento **seu próprio easing**, para as cenas não se moverem todas do mesmo jeito. **[fonte]**
- Usar camadas (fundo, meio, frente) em velocidades diferentes para dar profundidade. **[fonte]**
- Trocar desenhos provisórios por **capturas e vídeos reais** (`<Img>`, `<OffthreadVideo>`). **[fonte]**
- Carregar a fonte da marca e **confirmar num quadro** que não caiu em fonte reserva. **[fonte]**
- Texto vertical: travar linha única com `whiteSpace: "nowrap"` e reduzir o corpo, em vez de deixar quebrar. **[fonte] + [projeto]**
- Limite: código desenha o que uma página web desenha. Luz, materiais, partículas e 3D de verdade só entram como arquivos prontos; por isso vídeos só em código costumam parecer chapados. Para o gancho (os primeiros segundos), um clipe já desenhado pode ser mais rápido do que insistir no código. **[fonte]**
- Áudio: o Remotion toca arquivos que você fornece; gerar a voz ou a música é outra ferramenta. **[fonte]**

## 6. Regras deste projeto (decididas com o dono)

**Grade do Reels** (vídeo 1080 × 1920), medida no print de um anúncio num celular de tela alta: **[projeto]**
- Faixa de risco de cima até y 220. Embaixo, a legenda termina em y 1400 (o avatar e o nome do perfil começam em ~1403).
- O Instagram corta uns 97 px de cada lado em telas altas. Os botões ficam em x 879 a 951, de y 868 a 1574.
- Coluna útil centrada na tela (x 540): conteúdo de x 210 a 870, de y 350 a 1170. Legenda centrada, com largura de 640 px.
- Legenda **presa pelo topo** (y 1184): a 2ª linha cresce para baixo. No máximo 2 linhas; medir antes.
- Isso vale para o aparelho do print. Em outro aparelho pode variar; na dúvida, pedir outro print.

**Estilo atual** (versão 22 do criativo "Filipe modelado"): **[projeto]**
- Fundos: creme com linhas finas e degradê verde (lima a azul-esverdeado), alternando. Formas verdes brilhantes à deriva nas cenas em degradê.
- Fontes: Inter fina (pesos 300 a 400) e Inter 700 para palavra-chave. Antes usamos Inter + EB Garamond; a ITC Garamond é licenciada e não está disponível.
- Movimento: abertura circular entre cenas, leque de lâminas nas trocas fortes, cards flutuando, fichas em espiral, celular com feed de reels.
- Legenda sobre o rosto: sombra desfocada, sem contorno.

**Conteúdo e anúncios:** **[projeto]**
- Só números reais (399 e 33,2 mi, 107 formatos, R$ 158 por R$ 47, 7 dias de garantia). Sem nota com estrelas, sem depoimento que não seja do cliente.
- Sem promessa de resultado quando possível; o dono pode optar por mantê-la sabendo do risco de reprovação.
- Seguir a estrutura de um anúncio que já deu certo (gancho, meio, chamada) e mudar só o produto. Não inventar bloco novo.
- Nos trechos com o rosto, a fala tem que ser a voz real; voz clonada só no meio (telas).
- A fala é a fonte de verdade do tempo: transcrever com Whisper (com tempo por palavra), corrigir palavras mal ouvidas e legendar com o texto certo.

## 7. O que ainda não foi feito

- Instalar as skills oficiais acima e testar um bloco de 10 s no Remotion e no HyperFrames, para comparar.
- Escrever um `frame.md` (sistema de design para vídeo) com as cores, fontes e grade da seção 6.
- Testar `/reverse-any-video` com o vídeo de referência do aplicativo de finanças (22 s).

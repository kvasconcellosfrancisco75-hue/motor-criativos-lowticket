import React from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, staticFile } from "remotion";
import "@fontsource/bricolage-grotesque/500.css";
import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "@fontsource/instrument-serif/400-italic.css";
import { Cena, TemaCtx } from "./comum";
import { CENAS } from "./cenas";
import type { PropsCriativo } from "./tipos";

/* Garante que as fontes estejam carregadas antes do primeiro quadro. */
if (typeof document !== "undefined") {
  const h = delayRender("fontes");
  Promise.all(
    ["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 100px "Bricolage Grotesque"`)).concat(document.fonts.load(`italic 400 100px "Instrument Serif"`)),
  ).then(() => continueRender(h), () => continueRender(h));
}

export const Criativo: React.FC<PropsCriativo> = ({ tema, cenas, duracoes, audio }) => {
  let inicio = 0;
  return (
    <TemaCtx.Provider value={tema}>
      <AbsoluteFill style={{ background: tema.claro }}>
        {audio && <Audio src={staticFile(audio)} />}
        {cenas.map((cena, i) => {
          const Comp = CENAS[cena.tipo];
          const dur = duracoes[i] ?? 60;
          const el = (
            <Cena key={i} from={inicio} dur={dur} tom={cena.tom} primeira={i === 0} ultima={i === cenas.length - 1}>
              <Comp cena={cena} dur={dur} />
            </Cena>
          );
          inicio += dur;
          return el;
        })}
      </AbsoluteFill>
    </TemaCtx.Provider>
  );
};

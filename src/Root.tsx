import React from "react";
import { Composition } from "remotion";
import { Criativo } from "./Criativo";
import { DIMENSOES, FPS, type PropsCriativo } from "./tipos";

/** Props de demonstração para o Remotion Studio. Na renderização, o motor passa as props de cada variação. */
const demo: PropsCriativo = {
  formato: "9x16",
  tema: { claro: "#FBF6EC", escuro: "#14452F", destaque: "#CBF26B", texto: "#10241A", fonteTitulo: "Bricolage Grotesque", fonteCitacao: "Instrument Serif" },
  cenas: [
    { tipo: "titulo", fala: "", dados: { linhas: ["Motor de", "criativos"], marca: "criativos" } },
    { tipo: "contador", fala: "", tom: "escuro", dados: { antes: "Gere", numero: 100, prefixo: "+", depois: "variações" } },
    { tipo: "cta", fala: "", tom: "escuro", dados: { pergunta: ["A partir da", "ficha do produto"], marca: "ficha", botao: "Saiba mais" } },
  ],
  duracoes: [60, 60, 120],
};

export const Root: React.FC = () => (
  <Composition
    id="Criativo"
    component={Criativo}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={240}
    defaultProps={demo}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, props.duracoes.reduce((a, b) => a + b, 0)),
      ...DIMENSOES[props.formato],
    })}
  />
);

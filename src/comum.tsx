import React, { createContext, useContext } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Tema, Tom } from "./tipos";
import pop from "./sfx/pop.wav";
import whoosh from "./sfx/whoosh.wav";
import notif from "./sfx/notif.wav";
import caixa from "./sfx/caixa.wav";

export const SONS = { pop, whoosh, notif, caixa } as const;
export type Som = keyof typeof SONS;

export const r = (n: number) => Math.round(n * 100) / 100;
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ---------- Tema ---------- */
export const TemaCtx = createContext<Tema | null>(null);
export const useTema = () => {
  const t = useContext(TemaCtx);
  if (!t) throw new Error("Tema não definido");
  return t;
};

/** Cores de fundo, texto e marca-texto para cada tom de cena. */
export const useCores = (tom: Tom = "claro") => {
  const t = useTema();
  if (tom === "escuro") return { fundo: t.escuro, texto: t.claro, destaque: t.destaque, marca: t.destaque, marcaTexto: t.texto };
  if (tom === "destaque") return { fundo: t.destaque, texto: t.texto, destaque: t.escuro, marca: t.escuro, marcaTexto: t.claro };
  return { fundo: t.claro, texto: t.texto, destaque: t.escuro, marca: t.destaque, marcaTexto: t.texto };
};

/** Escala vertical: 1 no 9:16 (1920 px de altura), menor no 4:5. */
export const useEscala = () => {
  const { height } = useVideoConfig();
  return height / 1920;
};

/** Margens seguras: o rodapé do Reels/Stories é coberto pela interface. */
export const usePad = (): React.CSSProperties => {
  const s = useEscala();
  return { padding: `${Math.round(240 * s)}px 80px ${Math.round(340 * s)}px`, flexDirection: "column" };
};

/* ---------- Animações ---------- */
export const usePop = (delay = 0, damping = 11) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness: 170, mass: 0.7 } });
};
export const useFade = (delay = 0, dur = 8) => interpolate(useCurrentFrame(), [delay, delay + dur], [0, 1], clamp);

/* ---------- Fundo e transição ---------- */
export const Fundo: React.FC<{ tom?: Tom }> = ({ tom = "claro" }) => {
  const c = useCores(tom);
  const linha = tom === "escuro" ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
  return (
    <AbsoluteFill style={{ background: c.fundo }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${linha} 2px, transparent 2px), linear-gradient(90deg, ${linha} 2px, transparent 2px)`,
          backgroundSize: "90px 90px",
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(1000px 800px at 78% 10%, rgba(255,255,255,0.18), transparent 70%)" }} />
    </AbsoluteFill>
  );
};

/** Cena com troca em "whip" (borrão horizontal) na entrada e na saída. */
export const Cena: React.FC<{
  from: number;
  dur: number;
  tom?: Tom;
  primeira?: boolean;
  ultima?: boolean;
  children: React.ReactNode;
}> = ({ from, dur, tom, primeira, ultima, children }) => (
  <Sequence from={from} durationInFrames={dur}>
    <CenaInterna dur={dur} tom={tom} primeira={primeira} ultima={ultima} id={`whip${from}`}>
      {children}
    </CenaInterna>
    {!primeira && <Audio src={SONS.whoosh} volume={0.3} />}
  </Sequence>
);

const CenaInterna: React.FC<{ dur: number; tom?: Tom; primeira?: boolean; ultima?: boolean; id: string; children: React.ReactNode }> = ({
  dur,
  tom,
  primeira,
  ultima,
  id,
  children,
}) => {
  const f = useCurrentFrame();
  const { width } = useVideoConfig();
  const entra = primeira ? 0 : interpolate(f, [0, 7], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const sai = ultima ? 0 : interpolate(f, [dur - 6, dur], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const x = r(entra * width - sai * width);
  const blur = r(Math.max(entra, sai) * 70);
  return (
    <AbsoluteFill style={{ transform: `translateX(${x}px)`, filter: blur > 0.5 ? `url(#${id})` : undefined }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} x="-20%" width="140%">
          <feGaussianBlur stdDeviation={`${blur} 0`} />
        </filter>
      </svg>
      <Fundo tom={tom} />
      {children}
    </AbsoluteFill>
  );
};

export const Efeito: React.FC<{ em: number; som: Som; volume?: number }> = ({ em, som, volume = 0.5 }) => (
  <Sequence from={em} durationInFrames={40} layout="none">
    <Audio src={SONS[som]} volume={volume} />
  </Sequence>
);

/* ---------- Texto ---------- */
export const Titulo: React.FC<{ children: React.ReactNode; tamanho?: number; cor?: string; delay?: number; style?: React.CSSProperties }> = ({
  children,
  tamanho = 118,
  cor,
  delay = 0,
  style,
}) => {
  const t = useTema();
  const s = useEscala();
  const p = usePop(delay, 14);
  return (
    <div
      style={{
        fontFamily: t.fonteTitulo,
        fontWeight: 800,
        fontSize: Math.round(tamanho * Math.max(s, 0.78)),
        lineHeight: 1.04,
        letterSpacing: "-0.035em",
        color: cor ?? t.texto,
        opacity: Math.min(1, p * 1.6),
        transform: `translateY(${r((1 - p) * 60)}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Marca-texto que passa da esquerda para a direita. */
export const Marca: React.FC<{ children: React.ReactNode; delay?: number; fundo: string; texto: string }> = ({ children, delay = 0, fundo, texto }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [delay, delay + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(${fundo}, ${fundo})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${r(p * 100)}% 88%`,
        backgroundPosition: "0 60%",
        padding: "0 0.12em",
        margin: "0 -0.06em",
        borderRadius: 10,
        color: p > 0.4 ? texto : undefined,
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      }}
    >
      {children}
    </span>
  );
};

/** Escreve uma frase destacando a palavra `marca` (se houver). */
export const FraseComMarca: React.FC<{ texto: string; marca?: string; delay: number; tom?: Tom }> = ({ texto, marca, delay, tom }) => {
  const c = useCores(tom);
  if (!marca || !texto.includes(marca)) return <>{texto}</>;
  const [antes, depois] = texto.split(marca);
  return (
    <>
      {antes}
      <Marca delay={delay} fundo={c.marca} texto={c.marcaTexto}>
        {marca}
      </Marca>
      {depois}
    </>
  );
};

export const Check: React.FC<{ tamanho?: number; fundo: string; traco: string }> = ({ tamanho = 40, fundo, traco }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
    <circle cx="20" cy="20" r="20" fill={fundo} />
    <path d="M11 21l6 6 12-13" stroke={traco} strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Número que rola com borrão vertical. */
export const Contagem: React.FC<{ ate: number; de?: number; delay?: number; dur?: number; tamanho?: number; cor: string; prefixo?: string; id: string }> = ({
  ate,
  de = 0,
  delay = 0,
  dur = 22,
  tamanho = 420,
  cor,
  prefixo = "",
  id,
}) => {
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const p = interpolate(f, [delay, delay + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const bruto = interpolate(f, [delay, delay + dur], [0, 1], clamp);
  const velocidade = bruto >= 1 ? 0 : 1 - p;
  const valor = bruto >= 1 ? ate : Math.round(de + (ate - de) * p);
  const blur = r(velocidade * 34);
  return (
    <div
      style={{
        fontFamily: t.fonteTitulo,
        fontWeight: 800,
        fontSize: Math.round(tamanho * Math.max(s, 0.78)),
        lineHeight: 0.9,
        letterSpacing: "-0.05em",
        color: cor,
        opacity: f < delay ? 0 : 1,
        transform: `translateY(${r(velocidade * 70)}px)`,
        filter: blur > 0.5 ? `url(#${id})` : undefined,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} y="-30%" height="160%">
          <feGaussianBlur stdDeviation={`0 ${blur}`} />
        </filter>
      </svg>
      {prefixo}
      {valor.toLocaleString("pt-BR")}
    </div>
  );
};

/** Personagem (imagem PNG transparente dos ativos do produto) entrando de baixo. */
export const Personagem: React.FC<{ arquivo?: string; altura: number; delay?: number; lado?: "esquerda" | "direita" | "centro"; tremer?: boolean }> = ({
  arquivo,
  altura,
  delay = 0,
  lado = "direita",
  tremer,
}) => {
  const f = useCurrentFrame();
  const s = useEscala();
  const escala = useTema().escalaPersonagem ?? 1;
  const p = usePop(delay, 10);
  if (!arquivo) return null;
  // Ícone (escala < 1): imagem quadrada, menor e acima da borda, em vez de uma personagem de corpo inteiro.
  const icone = escala < 1;
  const h = altura * s * escala;
  const t = Math.max(0, f - delay);
  const flutua = Math.sin(t / 14) * 8;
  const giro = tremer ? Math.sin(t * 1.7) * 1.2 : Math.sin(t / 20);
  const pos: React.CSSProperties =
    lado === "esquerda" ? { left: 60 } : lado === "centro" ? { left: "50%", marginLeft: `-${Math.round(h * (icone ? 0.5 : 0.38))}px` } : { right: icone ? 90 : 60 };
  return (
    <Img
      src={staticFile(arquivo)}
      style={{
        position: "absolute",
        bottom: (icone ? 150 : -40) * s,
        height: h,
        ...pos,
        transformOrigin: "50% 100%",
        transform: `translateY(${r((1 - p) * h * 0.7 + flutua)}px) rotate(${r(giro)}deg)`,
        opacity: Math.min(1, p * 3),
        filter: "drop-shadow(0 24px 40px rgba(0,0,0,0.28))",
      }}
    />
  );
};

export { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig };

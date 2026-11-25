/**
 * Cenas ilustradas e animadas, no estilo motion graphics: objetos chapados que entram, voam e se
 * encaixam, com pouco texto. Servem para criativos que contam a história sem narração (só música).
 * Como as outras cenas, não sabem qual é o produto: os textos e valores vêm de cena.dados.
 */
import React from "react";
import { Easing, OffthreadVideo } from "remotion";
import { AbsoluteFill, Efeito, FraseComMarca, Titulo, clamp, interpolate, r, staticFile, useCores, useCurrentFrame, useEscala, usePad, usePop, useTema } from "../comum";
import type { Cena } from "../tipos";

type P = { cena: Cena; dur: number };
const str = (v: unknown, padrao = "") => (typeof v === "string" ? v : padrao);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);
const OURO = "#FFC53D";
const OURO_ESCURO = "#C98A00";
const BRANCO = "#FFFFFF";

/** Título curto no alto da cena (linhas + palavra marcada). */
const Topo: React.FC<{ cena: Cena; delay?: number; max?: number }> = ({ cena, delay = 2, max = 130 }) => {
  const pad = usePad();
  const c = useCores(cena.tom);
  const linhas = lista(cena.dados.linhas);
  const maior = Math.max(...linhas.map((l) => l.length), 1);
  const tamanho = Math.max(72, Math.min(max, Math.floor(920 / (maior * 0.54))));
  return (
    <AbsoluteFill style={{ ...pad, justifyContent: "flex-start", pointerEvents: "none" }}>
      {linhas.map((l, i) => (
        <Titulo key={i} delay={delay + i * 5} tamanho={tamanho} cor={c.texto} style={{ lineHeight: 1.04 }}>
          <FraseComMarca texto={l} marca={str(cena.dados.marca)} delay={delay + 6 + i * 5} tom={cena.tom} />
        </Titulo>
      ))}
    </AbsoluteFill>
  );
};

/** Moeda com valor. */
const Moeda: React.FC<{ texto: string; tamanho: number; style?: React.CSSProperties }> = ({ texto, tamanho, style }) => {
  const t = useTema();
  return (
    <div
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: "50%",
        background: OURO,
        boxShadow: `inset 0 -${tamanho * 0.08}px 0 ${OURO_ESCURO}, 0 ${tamanho * 0.1}px ${tamanho * 0.2}px rgba(0,0,0,.25)`,
        border: `${Math.max(4, tamanho * 0.04)}px solid ${OURO_ESCURO}`,
        display: "grid",
        placeItems: "center",
        fontFamily: t.fonteTitulo,
        fontWeight: 800,
        fontSize: tamanho * 0.24,
        color: "#5A3A00",
        letterSpacing: "-0.03em",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {texto}
    </div>
  );
};

/* ---------------- caixa: o pedido fecha e o lucro pula para fora ---------------- */
export const CenaCaixa: React.FC<P> = ({ cena, dur }) => {
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const entra = usePop(0, 13);
  const fecha = interpolate(f, [6, 18], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const fita = interpolate(f, [18, 26], [0, 1], clamp);
  const selo = usePop(24, 9);
  const moeda = usePop(14, 8);
  const voo = interpolate(f, [14, 34], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const bob = Math.sin(f / 6) * 10;
  const W = 620 * s, H = 470 * s;
  const cx = 540, base = 1240 * s;
  return (
    <AbsoluteFill>
      <Topo cena={cena} delay={4} />
      {/* sombra */}
      <div style={{ position: "absolute", left: cx - W * 0.62, top: base + 6, width: W * 1.24, height: 60 * s, borderRadius: "50%", background: "rgba(0,0,0,.12)", transform: `scaleX(${r(entra)})` }} />
      <div style={{ position: "absolute", left: cx - W / 2, top: base - H, width: W, height: H, transform: `translateY(${r((1 - entra) * 500)}px)` }}>
        {/* abas */}
        {[-1, 1].map((lado) => (
          <div
            key={lado}
            style={{
              position: "absolute",
              top: 0,
              left: lado < 0 ? 0 : W / 2,
              width: W / 2,
              height: H * 0.34,
              background: "#C93A1E",
              transformOrigin: lado < 0 ? "0% 0%" : "100% 0%",
              transform: `rotate(${r(lado * (1 - fecha) * -150)}deg)`,
              borderRadius: 10,
            }}
          />
        ))}
        {/* corpo */}
        <div style={{ position: "absolute", inset: 0, background: t.destaque, borderRadius: 16, boxShadow: "inset -40px 0 0 rgba(0,0,0,.12)" }} />
        {/* fita */}
        <div style={{ position: "absolute", left: W / 2 - 50 * s, top: 0, width: 100 * s, height: H * fita, background: "rgba(255,255,255,.55)" }} />
        {/* selo */}
        <div
          style={{
            position: "absolute",
            left: W * 0.1,
            top: H * 0.48,
            padding: `${18 * s}px ${30 * s}px`,
            background: BRANCO,
            color: t.destaque,
            borderRadius: 14,
            fontFamily: t.fonteTitulo,
            fontWeight: 800,
            fontSize: 64 * s,
            letterSpacing: "-0.02em",
            transform: `rotate(-6deg) scale(${r(selo)})`,
            boxShadow: "0 10px 24px rgba(0,0,0,.18)",
          }}
        >
          {str(cena.dados.selo, "Vendido!")}
        </div>
      </div>
      {/* lucro pulando */}
      <Moeda
        texto={str(cena.dados.moeda)}
        tamanho={300 * s}
        style={{
          position: "absolute",
          left: cx - 150 * s + voo * 250 * s,
          top: base - H - 40 * s - voo * 150 * s + (voo >= 1 ? bob : 0),
          transform: `scale(${r(moeda)}) rotate(${r((1 - voo) * -40)}deg)`,
        }}
      />
      <Efeito em={6} som="caixa" volume={0.45} />
      <Efeito em={24} som="pop" volume={0.5} />
      <Efeito em={14} som="notif" volume={0.35} />
    </AbsoluteFill>
  );
};

/* ---------------- cartoes: os custos entram como cartões e somam no total ---------------- */
const Cartao: React.FC<{ delay: number; rotulo: string; valor: string; x: number; y: number; w: number; h: number; destaque?: boolean }> = ({ delay, rotulo, valor, x, y, w, h, destaque }) => {
  const t = useTema();
  const s = useEscala();
  const p = usePop(delay, 10);
  const fundo = destaque ? t.escuro : BRANCO;
  const texto = destaque ? t.claro : t.texto;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 34 * s,
        background: fundo,
        boxShadow: "0 18px 40px rgba(0,0,0,.12)",
        padding: 34 * s,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transform: `translateY(${r((1 - p) * 120)}px) scale(${r(0.6 + 0.4 * p)})`,
        opacity: Math.min(1, p * 2),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 * s }}>
        <div style={{ width: 44 * s, height: 44 * s, borderRadius: 12 * s, background: destaque ? t.destaque : `${t.destaque}33` }} />
        <div style={{ fontFamily: t.fonteTitulo, fontWeight: 600, fontSize: 46 * s, color: texto, opacity: 0.75 }}>{rotulo}</div>
      </div>
      <div style={{ fontFamily: t.fonteTitulo, fontWeight: 800, fontSize: (destaque ? 120 : 84) * s, color: destaque ? t.destaque : texto, letterSpacing: "-0.04em", lineHeight: 1 }}>{valor}</div>
    </div>
  );
};
export const CenaCartoes: React.FC<P> = ({ cena }) => {
  const s = useEscala();
  const itens = (Array.isArray(cena.dados.itens) ? cena.dados.itens : []) as { rotulo: string; valor: string }[];
  const total = (cena.dados.total ?? {}) as { rotulo?: string; valor?: string };
  const m = 80, gap = 30;
  const w = (1080 - 2 * m - gap) / 2, h = 250 * s;
  const y0 = 640 * s;
  return (
    <AbsoluteFill>
      <Topo cena={cena} />
      {itens.slice(0, 4).map((it, i) => (
        <Cartao key={i} delay={6 + i * 6} rotulo={it.rotulo} valor={it.valor} x={m + (i % 2) * (w + gap)} y={y0 + Math.floor(i / 2) * (h + gap)} w={itens.length === 3 && i === 2 ? w * 2 + gap : w} h={h} />
      ))}
      {total.valor && <Cartao delay={6 + itens.length * 6 + 4} rotulo={str(total.rotulo)} valor={str(total.valor)} x={m} y={y0 + 2 * (h + gap) + 10} w={1080 - 2 * m} h={h * 1.15} destaque />}
      {itens.map((_, i) => (
        <Efeito key={i} em={6 + i * 6} som="pop" volume={0.4} />
      ))}
      <Efeito em={6 + itens.length * 6 + 4} som="caixa" volume={0.45} />
    </AbsoluteFill>
  );
};

/* ---------------- voando: etiquetas de taxa cruzam a tela e mordem o lucro ---------------- */
const Etiqueta: React.FC<{ texto: string; delay: number; de: [number, number]; para: [number, number]; giro: number }> = ({ texto, delay, de, para, giro }) => {
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const p = interpolate(f, [delay, delay + 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const x = de[0] + (para[0] - de[0]) * p;
  const y = (de[1] + (para[1] - de[1]) * p) * s - Math.sin(p * Math.PI) * 120 * s;
  const flut = p >= 1 ? Math.sin((f - delay) / 7) * 8 : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y + flut,
        transform: `translate(-50%,-50%) rotate(${r(giro * (1 - p) * 3 + giro)}deg)`,
        display: "flex",
        alignItems: "center",
        gap: 18 * s,
        padding: `${22 * s}px ${36 * s}px ${22 * s}px ${26 * s}px`,
        background: BRANCO,
        borderRadius: 999,
        boxShadow: "0 16px 34px rgba(0,0,0,.35)",
        fontFamily: t.fonteTitulo,
        fontWeight: 800,
        fontSize: 60 * s,
        color: t.texto,
        whiteSpace: "nowrap",
        opacity: f < delay ? 0 : 1,
      }}
    >
      <span style={{ width: 66 * s, height: 66 * s, borderRadius: "50%", background: t.destaque, color: BRANCO, display: "grid", placeItems: "center", fontSize: 44 * s }}>%</span>
      {texto}
    </div>
  );
};
export const CenaVoando: React.FC<P> = ({ cena, dur }) => {
  const s = useEscala();
  const f = useCurrentFrame();
  const itens = lista(cena.dados.itens).slice(0, 4);
  const rotas: { de: [number, number]; para: [number, number]; giro: number }[] = [
    { de: [-300, 700], para: [300, 820], giro: -8 },
    { de: [1400, 900], para: [790, 960], giro: 7 },
    { de: [-300, 1500], para: [280, 1460], giro: 6 },
    { de: [1400, 1650], para: [780, 1580], giro: -6 },
  ];
  // a moeda do lucro encolhe a cada etiqueta que chega
  const chegadas = itens.map((_, i) => 6 + i * 7 + 22);
  const mordidas = chegadas.filter((c) => f >= c).length;
  const alvo = 1 - mordidas * (0.72 / Math.max(1, itens.length));
  const escala = interpolate(f, [0, 8], [0, 1], clamp) * alvo;
  const treme = mordidas > 0 && f < chegadas[mordidas - 1] + 6 ? Math.sin(f * 3) * 12 : 0;
  return (
    <AbsoluteFill>
      <Topo cena={cena} />
      <Moeda texto={str(cena.dados.moeda)} tamanho={360 * s} style={{ position: "absolute", left: 540 - 180 * s + treme, top: 1180 * s - 180 * s, transform: `scale(${r(Math.max(0.2, escala))})`, filter: mordidas >= itens.length ? "grayscale(.7)" : undefined }} />
      {itens.map((x, i) => (
        <Etiqueta key={i} texto={x} delay={6 + i * 7} de={rotas[i].de} para={rotas[i].para} giro={rotas[i].giro} />
      ))}
      {chegadas.map((c, i) => (
        <Efeito key={i} em={c - 4} som="pop" volume={0.45} />
      ))}
    </AbsoluteFill>
  );
};

/* ---------------- celular: visão em primeira pessoa do celular com a gravação do produto ---------------- */
export const CenaCelular: React.FC<P> = ({ cena, dur }) => {
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const p = usePop(0, 14);
  const video = str(cena.dados.video);
  const W = 640 * s, H = 1250 * s;
  const giro = interpolate(f, [0, dur], [-4, 2], clamp);
  const toque = (f % 9) / 9;
  return (
    <AbsoluteFill>
      <Topo cena={cena} max={120} />
      <div
        style={{
          position: "absolute",
          left: 540 - W / 2,
          top: 560 * s,
          width: W,
          height: H,
          borderRadius: 90 * s,
          background: "#141414",
          padding: 22 * s,
          boxSizing: "border-box",
          boxShadow: "0 40px 90px rgba(0,0,0,.35)",
          transform: `translateY(${r((1 - p) * 900)}px) rotate(${r(giro)}deg)`,
        }}
      >
        <div style={{ width: "100%", height: "100%", borderRadius: 70 * s, overflow: "hidden", background: t.destaque, position: "relative" }}>
          {video && <OffthreadVideo src={staticFile(video)} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
          <div style={{ position: "absolute", top: 18 * s, left: "50%", width: 180 * s, height: 46 * s, marginLeft: -90 * s, borderRadius: 30, background: "#141414" }} />
        </div>
        {/* polegar tocando */}
        <div
          style={{
            position: "absolute",
            right: -170 * s,
            bottom: -150 * s + Math.abs(Math.sin(f / 4.5)) * 40 * s,
            width: 280 * s,
            height: 380 * s,
            borderRadius: "48% 48% 40% 40%",
            background: "#F2A27B",
            boxShadow: "inset 20px -30px 0 rgba(0,0,0,.08)",
            transform: "rotate(-28deg)",
          }}
        />
        <div style={{ position: "absolute", left: "62%", top: "88%", width: 120 * s, height: 120 * s, marginLeft: -60 * s, marginTop: -60 * s, borderRadius: "50%", border: `6px solid ${BRANCO}`, opacity: r(1 - toque), transform: `scale(${r(0.4 + toque)})` }} />
      </div>
      <Efeito em={4} som="whoosh" volume={0.3} />
    </AbsoluteFill>
  );
};

/* ---------------- etiqueta: preço cheio riscado, carimbo de desconto e o preço final ---------------- */
export const CenaEtiqueta: React.FC<P> = ({ cena, dur }) => {
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const entra = usePop(0, 9);
  const balanco = Math.sin(f / 7) * 5 * Math.max(0, 1 - f / 40);
  const risco = interpolate(f, [10, 18], [0, 100], clamp);
  const carimbo = interpolate(f, [16, 22], [2.4, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const novo = usePop(24, 10);
  const lucro = usePop(32, 9);
  const W = 760 * s, H = 820 * s;
  return (
    <AbsoluteFill>
      <Topo cena={cena} />
      {/* barbante */}
      <div style={{ position: "absolute", left: 538, top: 560 * s, width: 4, height: 110 * s, background: t.texto, opacity: 0.5 }} />
      <div style={{ position: "absolute", left: 540 - W / 2, top: 660 * s, width: W, height: H, transformOrigin: "50% 0%", transform: `translateY(${r((1 - entra) * -700)}px) rotate(${r(balanco)}deg)` }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: BRANCO,
            clipPath: "polygon(50% 0%, 100% 14%, 100% 100%, 0% 100%, 0% 14%)",
            borderRadius: 30,
            boxShadow: "0 30px 60px rgba(0,0,0,.15)",
          }}
        />
        <div style={{ position: "absolute", left: W / 2 - 26 * s, top: 46 * s, width: 52 * s, height: 52 * s, borderRadius: "50%", background: t.claro, border: `6px solid ${t.texto}33` }} />
        <div style={{ position: "absolute", inset: `${170 * s}px 0 0`, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ position: "relative", fontFamily: t.fonteTitulo, fontWeight: 700, fontSize: 96 * s, color: t.texto, opacity: 0.5 }}>
            {str(cena.dados.cheio)}
            <div style={{ position: "absolute", left: 0, top: "54%", height: 9, width: `${r(risco)}%`, background: t.texto }} />
          </div>
          <div style={{ fontFamily: t.fonteTitulo, fontWeight: 800, fontSize: 200 * s, color: t.destaque, letterSpacing: "-0.05em", lineHeight: 1.05, transform: `scale(${r(novo)})`, opacity: Math.min(1, novo * 2) }}>
            {str(cena.dados.final)}
          </div>
        </div>
        {/* carimbo */}
        <div
          style={{
            position: "absolute",
            right: -60 * s,
            top: 560 * s,
            padding: `${20 * s}px ${34 * s}px`,
            border: `${10 * s}px solid ${t.destaque}`,
            borderRadius: 24 * s,
            background: t.claro,
            color: t.destaque,
            fontFamily: t.fonteTitulo,
            fontWeight: 800,
            fontSize: 92 * s,
            transform: `rotate(12deg) scale(${r(carimbo)})`,
            opacity: f < 16 ? 0 : 1,
          }}
        >
          {str(cena.dados.desconto)}
        </div>
      </div>
      {/* lucro preservado */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1520 * s, display: "flex", justifyContent: "center", transform: `scale(${r(lucro)})`, opacity: Math.min(1, lucro * 2) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 * s, padding: `${20 * s}px ${40 * s}px ${20 * s}px ${20 * s}px`, borderRadius: 999, background: t.escuro, color: t.claro, fontFamily: t.fonteTitulo, fontWeight: 800, fontSize: 64 * s }}>
          <Moeda texto="R$" tamanho={96 * s} />
          {str(cena.dados.lucro)}
        </div>
      </div>
      <Efeito em={16} som="caixa" volume={0.5} />
      <Efeito em={24} som="pop" volume={0.45} />
      <Efeito em={32} som="notif" volume={0.35} />
    </AbsoluteFill>
  );
};

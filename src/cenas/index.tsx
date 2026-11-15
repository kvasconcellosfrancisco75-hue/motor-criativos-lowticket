import React from "react";
import { OffthreadVideo } from "remotion";
import {
  AbsoluteFill,
  Check,
  Contagem,
  Efeito,
  FraseComMarca,
  Marca,
  Personagem,
  Titulo,
  clamp,
  interpolate,
  r,
  staticFile,
  useCores,
  useCurrentFrame,
  useEscala,
  usePad,
  usePop,
  useTema,
} from "../comum";
import type { Cena, TipoCena } from "../tipos";

type P = { cena: Cena; dur: number };
const str = (v: unknown, padrao = "") => (typeof v === "string" ? v : padrao);
const num = (v: unknown, padrao = 0) => (typeof v === "number" ? v : Number(v) || padrao);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

/* Os elementos de cada cena entram distribuídos na primeira metade dela,
   para acompanhar a fala sem depender do tempo exato de cada palavra. */
const passo = (dur: number, n: number) => Math.max(4, Math.min(18, Math.floor((dur * 0.5) / Math.max(1, n))));

/** titulo: linhas grandes, uma palavra marcada e personagem opcional. */
const CenaTitulo: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const c = useCores(cena.tom);
  const linhas = lista(cena.dados.linhas);
  const marca = str(cena.dados.marca);
  const k = passo(dur, linhas.length + 1);
  return (
    <AbsoluteFill style={{ ...pad, justifyContent: cena.personagem ? "flex-start" : "center" }}>
      {linhas.map((l, i) => (
        <Titulo key={i} delay={2 + i * k} tamanho={num(cena.dados.tamanho, 124)} cor={c.texto}>
          <FraseComMarca texto={l} marca={marca} delay={8 + i * k} tom={cena.tom} />
        </Titulo>
      ))}
      <Personagem arquivo={cena.personagem} altura={900} delay={4 + k} lado="direita" />
      <Efeito em={2} som="pop" volume={0.4} />
    </AbsoluteFill>
  );
};

/** citacao: frase de apoio + uma citação grande em itálico (ex.: a promessa que não se cumpre). */
const CenaCitacao: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const t = useTema();
  const s = useEscala();
  const c = useCores(cena.tom);
  const meio = Math.floor(dur * 0.35);
  const q = usePop(meio, 10);
  return (
    <AbsoluteFill style={pad}>
      <Titulo delay={3} tamanho={112} cor={c.texto}>
        {str(cena.dados.antes)}
      </Titulo>
      <div
        style={{
          fontFamily: t.fonteCitacao,
          fontStyle: "italic",
          fontSize: Math.round(190 * Math.max(s, 0.78)),
          lineHeight: 1.0,
          marginTop: 40,
          color: c.destaque,
          transformOrigin: "left center",
          transform: `scale(${r(0.7 + 0.3 * q)})`,
          opacity: Math.min(1, q * 2),
        }}
      >
        “{str(cena.dados.citacao)}”
      </div>
      <Personagem arquivo={cena.personagem} altura={900} delay={meio + 4} lado="direita" />
      <Efeito em={meio} som="pop" volume={0.55} />
    </AbsoluteFill>
  );
};

/** contador: número grande que rola, com texto antes e depois. */
const CenaContador: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const c = useCores(cena.tom);
  const meio = Math.floor(dur * 0.3);
  return (
    <AbsoluteFill style={{ ...pad, justifyContent: cena.personagem ? "flex-start" : "center" }}>
      {str(cena.dados.antes) && (
        <Titulo delay={2} tamanho={104} cor={c.texto}>
          {str(cena.dados.antes)}
        </Titulo>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 28, marginTop: 10, flexWrap: "wrap" }}>
        <Contagem id={`n${num(cena.dados.numero)}`} ate={num(cena.dados.numero)} prefixo={str(cena.dados.prefixo)} delay={meio} dur={20} tamanho={num(cena.dados.tamanho, 420)} cor={c.destaque} />
        <Titulo delay={meio + 10} tamanho={104} cor={c.texto} style={{ paddingBottom: 30 }}>
          {str(cena.dados.depois)}
        </Titulo>
      </div>
      <Personagem arquivo={cena.personagem} altura={900} delay={meio + 4} lado="direita" tremer={Boolean(cena.dados.tremer)} />
      <Efeito em={meio} som="pop" volume={0.6} />
    </AbsoluteFill>
  );
};

/** lista: título + itens com check (ex.: o que vem em cada ficha). */
const CenaLista: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const c = useCores(cena.tom);
  const t = useTema();
  const s = useEscala();
  const itens = lista(cena.dados.itens);
  const k = passo(dur, itens.length + 1);
  return (
    <AbsoluteFill style={{ ...pad, justifyContent: "center" }}>
      <Titulo delay={2} tamanho={110} cor={c.texto}>
        <FraseComMarca texto={str(cena.dados.titulo)} marca={str(cena.dados.marca)} delay={8} tom={cena.tom} />
      </Titulo>
      <div style={{ height: 50 * s }} />
      {itens.map((it, i) => (
        <Item key={i} delay={k * (i + 1)} texto={it} cor={c.texto} check={c.marca} traco={c.marcaTexto} fonte={t.fonteTitulo} s={s} />
      ))}
      {itens.map((_, i) => (
        <Efeito key={i} em={k * (i + 1)} som="pop" volume={0.35} />
      ))}
    </AbsoluteFill>
  );
};
const Item: React.FC<{ delay: number; texto: string; cor: string; check: string; traco: string; fonte: string; s: number }> = ({ delay, texto, cor, check, traco, fonte, s }) => {
  const p = usePop(delay, 12);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        marginTop: 26 * s,
        fontFamily: fonte,
        fontWeight: 700,
        fontSize: Math.round(64 * Math.max(s, 0.8)),
        color: cor,
        transform: `translateX(${r((1 - p) * -120)}px)`,
        opacity: Math.min(1, p * 2),
      }}
    >
      <Check tamanho={Math.round(64 * Math.max(s, 0.8))} fundo={check} traco={traco} />
      {texto}
    </div>
  );
};

/** prova-video: vídeo do produto em tela cheia (ex.: gravação de tela) com o texto por cima. */
const CenaProvaVideo: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const t = useTema();
  const f = useCurrentFrame();
  const video = str(cena.dados.video);
  const zoom = interpolate(f, [0, dur], [1.06, 1.0], clamp);
  if (!video) return <CenaContador cena={{ ...cena, tom: cena.tom ?? "destaque" }} dur={dur} />;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${r(zoom)})` }}>
        <OffthreadVideo src={staticFile(video)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(to bottom, ${t.escuro}F7 0%, ${t.escuro}EB 30%, ${t.escuro}8C 44%, ${t.escuro}00 58%)` }} />
      <AbsoluteFill style={{ ...pad, paddingTop: 230 }}>
        {str(cena.dados.antes) && (
          <Titulo delay={2} tamanho={84} cor={t.claro}>
            {str(cena.dados.antes)}
          </Titulo>
        )}
        <Contagem id="prova" ate={num(cena.dados.numero)} prefixo={str(cena.dados.prefixo)} delay={8} dur={16} tamanho={330} cor={t.destaque} />
        <Titulo delay={18} tamanho={110} cor={t.claro}>
          <FraseComMarca texto={str(cena.dados.depois)} marca={str(cena.dados.marca)} delay={22} tom="escuro" />
        </Titulo>
      </AbsoluteFill>
      <Efeito em={8} som="pop" volume={0.45} />
    </AbsoluteFill>
  );
};

/** batidas: slogan em três batidas, uma palavra por linha, a última marcada. */
const CenaBatidas: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const c = useCores(cena.tom ?? "escuro");
  const palavras = lista(cena.dados.palavras);
  const k = passo(dur, palavras.length);
  // Ajusta o tamanho para a palavra mais longa caber numa linha só.
  const maior = Math.max(...palavras.map((w) => w.length), 1);
  const tamanho = Math.min(num(cena.dados.tamanho, 200), Math.floor(920 / (maior * 0.56)));
  return (
    <AbsoluteFill style={{ ...pad, justifyContent: "center" }}>
      {palavras.map((w, i) => (
        <Titulo key={i} delay={3 + i * k} tamanho={tamanho} cor={c.texto} style={{ lineHeight: 1.08, whiteSpace: "nowrap" }}>
          {i === palavras.length - 1 ? (
            <Marca delay={8 + i * k} fundo={c.marca} texto={c.marcaTexto}>
              {w}
            </Marca>
          ) : (
            w
          )}
        </Titulo>
      ))}
      {palavras.map((_, i) => (
        <Efeito key={i} em={3 + i * k} som="pop" volume={0.55} />
      ))}
    </AbsoluteFill>
  );
};

/** preco: preço com "de" riscado opcional e selos (pagamento único, garantia…). */
const CenaPreco: React.FC<P> = ({ cena }) => {
  const pad = usePad();
  const c = useCores(cena.tom ?? "destaque");
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const de = str(cena.dados.de);
  const risco = interpolate(f, [10, 20], [0, 100], clamp);
  const selos = lista(cena.dados.selos);
  return (
    <AbsoluteFill style={{ ...pad, alignItems: "center", textAlign: "center", justifyContent: "center" }}>
      {de && (
        <div style={{ position: "relative", fontFamily: t.fonteTitulo, fontWeight: 600, fontSize: 80 * s, color: c.texto, opacity: 0.55 }}>
          de {de}
          <div style={{ position: "absolute", left: 0, top: "52%", height: 8, width: `${r(risco)}%`, background: c.texto, borderRadius: 4 }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <Titulo delay={4} tamanho={150} cor={c.destaque} style={{ paddingTop: 54 * s }}>
          {str(cena.dados.moeda, "R$")}
        </Titulo>
        <Contagem id="preco" ate={num(cena.dados.valor)} delay={4} dur={20} tamanho={460} cor={c.destaque} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 40 * s, alignItems: "center" }}>
        {selos.map((x, i) => (
          <Selo key={i} delay={30 + i * 8} texto={x} />
        ))}
      </div>
      <Efeito em={4} som="caixa" volume={0.5} />
    </AbsoluteFill>
  );
};
const Selo: React.FC<{ delay: number; texto: string }> = ({ delay, texto }) => {
  const t = useTema();
  const s = useEscala();
  const p = usePop(delay);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: `${16 * s}px ${30 * s}px`,
        borderRadius: 999,
        background: t.escuro,
        color: t.claro,
        fontFamily: t.fonteTitulo,
        fontWeight: 600,
        fontSize: Math.round(44 * Math.max(s, 0.8)),
        transform: `scale(${r(p)})`,
        opacity: Math.min(1, p * 2),
      }}
    >
      <Check tamanho={44 * s} fundo={t.destaque} traco={t.escuro} />
      {texto}
    </div>
  );
};

/** cta: pergunta em duas fases e, no fim, o botão pulsando (com personagem opcional). */
const CenaCTA: React.FC<P> = ({ cena, dur }) => {
  const pad = usePad();
  const c = useCores(cena.tom ?? "escuro");
  const t = useTema();
  const s = useEscala();
  const f = useCurrentFrame();
  const fases = [lista(cena.dados.pergunta), lista(cena.dados.complemento)].filter((x) => x.length);
  const botaoEm = Math.floor(dur * 0.68);
  const faseDur = Math.floor(botaoEm / Math.max(1, fases.length));
  const fase = Math.min(fases.length, Math.floor(f / Math.max(1, faseDur)));
  const btn = usePop(botaoEm + 6, 9);
  const pulso = f > botaoEm + 20 ? 1 + Math.sin((f - botaoEm - 20) / 5) * 0.035 : 1;
  const anel = f > botaoEm + 20 ? ((f - botaoEm - 20) % 36) / 36 : 0;
  const marca = str(cena.dados.marca);
  return (
    <AbsoluteFill style={{ ...pad, justifyContent: "center" }}>
      {fase < fases.length &&
        fases[fase].map((l, i) => (
          <Titulo key={`${fase}-${i}`} delay={fase * faseDur + 2 + i * 8} tamanho={140} cor={c.texto}>
            <FraseComMarca texto={l} marca={marca} delay={fase * faseDur + 8 + i * 8} tom={cena.tom ?? "escuro"} />
          </Titulo>
        ))}
      {fase >= fases.length && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          {cena.personagem && <CtaPersonagem arquivo={cena.personagem} delay={botaoEm - 2} />}
          <div style={{ height: 24 * s }} />
          <Titulo delay={botaoEm} tamanho={96} cor={c.texto}>
            {str(cena.dados.chamada, "Toque em")}
          </Titulo>
          <div style={{ height: 30 * s }} />
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: -10,
                borderRadius: 999,
                border: `8px solid ${t.destaque}`,
                opacity: r(Math.max(0, 1 - anel * 1.3) * (f > botaoEm + 20 ? 1 : 0)),
                transform: `scale(${r(1 + anel * 0.35)})`,
              }}
            />
            <div
              style={{
                background: t.destaque,
                color: t.texto,
                fontFamily: t.fonteTitulo,
                fontWeight: 800,
                fontSize: Math.round(120 * Math.max(s, 0.8)),
                padding: `${50 * s}px 120px`,
                borderRadius: 999,
                boxShadow: "0 30px 70px rgba(0,0,0,0.35)",
                transform: `scale(${r(btn * pulso)})`,
                opacity: Math.min(1, btn * 2),
              }}
            >
              {str(cena.dados.botao, "Saiba mais")}
            </div>
          </div>
        </div>
      )}
      <Efeito em={2} som="pop" volume={0.4} />
      <Efeito em={botaoEm + 6} som="notif" volume={0.45} />
    </AbsoluteFill>
  );
};
const CtaPersonagem: React.FC<{ arquivo: string; delay: number }> = ({ arquivo, delay }) => {
  const s = useEscala();
  const p = usePop(delay, 10);
  return (
    <img
      src={staticFile(arquivo)}
      style={{ height: 700 * s, transformOrigin: "50% 100%", transform: `scale(${r(0.6 + 0.4 * p)})`, opacity: Math.min(1, p * 3), filter: "drop-shadow(0 24px 40px rgba(0,0,0,0.3))" }}
    />
  );
};

export const CENAS: Record<TipoCena, React.FC<P>> = {
  titulo: CenaTitulo,
  citacao: CenaCitacao,
  contador: CenaContador,
  lista: CenaLista,
  "prova-video": CenaProvaVideo,
  batidas: CenaBatidas,
  preco: CenaPreco,
  cta: CenaCTA,
};

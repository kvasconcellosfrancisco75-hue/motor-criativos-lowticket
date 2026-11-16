/**
 * Formato único de anúncio da Biblioteca de Anúncios da Meta, a partir do que o Actor
 * curious_coder/facebook-ads-library-scraper devolve (aceita também camelCase de outros Actors).
 */

export type Midia = { tipo: "video" | "imagem"; url: string; poster?: string };
export type Card = { titulo: string; texto: string; midia?: Midia; destino: string };

export type AnuncioFB = {
  id: string;
  colecao: string;
  link: string;
  pagina: string;
  pagina_id: string;
  pagina_foto: string;
  pagina_url: string;
  pagina_seguidores: number;
  ativo: boolean;
  inicio: string; // aaaa-mm-dd
  fim: string;
  dias: number; // dias no ar até hoje (ou até sair do ar)
  versoes: number; // "N anúncios usam este criativo e texto"
  formato: string; // video, image, carousel, dco, dpa
  titulo: string;
  texto: string;
  cta: string;
  destino: string;
  dominio: string;
  descricao_link: string;
  plataformas: string[];
  midias: Midia[];
  cards: Card[];
  termo: string; // termo de busca que trouxe o anúncio
  posicao: number; // posição na busca (ordenada por impressões)
};

const campo = (o: any, ...caminhos: string[]) => {
  for (const c of caminhos) {
    const v = c.split(".").reduce((x: any, k) => (x == null ? undefined : x[k]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const paraData = (v: any): Date | undefined => {
  if (v == null || v === "") return undefined;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v).replace(" ", "T") + (/[zZ+]/.test(String(v)) ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const texto = (v: any) =>
  String(v ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const midiaDe = (o: any): Midia | undefined => {
  const video = campo(o, "video_hd_url", "videoHdUrl", "video_sd_url", "videoSdUrl");
  const poster = campo(o, "video_preview_image_url", "videoPreviewImageUrl");
  if (video) return { tipo: "video", url: video, poster };
  const img = campo(o, "original_image_url", "originalImageUrl", "resized_image_url", "resizedImageUrl");
  return img ? { tipo: "imagem", url: img } : undefined;
};

export const dominioDe = (url: string) => {
  try {
    const u = new URL(url);
    // Links da Meta costumam vir embrulhados em l.facebook.com/l.php?u=...
    const real = u.searchParams.get("u");
    return (real ? new URL(real) : u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function normalizar(item: any, hoje = new Date()): AnuncioFB | undefined {
  const id = String(campo(item, "ad_archive_id", "adArchiveID", "adArchiveId", "id") ?? "");
  if (!id) return undefined;
  const s = item.snapshot ?? {};
  const ativo = Boolean(campo(item, "is_active", "isActive"));
  const ini = paraData(campo(item, "start_date", "startDate", "start_date_formatted"));
  const fimD = paraData(campo(item, "end_date", "endDate", "end_date_formatted"));
  const ate = ativo || !fimD ? hoje : fimD;
  const dias = ini ? Math.max(0, Math.round((ate.getTime() - ini.getTime()) / 86400000)) : 0;

  const cards: Card[] = (s.cards ?? []).map((c: any) => ({
    titulo: texto(campo(c, "title")),
    texto: texto(campo(c, "body", "body.text")),
    midia: midiaDe(c),
    destino: String(campo(c, "link_url", "linkUrl") ?? ""),
  }));
  const midias: Midia[] = [
    ...(s.videos ?? []).map(midiaDe),
    ...(s.images ?? []).map(midiaDe),
    ...cards.map((c) => c.midia),
  ].filter(Boolean) as Midia[];

  const destino = String(campo(s, "link_url", "linkUrl") ?? cards.find((c) => c.destino)?.destino ?? "");
  let termo = "";
  try {
    termo = new URL(String(item.url ?? "")).searchParams.get("q") ?? "";
  } catch {}

  return {
    id,
    colecao: String(campo(item, "collation_id", "collationId") ?? id),
    link: String(campo(item, "ad_library_url") ?? `https://www.facebook.com/ads/library/?id=${id}`),
    pagina: texto(campo(item, "page_name", "pageName", "snapshot.page_name")),
    pagina_id: String(campo(item, "page_id", "pageId", "snapshot.page_id") ?? ""),
    pagina_foto: String(campo(s, "page_profile_picture_url", "pageProfilePictureUrl") ?? ""),
    pagina_url: String(campo(s, "page_profile_uri", "pageProfileUri") ?? ""),
    pagina_seguidores: Number(campo(s, "page_like_count", "pageLikeCount") ?? 0),
    ativo,
    inicio: ini ? ini.toISOString().slice(0, 10) : "",
    fim: !ativo && fimD ? fimD.toISOString().slice(0, 10) : "",
    dias,
    versoes: Number(campo(item, "collation_count", "collationCount") ?? 1) || 1,
    formato: String(campo(s, "display_format", "displayFormat") ?? "").toLowerCase(),
    titulo: texto(campo(s, "title") ?? cards[0]?.titulo),
    texto: texto(campo(s, "body.text", "body.markup.__html", "body") ?? cards[0]?.texto),
    cta: texto(campo(s, "cta_text", "ctaText")),
    destino,
    dominio: dominioDe(destino) || texto(campo(s, "caption")),
    descricao_link: texto(campo(s, "link_description", "linkDescription")),
    plataformas: (item.publisher_platform ?? item.publisherPlatform ?? []).map((p: string) => p.toLowerCase()),
    midias,
    cards,
    termo,
    posicao: Number(item.position ?? 0),
  };
}

/** Destinos que não são página de venda: perfil, loja de apps, TikTok (posts impulsionados, apps, marcas). */
export const NAO_OFERTA = ["instagram.com", "facebook.com", "fb.me", "m.me", "t.me", "apps.apple.com", "itunes.apple.com", "play.google.com", "maps.google", "tiktok.com"];
/** Muito infoproduto low ticket no Brasil vende pela conversa: WhatsApp conta como oferta, a menos que se desligue. */
export const WHATSAPP = ["whatsapp.com", "wa.me"];

export const levaAOferta = (x: AnuncioFB, aceitarWhatsapp = true) =>
  !!x.dominio && !NAO_OFERTA.some((d) => x.dominio.includes(d)) && (aceitarWhatsapp || !WHATSAPP.some((d) => x.dominio.includes(d)));

const GOOGLE_HOSTS = new Set([
  "google.com", "www.google.com", "maps.google.com", "search.google.com",
  "google.com.br", "www.google.com.br", "maps.google.com.br",
  "maps.app.goo.gl", "goo.gl", "g.page", "share.google",
]);
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.page", "share.google"]);
const MAX_HOPS = 5;
const MAX_HTML_BYTES = 262_144;

export class ReviewLinkError extends Error {
  constructor(message: string, public reason?: string) { super(message); this.name = "ReviewLinkError"; }
}
export class GoogleAccessBlocked extends ReviewLinkError {
  constructor() {
    super("O Google não respondeu ao link compartilhado agora. Tente novamente ou cole o endereço completo do estabelecimento no Google Maps.", "GoogleAccessBlocked");
    this.name = "GoogleAccessBlocked";
  }
}
export type ReviewLinkResult = { targetUrl: string; converted: boolean; name?: string };
export type PlateLinkResult = ReviewLinkResult & { destinationKind: "review" };

export function plateTargetMode(value: unknown): "review" {
  if (value === undefined || value === "review") return "review";
  throw new ReviewLinkError("O destino deve ser um link direto de avaliação. Cole o link do estabelecimento no Google Maps para converter.", "InvalidMode");
}

export function savedGoogleDestination(value: unknown): string {
  return safeGoogleUrl(value).href;
}

export async function resolvePlateDestination(value: unknown, mode?: unknown, fetcher: typeof fetch = fetch): Promise<PlateLinkResult> {
  plateTargetMode(mode);
  return { ...await resolveReviewLink(value, fetcher), destinationKind: "review" };
}

function safeGoogleUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048) throw new ReviewLinkError("Informe um link do perfil ou de avaliação no Google.");
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new ReviewLinkError("Cole o link completo do Google, começando com https://."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !GOOGLE_HOSTS.has(url.hostname)) {
    throw new ReviewLinkError("Use um link HTTPS do Google Maps, g.page ou um link direto de avaliação.");
  }
  return url;
}

function placeId(value: string): string | undefined {
  return /^[A-Za-z0-9_-]{10,1024}$/.test(value) && !/^\d+$/.test(value) ? value : undefined;
}

function reviewUrl(id: string) {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
}

function decoded(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function businessName(url: URL): string | undefined {
  const match = url.pathname.match(/\/maps\/place\/([^/]+)/);
  if (!match || match[1] === "data=") return undefined;
  const name = decoded(match[1].replaceAll("+", " ")).trim();
  return name && name.length <= 100 && !name.startsWith("@") ? name : undefined;
}

function featureId(fid: string): string | undefined {
  const match = fid.match(/^0x([a-f0-9]{1,16}):0x([a-f0-9]{1,16})$/i);
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return undefined;
  return fid.toLowerCase();
}

// Standard Maps feature IDs contain the two fixed64 fields of a ChIJ Place ID.
// Encode all 64 bits without Number conversion. Verified against Google's published
// Sydney/SFO pairs and the live businesses in the regression fixtures. This wire
// representation is inferred; never synthesize an ID from a CID alone or a name.
export function featurePlaceId(value: string): string | undefined {
  const fid = featureId(value);
  if (!fid) return undefined;
  const [first, second] = fid.split(":");
  const bytes = new Uint8Array(20);
  bytes.set([0x0a, 0x12, 0x09]);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(3, BigInt(first), true);
  bytes[11] = 0x11;
  view.setBigUint64(12, BigInt(second), true);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function identify(url: URL): { id?: string; fid?: string; name?: string } | undefined {
  const ids = new Set<string>();
  for (const key of ["query_place_id", "place_id", "placeid"]) {
    for (const value of url.searchParams.getAll(key)) {
      const id = placeId(value); if (id) ids.add(id);
    }
  }
  for (const key of ["q", "query"]) {
    for (const value of url.searchParams.getAll(key)) {
      if (value.startsWith("place_id:")) { const id = placeId(value.slice(9)); if (id) ids.add(id); }
    }
  }
  const path = decoded(url.pathname + url.search + url.hash);
  for (const match of path.matchAll(/!1s(ChIJ[A-Za-z0-9_-]{20,})(?=!|[&#/?]|$)/g)) ids.add(match[1]);
  const fids = new Set<string>();
  for (const match of path.matchAll(/(?:!1s|[?&#](?:ftid|fid|lrd)=)(0x[a-f0-9]{1,16}:0x[a-f0-9]{1,16})(?=!|[&#/?,]|$)/gi)) fids.add(match[1].toLowerCase());
  if (fids.size > 1) throw new ReviewLinkError("Este link contém mais de um local. Compartilhe somente o perfil da loja no Google Maps.");
  if (ids.size > 1) throw new ReviewLinkError("Este link contém mais de um estabelecimento. Compartilhe somente o perfil da loja.");
  if (ids.size && fids.size) throw new ReviewLinkError("Este link mistura identificadores de local. Use o link de Compartilhar do perfil da loja no Maps.");
  const id = [...ids][0];
  const fid = fids.size === 1 ? featureId([...fids][0]) : undefined;
  return id || fid ? { ...(id ? { id } : { fid }), name: businessName(url) } : undefined;
}

type Network = { fetcher: typeof fetch; signal: AbortSignal; redirects: number; trace: string; mode: "profile" | "review"; phase: string };
type DiagnosticFields = Record<string, string | number | boolean | undefined>;
export function googleDiagnostic(stage: string, fields: DiagnosticFields = {}) {
  console.info(JSON.stringify({ event: "google_lookup", stage, ...fields }));
}
function diagnostic(network: Network, stage: string, fields: DiagnosticFields = {}) {
  googleDiagnostic(stage, { trace: network.trace, mode: network.mode, phase: network.phase, redirects: network.redirects, ...fields });
}
function safePath(url: URL): string {
  if (SHORT_HOSTS.has(url.hostname)) return "/[short-link]";
  for (const path of ["/maps/preview/place", "/maps/place", "/maps/search", "/local/writereview", "/sorry", "/consent"]) if (url.pathname.startsWith(path)) return path;
  return "/[google-page]";
}
const unresolved = () => new ReviewLinkError("Não encontramos o identificador do estabelecimento nesse endereço. Copie o link de Compartilhar da loja no Google Maps.", "ConversionUnavailable");

function follow(network: Network, from: URL, target: string): URL {
  if (network.redirects >= MAX_HOPS) throw new ReviewLinkError("O link tem muitos redirecionamentos. Copie um novo link do perfil no Google Maps.");
  network.redirects++;
  let absolute: URL;
  try { absolute = new URL(target, from); }
  catch { throw new ReviewLinkError("O Google retornou um endereço inválido. Copie um novo link do perfil.", "UnsafeRedirect"); }
  const url = safeGoogleUrl(absolute.href);
  if (url.pathname === "/sorry" || url.pathname.startsWith("/sorry/")) {
    diagnostic(network, "access_blocked", { reason: "sorry_redirect" }); throw new GoogleAccessBlocked();
  }
  return url;
}

function metadataUrl(url: URL, fid: string): boolean {
  if (!['google.com', 'www.google.com', 'maps.google.com', 'google.com.br', 'www.google.com.br', 'maps.google.com.br'].includes(url.hostname)
    || url.pathname !== "/maps/preview/place") return false;
  const pb = url.searchParams.get("pb") ?? "";
  return [...pb.matchAll(/!1s(0x[a-f0-9]{1,16}:0x[a-f0-9]{1,16})(?=!|$)/gi)]
    .some(match => match[1].toLowerCase() === fid);
}

async function request(network: Network, url: URL) {
  if (url.pathname === "/sorry" || url.pathname.startsWith("/sorry/")) {
    diagnostic(network, "access_blocked", { reason: "sorry_path" }); throw new GoogleAccessBlocked();
  }
  diagnostic(network, "request", { host: url.hostname, path: safePath(url) });
  const fetcher = network.fetcher;
  const response = await fetcher(url.href, { redirect: "manual", signal: network.signal,
    headers: { Accept: "text/html,application/json", "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" } });
  diagnostic(network, "response", { host: url.hostname, path: safePath(url), status: response.status,
    content: (response.headers.get("content-type") ?? "").includes("json") ? "json" : (response.headers.get("content-type") ?? "").includes("html") ? "html" : "other" });
  if (response.status === 429) { await response.body?.cancel(); diagnostic(network, "access_blocked", { reason: "http_429" }); throw new GoogleAccessBlocked(); }
  return response;
}

export type GoogleLinkIdentity = { id?: string; fid?: string; name?: string };
// Official Places needs a real Place ID. Expanding a shared URL never derives one from a FID or CID.
export async function resolveGoogleLinkIdentity(value: unknown, fetcher: typeof fetch = fetch): Promise<GoogleLinkIdentity> {
  let current = safeGoogleUrl(value);
  const controller = new AbortController();
  const network: Network = { fetcher, signal: controller.signal, redirects: 0, trace: crypto.randomUUID().slice(0, 8), mode: "profile", phase: "official_identity" };
  const timer = setTimeout(() => controller.abort(), 8000), seen = new Set<string>();
  try {
    for (;;) {
      if (seen.has(current.href)) throw unresolved();
      seen.add(current.href);
      const identity = identify(current); if (identity) return identity;
      if (!SHORT_HOSTS.has(current.hostname) || network.redirects >= MAX_HOPS) throw unresolved();
      const response = await request(network, current);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location"); if (!location) throw unresolved();
        current = follow(network, current, location);
      } else {
        if (!response.ok) { await response.body?.cancel(); throw unresolved(); }
        const html = await smallHtml(response, network);
        const target = html.match(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i)?.[1]
          ?? html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
        if (!target) throw unresolved();
        current = follow(network, current, target.replaceAll("&amp;", "&"));
      }
    }
  } catch (error) {
    if (error instanceof ReviewLinkError) throw error;
    throw new ReviewLinkError("Não conseguimos identificar o Place ID desse link agora. Cole o link oficial de avaliação.");
  } finally { clearTimeout(timer); }
}

async function load(network: Network, start: URL, fid?: string): Promise<{ url: URL; text: string }> {
  network.phase = fid ? "metadata" : "canonical_html";
  let current = safeGoogleUrl(start.href);
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(current.href) || (fid && !metadataUrl(current, fid))) throw new ReviewLinkError("O link retornou um redirecionamento inesperado. Copie um novo link do Google Maps.", "UnsafeRedirect");
    seen.add(current.href);
    const response = await request(network, current);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw unresolved();
      current = follow(network, current, location);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw unresolved(); }
    return { url: current, text: await smallHtml(response, network) };
  }
}

function associatedPlaceId(text: string, fid: string, network: Network): string {
  let payload: unknown;
  const json = text.replace(/^\uFEFF/, "").trimStart();
  try { payload = JSON.parse(json.startsWith(")]}'") ? json.slice(4).trimStart() : json); }
  catch { diagnostic(network, "metadata_json", { valid: false }); throw unresolved(); }
  const ids = new Set<string>();
  const pending: unknown[] = [payload];
  while (pending.length) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      // Google publishes this identity tuple in the place's own metadata row:
      // [FID, ..., ..., knowledge-graph ID (/g/ or /m/), Place ID]. Never take
      // a ChIJ from another row, nearby place, review, or arbitrary page text.
      if (typeof node[0] === "string" && node[0].toLowerCase() === fid
        && typeof node[3] === "string" && /^\/(?:g|m)\/[A-Za-z0-9_-]+$/.test(node[3])
        && typeof node[4] === "string") {
        const id = placeId(node[4]);
        if (id) ids.add(id);
      }
      for (const child of node) if (child && typeof child === "object") pending.push(child);
    } else if (node && typeof node === "object") {
      for (const child of Object.values(node)) if (child && typeof child === "object") pending.push(child);
    }
  }
  diagnostic(network, "metadata_identity", { idCount: ids.size });
  if (ids.size > 1) throw new ReviewLinkError("Este perfil retornou mais de um estabelecimento. Cole o link direto de avaliação.", "AmbiguousPlace");
  if (!ids.size) throw unresolved();
  return [...ids][0];
}

export type GooglePlaceMetadata = { text: string; fid: string; expectedPlaceId?: string; diagnosticTrace?: string };

// Profiles deliberately use the same allowlist, streaming limits, redirect budget and deadline as link conversion.
// The preview URL is discovered from Google's own page, never synthesized from an undocumented RPC format.
export async function fetchGooglePlaceMetadata(value: unknown, fetcher: typeof fetch = fetch): Promise<GooglePlaceMetadata> {
  let current = safeGoogleUrl(value);
  const visited = new Set<string>();
  const controller = new AbortController();
  const network: Network = { fetcher, signal: controller.signal, redirects: 0, trace: crypto.randomUUID().slice(0, 8), mode: "profile", phase: "short_link" };
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let identity: ReturnType<typeof identify>;
    for (;;) {
      if (visited.has(current.href)) throw unresolved();
      visited.add(current.href);
      identity = identify(current);
      if (identity) break;
      if (!SHORT_HOSTS.has(current.hostname)) throw unresolved();
      const response = await request(network, current);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw unresolved();
        current = follow(network, current, location);
      } else {
        if (!response.ok) { await response.body?.cancel(); throw unresolved(); }
        const html = await smallHtml(response, network);
        const target = html.match(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i)?.[1]
          ?? html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
        if (!target) throw unresolved();
        current = follow(network, current, target.replaceAll("&amp;", "&"));
      }
    }
    const canonical = identity.fid
      ? `https://www.google.com/maps/place//data=!4m2!3m1!1s${identity.fid}`
      : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(identity.id!)}`;
    const page = await load(network, safeGoogleUrl(canonical));
    const candidates = new Map<string, string>();
    for (const match of page.text.matchAll(/<link\b[^>]*>/gi)) {
      const href = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      let url: URL;
      try { url = safeGoogleUrl(new URL(href.replace(/&amp;/gi, "&"), page.url).href); } catch { continue; }
      const fids = new Set([...((url.searchParams.get("pb") ?? "").matchAll(/!1s(0x[a-f0-9]{1,16}:0x[a-f0-9]{1,16})(?=!|$)/gi))]
        .map(item => featureId(item[1])).filter((item): item is string => Boolean(item)));
      if (fids.size !== 1) continue;
      const fid = [...fids][0];
      if ((!identity.fid || identity.fid === fid) && metadataUrl(url, fid)) candidates.set(url.href, fid);
    }
    diagnostic(network, "preload_candidates", { candidateCount: candidates.size, hasInit: page.text.includes("APP_INITIALIZATION_STATE") });
    if (candidates.size !== 1) throw unresolved();
    const [url, fid] = [...candidates][0];
    const metadata = await load(network, safeGoogleUrl(url), fid);
    const id = associatedPlaceId(metadata.text, fid, network);
    if (identity.id && identity.id !== id) { diagnostic(network, "requested_identity", { matches: false }); throw unresolved(); }
    diagnostic(network, "metadata_ready", { valid: true });
    return { text: metadata.text, fid, diagnosticTrace: network.trace, ...(identity.id ? { expectedPlaceId: identity.id } : {}) };
  } catch (error) {
    diagnostic(network, "failed", { errorKind: error instanceof Error ? error.name : "unknown" });
    if (error instanceof ReviewLinkError) throw error;
    throw new ReviewLinkError("O Google não respondeu aos dados do perfil agora. Tente novamente ou preencha a ficha manualmente.");
  } finally { clearTimeout(timer); }
}

async function smallHtml(response: Response, network: Network): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) { diagnostic(network, "body_limit", { bytes: size }); await reader.cancel(); throw new ReviewLinkError("Não conseguimos identificar esse perfil. Cole o link de avaliação fornecido pelo Google."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  diagnostic(network, "body", { bytes: size, hasInit: text.includes("APP_INITIALIZATION_STATE"), hasPreload: /\/maps\/preview\/place\?/.test(text),
    challenge: /unusual traffic|our systems have detected|automated queries|<form[^>]+action=["'][^"']*\/sorry/i.test(text),
    consent: /before you continue to Google|Antes de continuar no Google/i.test(text) });
  return text;
}

export async function resolveReviewLink(value: unknown, fetcher: typeof fetch = fetch): Promise<ReviewLinkResult> {
  let current = safeGoogleUrl(value);
  const original = current.href;
  const visited = new Set<string>();
  const controller = new AbortController();
  const network: Network = { fetcher, signal: controller.signal, redirects: 0, trace: crypto.randomUUID().slice(0, 8), mode: "review", phase: "short_link" };
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    for (;;) {
      if (visited.has(current.href)) throw new ReviewLinkError("O link do Google está repetindo redirecionamentos. Cole outro link do perfil.");
      visited.add(current.href);
      if (current.hostname === "g.page" && /^\/(?:r\/)?[^/]+\/review\/?$/.test(current.pathname)) {
        return { targetUrl: current.href, converted: current.href !== original };
      }
      const identified = identify(current);
      if (identified) {
        const id = identified.id ?? featurePlaceId(identified.fid!);
        if (!id) throw unresolved();
        const targetUrl = reviewUrl(id);
        return { targetUrl, converted: targetUrl !== original, ...(identified.name ? { name: identified.name } : {}) };
      }
      if (!SHORT_HOSTS.has(current.hostname)) break;
      if (network.redirects === MAX_HOPS) throw new ReviewLinkError("O link tem muitos redirecionamentos. Copie um novo link do perfil no Google Maps.");
      const response = await request(network, current);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) break;
        current = follow(network, current, location);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); break; }
      const html = await smallHtml(response, network);
      const target = html.match(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i)?.[1]
        ?? html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
      if (!target) break;
      current = follow(network, current, target.replaceAll("&amp;", "&"));
    }
    throw unresolved();
  } catch (error) {
    diagnostic(network, "failed", { errorKind: error instanceof Error ? error.name : "unknown" });
    if (error instanceof ReviewLinkError) throw error;
    throw new ReviewLinkError("Não foi possível abrir o link compartilhado agora. Tente novamente ou cole o endereço completo do estabelecimento no Google Maps.", "ConversionUnavailable");
  } finally { clearTimeout(timer); }
}

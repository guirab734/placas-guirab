import catalog from "./data/aracaju-neighborhoods.json";
import localities from "./data/ibge-localities.json";

export type MapPoint = [number, number];
export type RegionGeometry = { type: "Polygon"; coordinates: MapPoint[][] } | { type: "MultiPolygon"; coordinates: MapPoint[][][] };
export type MapRegion = {
  id: string; name: string; label: string; bbox: [number, number, number, number];
  geometry: RegionGeometry | null; source: "Prefeitura de Aracaju" | "OpenStreetMap" | "IBGE"; sourceUrl: string;
  kind?: "state" | "city" | "neighborhood";
};
export type MapStreet = { id: string; name: string; geometry: { type: "LineString"; coordinates: MapPoint[] } };
export class MapDataError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

const PHOTON = "https://photon.komoot.io/api/";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const MUNICIPAL_WFS = "https://geoserver.fazenda.aracaju.se.gov.br/ows";
const MAX_STREETS = 2500, MAX_COORDINATES = 60_000;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const statesByName = new Map(localities.states.map(state => [normalize(state.name), state]));
const citiesByName = new Map(localities.cities.map(city => [`${normalize(city.name)}|${city.stateId}`, city]));
const clean = (value: unknown, max = 180) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "";
const point = (value: unknown): value is MapPoint => Array.isArray(value) && value.length >= 2 &&
  typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 85;
const same = (a: MapPoint, b: MapPoint) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const polygons = (geometry: RegionGeometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

export function geometryBbox(geometry: RegionGeometry): MapRegion["bbox"] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const polygon of polygons(geometry)) for (const ring of polygon) for (const p of ring) {
    if (!point(p)) throw new MapDataError("O limite recebido tem coordenadas inválidas.");
    west = Math.min(west, p[0]); south = Math.min(south, p[1]); east = Math.max(east, p[0]); north = Math.max(north, p[1]);
  }
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) throw new MapDataError("O limite recebido está incompleto.");
  return [west, south, east, north];
}

// Snapshot from the municipality's public WFS, not hand-drawn or inferred from a center point.
export const aracajuRegions: MapRegion[] = catalog.features.map((feature): MapRegion => {
  const geometry = feature.geometry as unknown as RegionGeometry;
  return { id: `aracaju:${feature.id}`, name: feature.properties.bairro, label: `${feature.properties.bairro} · Aracaju, SE`,
    bbox: geometryBbox(geometry), geometry, source: "Prefeitura de Aracaju", sourceUrl: catalog.sourceUrl, kind: "neighborhood" };
}).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
const localById = new Map(aracajuRegions.map(region => [region.id, region]));
const cityView: MapRegion = {
  id: "aracaju:municipio", name: "Aracaju", label: "Aracaju · SE · Todos os bairros",
  bbox: [Math.min(...aracajuRegions.map(r => r.bbox[0])), Math.min(...aracajuRegions.map(r => r.bbox[1])),
    Math.max(...aracajuRegions.map(r => r.bbox[2])), Math.max(...aracajuRegions.map(r => r.bbox[3]))],
  geometry: null, source: "Prefeitura de Aracaju", sourceUrl: catalog.sourceUrl,
  kind: "city",
};
localById.set(cityView.id, cityView);

export function regionQuery(value: unknown): string {
  if (typeof value !== "string" || value.length > 120 || /[\u0000-\u001f]/.test(value)) throw new MapDataError("Informe um bairro, cidade ou estado com até 120 caracteres.", 400);
  return value.trim();
}
export function localRegions(query: string): MapRegion[] | null {
  const normalized = normalize(query);
  const stop = new Set(["bairro", "bairros", "de", "da", "do", "em", "aracaju", "sergipe", "se", "brasil"]);
  const terms = normalized.split(" ").filter(term => term && !stop.has(term));
  if (!normalized || (!terms.length && normalized.includes("aracaju"))) return [cityView, ...aracajuRegions];
  const matches = aracajuRegions.filter(region => terms.length > 0 && terms.every(term => normalize(region.name).includes(term)));
  return matches.length || normalized.includes("aracaju") ? matches : null;
}

type Network = { fetcher: typeof fetch; signal: AbortSignal };
async function limitedJson(network: Network, url: URL | string, cap: number, body?: string): Promise<unknown> {
  const fetcher = network.fetcher;
  const response = await fetcher(String(url), { method: body ? "POST" : "GET", redirect: "manual", signal: network.signal,
    headers: { Accept: "application/json", "Accept-Language": "pt-BR,pt;q=0.9", "User-Agent": "GuirabPlaquinhas/1.0 (+https://placas.guirab.com.br)",
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(body ? { body } : {}) });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new MapDataError("A fonte do mapa não respondeu agora. Tente novamente em instantes.", 503); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > cap) { await reader.cancel(); throw new MapDataError("A área tem dados demais. Escolha um bairro menor.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new MapDataError("A fonte do mapa retornou dados incompletos. Tente novamente.", 503); }
}
async function withNetwork<T>(fetcher: typeof fetch, action: (network: Network) => Promise<T>, timeout = 15_000): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try { return await action({ fetcher, signal: controller.signal }); }
  catch (error) {
    if (error instanceof MapDataError) throw error;
    console.error(JSON.stringify({ event: "map_external_failed", message: (error instanceof Error ? error.message : "Unknown error").replace(/https?:\/\/\S+/g, "[endpoint]").slice(0, 300) }));
    throw new MapDataError("A consulta do mapa demorou demais ou ficou indisponível. Tente novamente.", 503);
  } finally { clearTimeout(timer); }
}

export function photonRegions(value: unknown): MapRegion[] {
  const features = value && typeof value === "object" ? (value as { features?: unknown }).features : undefined;
  if (!Array.isArray(features)) throw new MapDataError("A busca de regiões retornou dados inválidos.", 503);
  const result: MapRegion[] = [];
  for (const feature of features.slice(0, 10)) {
    const p = feature?.properties;
    if (!p || typeof p !== "object" || !["state", "city", "county", "district", "locality"].includes(p.type) ||
      !point(feature.geometry?.coordinates) || !["N", "W", "R"].includes(p.osm_type) || !Number.isSafeInteger(p.osm_id) || p.osm_id <= 0) continue;
    const name = clean(p.name); if (!name) continue;
    const [lon, lat] = feature.geometry.coordinates;
    let bbox: MapRegion["bbox"] = [lon, lat, lon, lat];
    if (Array.isArray(p.extent) && p.extent.length === 4 && p.extent.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) &&
      Math.abs(p.extent[0]) <= 180 && Math.abs(p.extent[2]) <= 180 && Math.abs(p.extent[1]) <= 85 && Math.abs(p.extent[3]) <= 85) {
      bbox = [Math.min(p.extent[0], p.extent[2]), Math.min(p.extent[1], p.extent[3]), Math.max(p.extent[0], p.extent[2]), Math.max(p.extent[1], p.extent[3])];
    }
    const state = statesByName.get(normalize(p.type === "state" ? name : clean(p.state)));
    const city = p.type === "city" && state ? citiesByName.get(`${normalize(name)}|${state.id}`) : undefined;
    const official = p.type === "state" && state ? { kind: "state" as const, id: state.id } : city ? { kind: "city" as const, id: city.id } : null;
    const officialName = official?.kind === "state" ? state!.name : official?.kind === "city" ? city!.name : name;
    const label = official?.kind === "state" ? `${officialName} · Estado · Brasil` : official?.kind === "city" ? `${officialName} · Município · ${city!.state}`
      : [...new Set([name, p.type === "state" ? "Estado" : p.type === "city" ? "Município" : p.type === "county" ? "Região" : "Bairro/localidade", clean(p.city), clean(p.state)].filter(Boolean))].join(" · ");
    result.push({ id: official ? `ibge:${official.kind}:${official.id}` : `osm:${p.osm_type}:${p.osm_id}`, name: officialName,
      label, bbox, geometry: null,
      source: official ? "IBGE" : "OpenStreetMap", sourceUrl: official ? (official.kind === "state" ? localities.stateSource : localities.citySource) : `https://www.openstreetmap.org/${p.osm_type === "R" ? "relation" : p.osm_type === "W" ? "way" : "node"}/${p.osm_id}`,
      kind: p.type === "state" ? "state" : ["city", "county"].includes(p.type) ? "city" : "neighborhood" });
  }
  return result;
}
export async function searchRegions(value: unknown, fetcher: typeof fetch = fetch): Promise<MapRegion[]> {
  const query = regionQuery(value), local = localRegions(query);
  if (local !== null) return local;
  const url = new URL(PHOTON); url.searchParams.set("q", query); url.searchParams.set("limit", "8"); url.searchParams.set("countrycode", "BR");
  for (const layer of ["district", "locality", "city", "county", "state"]) url.searchParams.append("layer", layer);
  return withNetwork(fetcher, async network => photonRegions(await limitedJson(network, url, 131_072)), 8000);
}

function inRing(p: MapPoint, ring: MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) < 1e-13 && p[0] >= Math.min(a[0], b[0]) - 1e-10 && p[0] <= Math.max(a[0], b[0]) + 1e-10 &&
      p[1] >= Math.min(a[1], b[1]) - 1e-10 && p[1] <= Math.max(a[1], b[1]) + 1e-10) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function pointInRegion(p: MapPoint, geometry: RegionGeometry): boolean {
  return polygons(geometry).some(polygon => polygon.length > 0 && inRing(p, polygon[0]) && !polygon.slice(1).some(hole => inRing(p, hole)));
}
const interpolate = (a: MapPoint, b: MapPoint, t: number): MapPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function clipStreet(points: MapPoint[], geometry: RegionGeometry): MapPoint[][] {
  const rings = polygons(geometry).flat(), parts: MapPoint[][] = []; let current: MapPoint[] = [];
  const finish = () => { if (current.length >= 2) parts.push(current); current = []; };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]; if (same(a, b)) continue;
    const cuts = [0, 1], dx = b[0] - a[0], dy = b[1] - a[1];
    for (const ring of rings) for (let j = 1; j < ring.length; j++) {
      const c = ring[j - 1], d = ring[j], ex = d[0] - c[0], ey = d[1] - c[1];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-15) continue;
      const cx = c[0] - a[0], cy = c[1] - a[1], t = (cx * ey - cy * ex) / denominator, u = (cx * dy - cy * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    const ordered = [...new Set(cuts)].sort((x, y) => x - y);
    for (let k = 1; k < ordered.length; k++) {
      const from = ordered[k - 1], to = ordered[k]; if (to - from < 1e-10) continue;
      if (!pointInRegion(interpolate(a, b, (from + to) / 2), geometry)) { finish(); continue; }
      const start = interpolate(a, b, from), end = interpolate(a, b, to);
      if (current.length && !same(current[current.length - 1], start)) finish();
      if (!current.length) current.push(start);
      current.push(end);
    }
  }
  finish(); return parts;
}

function assembledRings(lines: MapPoint[][]): MapPoint[][] {
  const pending = lines.map(line => line.slice()), rings: MapPoint[][] = [];
  while (pending.length) {
    const line = pending.pop()!;
    while (!same(line[0], line[line.length - 1])) {
      const end = line[line.length - 1];
      const index = pending.findIndex(part => same(part[0], end) || same(part[part.length - 1], end));
      if (index < 0) throw new MapDataError("O OpenStreetMap não forneceu um contorno fechado para essa região.");
      const next = pending.splice(index, 1)[0]; if (!same(next[0], end)) next.reverse();
      line.push(...next.slice(1));
    }
    if (line.length < 4) throw new MapDataError("O contorno dessa região está incompleto.");
    rings.push(line);
  }
  return rings;
}
async function resolveRegion(input: unknown, network: Network): Promise<MapRegion> {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || id.length > 80) throw new MapDataError("Selecione um bairro válido.", 400);
  if (id === cityView.id) return ibgeBoundary("city", "2800308", network);
  const ibge = id.match(/^ibge:(state|city):([0-9]+)$/);
  if (ibge && (ibge[1] === "state" ? /^[1-5][0-9]$/.test(ibge[2]) : /^[1-5][0-9]{6}$/.test(ibge[2]))) return ibgeBoundary(ibge[1] as "state" | "city", ibge[2], network);
  const local = localById.get(id); if (local) return local;
  const match = id.match(/^osm:R:([1-9][0-9]{0,11})$/);
  if (!match) throw new MapDataError("Esse resultado só identifica um ponto. Selecione uma região com limites disponíveis.");
  const payload = await limitedJson(network, OVERPASS, 1_048_576,
    new URLSearchParams({ data: `[out:json][timeout:10][maxsize:16777216];relation(${match[1]});out tags geom;` }).toString()) as { elements?: unknown[]; remark?: string };
  const row = payload.elements?.find((item: any) => item.type === "relation" && String(item.id) === match[1]) as any;
  if (!row || !["boundary", "multipolygon"].includes(row.tags?.type) || !Array.isArray(row.members)) throw new MapDataError("Não há limite de área confirmado para esse resultado.");
  const outer: MapPoint[][] = [], inner: MapPoint[][] = []; let count = 0;
  for (const member of row.members) if (member.type === "way" && ["outer", "inner", ""].includes(member.role) && Array.isArray(member.geometry)) {
    const line = member.geometry.map((p: any) => [p?.lon, p?.lat]);
    count += line.length;
    if (count > 10_000 || line.length < 2 || !line.every(point)) throw new MapDataError("O limite dessa região é grande demais ou está incompleto.", 413);
    (member.role === "inner" ? inner : outer).push(line);
  }
  const shapes = assembledRings(outer).map(ring => [ring]);
  if (!shapes.length) throw new MapDataError("Não há polígono disponível para esse resultado.");
  for (const hole of assembledRings(inner)) {
    const shape = shapes.find(polygon => inRing(hole[0], polygon[0]));
    if (!shape) throw new MapDataError("O limite dessa região está incompleto.");
    shape.push(hole);
  }
  const geometry: RegionGeometry = { type: "MultiPolygon", coordinates: shapes };
  const name = clean(row.tags.name) || "Região OpenStreetMap";
  return { id, name, label: name, geometry, bbox: geometryBbox(geometry), source: "OpenStreetMap", sourceUrl: `https://www.openstreetmap.org/relation/${match[1]}` };
}

async function ibgeBoundary(kind: "state" | "city", code: string, network: Network): Promise<MapRegion> {
  const field = kind === "state" ? "cd_uf" : "cd_mun", nameField = kind === "state" ? "nm_uf" : "nm_mun";
  const url = new URL("https://geoservicos.ibge.gov.br/geoserver/ows");
  for (const [key, value] of Object.entries({ service: "WFS", version: "1.0.0", request: "GetFeature",
    typeName: kind === "state" ? "CGMAT:qg_2025_020_uf_agreg" : "CGMAT:qg_2025_030_munic", outputFormat: "application/json",
    srsName: "EPSG:4326", maxFeatures: "2", CQL_FILTER: `${field}='${code}'` })) url.searchParams.set(key, value);
  const payload = await limitedJson(network, url, 6_291_456) as any;
  if (!Array.isArray(payload.features) || payload.features.length !== 1 || String(payload.features[0].properties?.[field]) !== code) throw new MapDataError("O IBGE não confirmou um limite único para essa localidade.");
  const feature = payload.features[0], name = clean(feature.properties[nameField]);
  if (!name || !["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) throw new MapDataError("O IBGE não forneceu um polígono para essa localidade.");
  const geometry = feature.geometry as RegionGeometry;
  const bbox = geometryBbox(geometry);
  for (const polygon of polygons(geometry)) for (const ring of polygon) if (ring.length < 4 || !same(ring[0], ring[ring.length - 1])) throw new MapDataError("O limite do IBGE está incompleto.");
  return { id: kind === "city" && code === "2800308" ? cityView.id : `ibge:${kind}:${code}`, name, label: `${name} · ${kind === "state" ? "Estado" : "Município"} · IBGE`,
    bbox, geometry, source: "IBGE", sourceUrl: url.href, kind };
}

export async function regionBoundary(input: unknown, fetcher: typeof fetch = fetch): Promise<MapRegion> {
  return withNetwork(fetcher, network => resolveRegion(input, network));
}

export async function regionStreets(input: unknown, fetcher: typeof fetch = fetch): Promise<{ streets: MapStreet[]; truncated: boolean; source: MapRegion["source"] }> {
  return withNetwork(fetcher, async network => {
    // Client bbox/geometry/name are intentionally ignored; trusted local ID or OSM relation is resolved on the server.
    const region = await resolveRegion(input, network), [west, south, east, north] = region.bbox;
    const squareKm = (east - west) * (north - south) * 111.32 ** 2 * Math.cos((south + north) / 2 * Math.PI / 180);
    if (!region.geometry || squareKm > 120 || east - west > 0.5 || north - south > 0.5) throw new MapDataError("Escolha um bairro para carregar as ruas. Cidades e estados servem para localizar a área.", 413);
    const lines: Array<{ id: string; name: string; points: MapPoint[] }> = []; let truncated = false;
    if (region.source === "Prefeitura de Aracaju") {
      const url = new URL(MUNICIPAL_WFS);
      for (const [key, value] of Object.entries({ service: "WFS", version: "1.0.0", request: "GetFeature", typeName: "Transporte_e_Mobilidade:cif_trecho_logradouro_l",
        outputFormat: "application/json", srsName: "EPSG:4326", maxFeatures: "6000", bbox: `${west},${south},${east},${north},EPSG:4326` })) url.searchParams.set(key, value);
      const payload = await limitedJson(network, url, 4_194_304) as any;
      if (!Array.isArray(payload.features)) throw new MapDataError("A Prefeitura não retornou os trechos de ruas agora.", 503);
      truncated = typeof payload.totalFeatures === "number" && payload.totalFeatures > payload.features.length;
      for (const feature of payload.features.slice(0, 6000)) {
        const parts = feature.geometry?.type === "MultiLineString" ? feature.geometry.coordinates : feature.geometry?.type === "LineString" ? [feature.geometry.coordinates] : [];
        if (!Array.isArray(parts)) continue;
        const name = clean(feature.properties?.nome, 160) || "Logradouro sem nome";
        for (let i = 0; i < parts.length; i++) if (Array.isArray(parts[i]) && parts[i].length >= 2 && parts[i].length <= 2000 && parts[i].every(point)) {
          lines.push({ id: `pma:${clean(feature.id, 100)}:${i}`, name, points: parts[i].map((p: number[]) => [p[0], p[1]]) });
        }
      }
    } else {
      const payload = await limitedJson(network, OVERPASS, 4_194_304, new URLSearchParams({ data: `[out:json][timeout:10][maxsize:16777216];way["highway"~"^(residential|living_street|primary|secondary|tertiary|unclassified|pedestrian|primary_link|secondary_link|tertiary_link)$"](${south},${west},${north},${east});out tags geom;` }).toString()) as any;
      if (!Array.isArray(payload.elements) || payload.remark) throw new MapDataError("O OpenStreetMap não retornou todas as ruas agora. Tente novamente.", 503);
      for (const way of payload.elements.slice(0, 6000)) if (way.type === "way" && Number.isSafeInteger(way.id) && Array.isArray(way.geometry) && way.geometry.length >= 2 && way.geometry.length <= 2000) {
        const points = way.geometry.map((p: any) => [p?.lon, p?.lat]);
        if (points.every(point)) lines.push({ id: `osm:way:${way.id}`, name: clean(way.tags?.name, 160) || "Rua sem nome", points });
      }
      truncated = payload.elements.length > 6000;
    }
    const streets: MapStreet[] = []; let coordinates = 0;
    outer: for (const line of lines) {
      const parts = clipStreet(line.points, region.geometry);
      for (let i = 0; i < parts.length; i++) {
        const rounded = parts[i].map(p => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))] as MapPoint)
          .filter((p, index, all) => index === 0 || !same(p, all[index - 1]));
        if (rounded.length < 2) continue;
        if (streets.length >= MAX_STREETS || coordinates + rounded.length > MAX_COORDINATES) { truncated = true; break outer; }
        coordinates += rounded.length;
        streets.push({ id: `${line.id}:${i}`, name: line.name, geometry: { type: "LineString", coordinates: rounded } });
      }
    }
    return { streets, truncated, source: region.source };
  });
}

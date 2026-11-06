import { ApiError } from "./api";
import type { Visit, VisitGeometry } from "./types";

const STATUSES = new Set<Visit["status"]>(["visited", "return", "sold", "not_interested"]);

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new ApiError(`Informe ${label}${required ? " válido" : ""}, com até ${max} caracteres.`);
  }
  return value.trim();
}

function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError("Informe uma data válida para a visita.");
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value || value < "2000-01-01" || value > "2100-12-31") {
    throw new ApiError("Informe uma data válida para a visita.");
  }
  return value;
}

function coordinate(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(item => typeof item === "number" && Number.isFinite(item))
    || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 85) throw new ApiError("Marque uma localização válida no mapa.");
  return [Number(value[0].toFixed(6)), Number(value[1].toFixed(6))];
}

export function visitGeometry(value: unknown): VisitGeometry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Marque um ponto ou desenhe no mapa.");
  const item = value as Record<string, unknown>;
  if (item.type === "Brush") {
    if (!Array.isArray(item.strokes) || !item.strokes.length || item.strokes.length > 80) throw new ApiError("A pintura deve ter de 1 a 80 traços.");
    let count = 0;
    const strokes = item.strokes.map<Extract<VisitGeometry, { type: "Brush" }>["strokes"][number]>((stroke: unknown) => {
      if (!stroke || typeof stroke !== "object") throw new ApiError("Traço de pintura inválido.");
      const s = stroke as Record<string, unknown>;
      if (!Array.isArray(s.points) || !s.points.length || (count += s.points.length) > 3000) throw new ApiError("A pintura comporta até 3.000 pontos. Salve esta área e comece outra.");
      if (typeof s.radiusMeters !== "number" || !Number.isFinite(s.radiusMeters) || s.radiusMeters < 0.2 || s.radiusMeters > 500
        || (s.mode !== "paint" && s.mode !== "erase")) throw new ApiError("Tamanho ou modo do pincel inválido.");
      return { points: s.points.map(coordinate), radiusMeters: Number(s.radiusMeters.toFixed(3)), mode: s.mode };
    });
    if (!strokes.some(s => s.mode === "paint")) throw new ApiError("Pinte pelo menos uma área antes de confirmar.");
    return { type: "Brush", strokes };
  }
  if (item.type === "Streets") {
    if (!Array.isArray(item.streets) || !item.streets.length || item.streets.length > 80) throw new ApiError("Selecione de 1 a 80 trechos de rua por registro.");
    let count = 0;
    const seen = new Set<string>();
    const streets = item.streets.map((value: unknown) => {
      if (!value || typeof value !== "object") throw new ApiError("Rua inválida.");
      const s = value as Record<string, unknown>;
      const id = text(s.id, "o código da rua", 80, true);
      if (seen.has(id)) throw new ApiError("Uma rua não pode aparecer duas vezes no mesmo registro.");
      seen.add(id);
      if (!Array.isArray(s.coordinates) || s.coordinates.length < 2 || (count += s.coordinates.length) > 3000) throw new ApiError("As ruas selecionadas comportam até 3.000 pontos por registro.");
      const points = s.coordinates.map(coordinate);
      if (new Set(points.map(point => point.join(","))).size < 2) throw new ApiError("O trecho de rua precisa ter extensão no mapa.");
      return { id, name: text(s.name, "o nome da rua", 200), coordinates: points };
    });
    return { type: "Streets", streets };
  }
  if (item.type === "Point") return { type: "Point", coordinates: coordinate(item.coordinates) };
  if (item.type === "LineString") {
    if (!Array.isArray(item.coordinates) || item.coordinates.length < 2 || item.coordinates.length > 100) throw new ApiError("O trajeto deve ter de 2 a 100 pontos.");
    const points = item.coordinates.map(coordinate);
    if (new Set(points.map(point => point.join(","))).size < 2) throw new ApiError("Marque pelo menos dois pontos diferentes no trajeto.");
    return { type: "LineString", coordinates: points };
  }
  if (item.type === "Polygon") {
    if (!Array.isArray(item.coordinates) || item.coordinates.length !== 1 || !Array.isArray(item.coordinates[0])) throw new ApiError("Desenhe uma única área no mapa.");
    const ring = item.coordinates[0].map(coordinate);
    if (ring.length < 4 || ring.length > 101 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]
      || new Set(ring.map(point => point.join(","))).size < 3) throw new ApiError("A área precisa ser fechada e ter de 3 a 100 pontos diferentes.");
    const area = ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
    if (Math.abs(area) < 1e-12) throw new ApiError("Desenhe uma área com largura e altura no mapa.");
    return { type: "Polygon", coordinates: [ring] };
  }
  throw new ApiError("Marque uma loja, pinte uma área ou selecione ruas no mapa.");
}

export function visitValues(body: Record<string, unknown>, create = false) {
  const patch: Partial<Pick<Visit, "title" | "geometry" | "status" | "visitedAt" | "notes" | "address" | "archived">> = {};
  if (create || "title" in body) patch.title = text(body.title, "um nome para a visita", 100, true);
  if (create || "geometry" in body) patch.geometry = visitGeometry(body.geometry);
  if (create || "status" in body) {
    if (typeof body.status !== "string" || !STATUSES.has(body.status as Visit["status"])) throw new ApiError("Escolha um status válido para a visita.");
    patch.status = body.status as Visit["status"];
  }
  if (create || "visitedAt" in body) patch.visitedAt = day(body.visitedAt);
  if (create || "notes" in body) patch.notes = text(body.notes ?? "", "as observações", 2000);
  if (create || "address" in body) patch.address = text(body.address ?? "", "o endereço", 300);
  if ("archived" in body) {
    if (typeof body.archived !== "boolean") throw new ApiError("Informe se a visita está arquivada.");
    patch.archived = body.archived;
  }
  if (!Object.keys(patch).length) throw new ApiError("Informe uma alteração para salvar a visita.");
  return patch;
}

export function publicVisit(row: { id: string; title: string; geometry: VisitGeometry; status: Visit["status"]; visitedAt: string; notes: string; address: string; archived: boolean | number; createdAt: string; updatedAt: string }): Visit {
  return { id: row.id, title: row.title, geometry: visitGeometry(row.geometry), status: row.status,
    visitedAt: row.visitedAt, notes: row.notes, address: row.address, archived: Boolean(row.archived), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

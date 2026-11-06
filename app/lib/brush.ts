export type BrushCoordinate = [number, number];
export type BrushStroke = { points: BrushCoordinate[]; radiusMeters: number; mode: "paint" | "erase" };
export type BrushGeometry = { type: "Brush"; strokes: BrushStroke[] };
export type BrushHistory = { strokes: BrushStroke[]; past: BrushStroke[][]; future: BrushStroke[][] };

export const MAX_BRUSH_POINTS = 3000;
export const MAX_BRUSH_STROKES = 80;
export const MIN_BRUSH_RADIUS_METERS = 0.2;
export const MAX_BRUSH_RADIUS_METERS = 500;
const EARTH_RADIUS = 6378137;
const RAD = Math.PI / 180;

export function metersPerPixel(latitude: number, zoom: number): number {
  return Math.cos(Math.max(-85, Math.min(85, latitude)) * RAD) * 2 * Math.PI * EARTH_RADIUS / (256 * 2 ** zoom);
}

export function radiusInMeters(pixelRadius: number, latitude: number, zoom: number): number {
  return Math.max(MIN_BRUSH_RADIUS_METERS, Math.min(MAX_BRUSH_RADIUS_METERS, pixelRadius * metersPerPixel(latitude, zoom)));
}

export function brushPointCount(strokes: BrushStroke[]): number {
  return strokes.reduce((count, stroke) => count + stroke.points.length, 0);
}

export function emptyBrushHistory(strokes: BrushStroke[] = []): BrushHistory {
  return { strokes, past: [], future: [] };
}

export function commitBrush(history: BrushHistory, strokes: BrushStroke[]): BrushHistory {
  return { strokes, past: [...history.past, history.strokes].slice(-MAX_BRUSH_STROKES), future: [] };
}

export function undoBrush(history: BrushHistory): BrushHistory {
  if (!history.past.length) return history;
  return { strokes: history.past[history.past.length - 1], past: history.past.slice(0, -1), future: [history.strokes, ...history.future] };
}

export function redoBrush(history: BrushHistory): BrushHistory {
  if (!history.future.length) return history;
  return { strokes: history.future[0], past: [...history.past, history.strokes], future: history.future.slice(1) };
}

export function brushCoordinates(strokes: BrushStroke[], includeRadius = false): BrushCoordinate[] {
  return strokes.flatMap(stroke => stroke.points.flatMap(point => {
    if (!includeRadius) return [point];
    const latitudeDelta = stroke.radiusMeters / EARTH_RADIUS / RAD;
    const longitudeDelta = latitudeDelta / Math.cos(point[1] * RAD);
    return [
      [Math.max(-180, point[0] - longitudeDelta), Math.max(-85, point[1] - latitudeDelta)] as BrushCoordinate,
      [Math.min(180, point[0] + longitudeDelta), Math.min(85, point[1] + latitudeDelta)] as BrushCoordinate,
    ];
  }));
}

function mercator([longitude, latitude]: BrushCoordinate): BrushCoordinate {
  return [EARTH_RADIUS * longitude * RAD, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, latitude)) * RAD / 2))];
}

function distanceSquaredToSegment(point: BrushCoordinate, start: BrushCoordinate, end: BrushCoordinate): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const ratio = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0;
  return (point[0] - start[0] - ratio * dx) ** 2 + (point[1] - start[1] - ratio * dy) ** 2;
}

export function brushContains(strokes: BrushStroke[], coordinate: BrushCoordinate): boolean {
  const projected = mercator(coordinate);
  let painted = false;
  for (const stroke of strokes) {
    const radius = stroke.radiusMeters / Math.cos(coordinate[1] * RAD);
    let hits = false;
    for (let index = 0; index < stroke.points.length; index++) {
      const start = mercator(stroke.points[Math.max(0, index - 1)]);
      const end = mercator(stroke.points[index]);
      if (distanceSquaredToSegment(projected, start, end) <= radius * radius) { hits = true; break; }
    }
    if (hits) painted = stroke.mode === "paint";
  }
  return painted;
}

/** Render one record on its own cleared canvas; merge records only after erasing. */
export function drawBrushRecord(
  context: CanvasRenderingContext2D,
  strokes: BrushStroke[],
  color: string,
  zoom: number,
  project: (coordinate: BrushCoordinate) => { x: number; y: number },
) {
  context.save();
  context.globalAlpha = 1;
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    let previous: { x: number; y: number; latitude: number } | null = null;
    for (const coordinate of stroke.points) {
      const point = project(coordinate);
      const radius = stroke.radiusMeters / metersPerPixel(coordinate[1], zoom);
      if (previous) {
        context.beginPath();
        context.lineWidth = 2 * stroke.radiusMeters / metersPerPixel((coordinate[1] + previous.latitude) / 2, zoom);
        context.moveTo(previous.x, previous.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      }
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, 2 * Math.PI);
      context.fill();
      previous = { ...point, latitude: coordinate[1] };
    }
  }
  context.restore();
}

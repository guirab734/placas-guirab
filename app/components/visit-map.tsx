"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, Eraser, Focus, LocateFixed, LockKeyhole, LoaderCircle, MapPin, Navigation, Paintbrush, Pencil, Plus, QrCode, Redo2, RotateCcw, Route, Search, Shapes, Trash2, Undo2, X } from "lucide-react";
import type * as Leaflet from "leaflet";
import type { Loja, Visit, VisitGeometry } from "../lib/types";
import { hasPlateLocation, plateLocationLabel } from "../lib/plate-location";
import type { MapRegion, MapStreet } from "../lib/map-regions";
import { brushContains, brushCoordinates, brushPointCount, commitBrush, drawBrushRecord, emptyBrushHistory, MAX_BRUSH_POINTS, MAX_BRUSH_STROKES, metersPerPixel, radiusInMeters, redoBrush, undoBrush, type BrushHistory, type BrushStroke } from "../lib/brush";
import "leaflet/dist/leaflet.css";
import "../visit-map.css";
import "../fieldwork-next.css";

type Coordinate = [number, number];
type GeometryKind = VisitGeometry["type"];
type VisitStatus = Visit["status"];
type LocatedPlate = Loja & { latitude: number; longitude: number };
type VisitMapProps = { lojas?: Loja[]; focusPlateId?: string | null; onOpenPlate?: (id: string) => void };
type VisitDraft = {
  id?: string;
  title: string;
  geometry: VisitGeometry;
  status: VisitStatus;
  visitedAt: string;
  notes: string;
  address: string;
};

const ARACAJU: Leaflet.LatLngTuple = [-10.9472, -37.0731];
const EMPTY_PLATES: Loja[] = [];
const PAGE_SIZE = 12;
const STATUS: Record<VisitStatus, { label: string; plural: string; color: string; className: string }> = {
  visited: { label: "Visitado", plural: "Visitados", color: "#1a73e8", className: "visited" },
  return: { label: "Voltar depois", plural: "Voltar depois", color: "#b77900", className: "return" },
  sold: { label: "Vendido", plural: "Vendas", color: "#188038", className: "sold" },
  not_interested: { label: "Sem interesse", plural: "Sem interesse", color: "#c53929", className: "not-interested" },
};
const STATUS_KEYS = Object.keys(STATUS) as VisitStatus[];
const GEOMETRY_LABEL: Record<GeometryKind, string> = { Point: "Local", LineString: "Trajeto", Polygon: "Área", Brush: "Área pintada", Streets: "Ruas selecionadas" };

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function searchable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function needsNeighborhood(region: MapRegion): boolean {
  return region.kind === "state" || region.kind === "city" || region.id === "aracaju:municipio";
}

function coordinates(geometry: VisitGeometry): Coordinate[] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "Brush") return brushCoordinates(geometry.strokes, true);
  if (geometry.type === "Streets") return geometry.streets.flatMap(street => street.coordinates);
  return geometry.coordinates.flat();
}

function latLngs(points: Coordinate[]): Leaflet.LatLngTuple[] {
  return points.map(([longitude, latitude]) => [latitude, longitude]);
}

function newDraft(geometry: VisitGeometry): VisitDraft {
  return { title: "", geometry, status: "visited", visitedAt: today(), notes: "", address: "" };
}

function fromVisit(visit: Visit): VisitDraft {
  return { id: visit.id, title: visit.title, geometry: visit.geometry, status: visit.status, visitedAt: visit.visitedAt, notes: visit.notes, address: visit.address };
}

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Seu acesso expirou. Entre novamente no painel para continuar.");
    const detail = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Não foi possível salvar. Confira a conexão e tente novamente.";
    throw new Error(detail);
  }
  if (!data) throw new Error("Não foi possível ler os registros. Tente novamente.");
  return data as T;
}

function GeometryIcon({ type }: { type: GeometryKind }) {
  if (type === "Brush") return <Paintbrush size={17} aria-hidden="true" />;
  if (type === "LineString" || type === "Streets") return <Route size={17} aria-hidden="true" />;
  if (type === "Polygon") return <Shapes size={17} aria-hidden="true" />;
  return <MapPin size={17} aria-hidden="true" />;
}

export function VisitMap({ lojas = EMPTY_PLATES, focusPlateId = null, onOpenPlate }: VisitMapProps) {
  const formId = useId();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [tileError, setTileError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [boot, setBoot] = useState(0);
  const [statusFilter, setStatusFilter] = useState<VisitStatus | "all">("all");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"Point" | "Brush" | "Streets" | null>(null);
  const [brushHistory, setBrushHistory] = useState<BrushHistory>(emptyBrushHistory);
  const [brushTool, setBrushTool] = useState<"paint" | "erase">("paint");
  const [brushSize, setBrushSize] = useState(28);
  const [locating, setLocating] = useState(false);
  const [regionPanel, setRegionPanel] = useState(false);
  const [regionQuery, setRegionQuery] = useState("Aracaju");
  const [regions, setRegions] = useState<MapRegion[]>([]);
  const [regionLoading, setRegionLoading] = useState(false);
  const [regionSearched, setRegionSearched] = useState(false);
  const [regionResolving, setRegionResolving] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<MapRegion | null>(null);
  const [streetOptions, setStreetOptions] = useState<MapStreet[]>([]);
  const [streetLoading, setStreetLoading] = useState(false);
  const [streetsTruncated, setStreetsTruncated] = useState(false);
  const [selectedStreetIds, setSelectedStreetIds] = useState<string[]>([]);
  const [streetSearch, setStreetSearch] = useState("");
  const [draft, setDraft] = useState<VisitDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const libraryRef = useRef<typeof Leaflet | null>(null);
  const recordsLayerRef = useRef<Leaflet.FeatureGroup | null>(null);
  const plateLayerRef = useRef<Leaflet.FeatureGroup | null>(null);
  const plateMarkersRef = useRef(new Map<string, Leaflet.Marker>());
  const focusedPlateRef = useRef<string | null>(null);
  const openPlateCallbackRef = useRef(onOpenPlate);
  const drawingModeRef = useRef(false);
  const draftLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const tileLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const locationLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const boundaryLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const streetsLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const paintInputRef = useRef<HTMLCanvasElement>(null);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushScratchRef = useRef<HTMLCanvasElement | null>(null);
  const brushHistoryRef = useRef<BrushHistory>(brushHistory);
  const currentStrokeRef = useRef<{ pointerId: number; stroke: BrushStroke; lastPixel: { x: number; y: number }; canvas: HTMLCanvasElement } | null>(null);
  const renderBrushRef = useRef<() => void>(() => {});
  const brushFrameRef = useRef<number | null>(null);
  const restoreInteractionsRef = useRef<(() => void) | null>(null);
  const paintingRef = useRef(false);
  const locationRequestRef = useRef(0);
  const brushViewRef = useRef<{ visits: Visit[]; draft: VisitDraft | null; painting: boolean }>({ visits: [], draft: null, painting: false });
  const mapClickRef = useRef<(coordinate: Coordinate) => void>(() => {});
  const editingRef = useRef<(visit: Visit) => void>(() => {});
  const mutationVersionRef = useRef(0);
  const regionRequestRef = useRef(0);
  const boundaryRequestRef = useRef(0);
  const boundaryAbortRef = useRef<AbortController | null>(null);
  const streetRequestRef = useRef(0);
  openPlateCallbackRef.current = onOpenPlate;
  drawingModeRef.current = Boolean(mode);
  const canOpenPlate = Boolean(onOpenPlate);

  const locatedPlates = useMemo(() => {
    const seen = new Set<string>();
    return lojas.filter((loja): loja is LocatedPlate => {
      if (!loja.targetUrl.trim() || !hasPlateLocation(loja) || seen.has(loja.id)) return false;
      seen.add(loja.id); return true;
    });
  }, [lojas]);
  const unlocatedPlateCount = lojas.filter(loja => loja.targetUrl.trim() && !hasPlateLocation(loja)).length;

  const filtered = useMemo(() => {
    const term = searchable(search.trim());
    return visits.filter(visit => {
      if (archiveFilter === "active" && visit.archived) return false;
      if (archiveFilter === "archived" && !visit.archived) return false;
      if (statusFilter !== "all" && visit.status !== statusFilter) return false;
      if (dateFilter && visit.visitedAt !== dateFilter) return false;
      return !term || searchable(`${visit.title} ${visit.address} ${visit.notes}`).includes(term);
    }).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt) || b.updatedAt.localeCompare(a.updatedAt));
  }, [visits, archiveFilter, statusFilter, dateFilter, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activeCount = visits.filter(visit => !visit.archived).length;
  const hasFilters = Boolean(search || dateFilter || statusFilter !== "all" || archiveFilter !== "active");

  const scheduleBrush = useCallback(() => {
    if (brushFrameRef.current !== null) return;
    brushFrameRef.current = requestAnimationFrame(() => { brushFrameRef.current = null; renderBrushRef.current(); });
  }, []);

  const renderBrush = useCallback(() => {
    const map = mapRef.current, L = libraryRef.current;
    const canvas = brushCanvasRef.current, scratch = brushScratchRef.current;
    if (!map || !L || !canvas || !scratch) return;
    const size = map.getSize(), ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (!size.x || !size.y) return;
    const width = Math.round(size.x * ratio), height = Math.round(size.y * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; scratch.width = width; scratch.height = height; }
    canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const context = canvas.getContext("2d"), isolated = scratch.getContext("2d");
    if (!context || !isolated) return;
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height);
    const project = ([longitude, latitude]: Coordinate) => map.latLngToContainerPoint([latitude, longitude]);
    const paintRecord = (strokes: BrushStroke[], color: string, opacity: number) => {
      isolated.setTransform(1, 0, 0, 1, 0, 0); isolated.clearRect(0, 0, width, height);
      isolated.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawBrushRecord(isolated, strokes, color, map.getZoom(), project);
      context.globalAlpha = opacity; context.globalCompositeOperation = "source-over";
      context.drawImage(scratch, 0, 0);
    };
    const view = brushViewRef.current;
    for (const visit of view.visits) {
      if (visit.geometry.type !== "Brush" || visit.id === view.draft?.id) continue;
      paintRecord(visit.geometry.strokes, visit.archived ? "#6b7280" : STATUS[visit.status].color, visit.archived ? 0.16 : 0.34);
    }
    if (view.painting) {
      const strokes = currentStrokeRef.current ? [...brushHistoryRef.current.strokes, currentStrokeRef.current.stroke] : brushHistoryRef.current.strokes;
      paintRecord(strokes, STATUS[view.draft?.status ?? "visited"].color, 0.43);
    } else if (view.draft?.geometry.type === "Brush") paintRecord(view.draft.geometry.strokes, STATUS[view.draft.status].color, 0.43);
    context.globalAlpha = 1;
  }, []);

  useEffect(() => { renderBrushRef.current = renderBrush; }, [renderBrush]);
  useEffect(() => {
    brushViewRef.current = { visits: filtered, draft, painting: mode === "Brush" };
    paintingRef.current = mode === "Brush";
    scheduleBrush();
  }, [filtered, draft, mode, brushHistory, scheduleBrush]);

  function updateBrushHistory(next: BrushHistory) {
    brushHistoryRef.current = next; setBrushHistory(next); scheduleBrush();
  }

  const loadVisits = useCallback(async (signal?: AbortSignal) => {
    const revision = mutationVersionRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await responseData<{ visitas: Visit[] }>(await fetch("/api/visitas", { cache: "no-store", signal }));
      if (!Array.isArray(data.visitas)) throw new Error("Não foi possível ler os registros. Tente novamente.");
      if (!signal?.aborted && revision === mutationVersionRef.current) setVisits(data.visitas);
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "Não foi possível carregar suas visitas.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadVisits(controller.signal);
    return () => controller.abort();
  }, [loadVisits]);

  useEffect(() => { setPage(1); }, [archiveFilter, statusFilter, dateFilter, search]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    setMapError(null);
    setMapReady(false);
    setTileError(false);
    import("leaflet").then(L => {
      if (disposed || !containerRef.current) return;
      libraryRef.current = L;
      const map = L.map(containerRef.current, {
        center: ARACAJU, zoom: 14, minZoom: 3, maxZoom: 19,
        maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 0.8,
        zoomControl: true, attributionControl: true, keyboard: true,
      });
      mapRef.current = map;
      tileLayerRef.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, minZoom: 3, noWrap: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        referrerPolicy: "strict-origin-when-cross-origin",
        updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1,
      }).on("tileerror", () => { if (!disposed) setTileError(true); }).addTo(map);
      recordsLayerRef.current = L.featureGroup().addTo(map);
      plateLayerRef.current = L.featureGroup().addTo(map);
      draftLayerRef.current = L.layerGroup().addTo(map);
      locationLayerRef.current = L.layerGroup().addTo(map);
      boundaryLayerRef.current = L.layerGroup().addTo(map);
      streetsLayerRef.current = L.layerGroup().addTo(map);
      const platePane = map.createPane("registeredPlates"); platePane.style.zIndex = "625";
      const boundaryPane = map.createPane("visitBoundary"); boundaryPane.style.zIndex = "380"; boundaryPane.style.pointerEvents = "none";
      const brushPane = map.createPane("visitBrush");
      brushPane.style.zIndex = "390"; brushPane.style.pointerEvents = "none";
      const brushCanvas = L.DomUtil.create("canvas", "vm-brush-render leaflet-zoom-hide");
      brushCanvas.setAttribute("aria-hidden", "true"); brushPane.appendChild(brushCanvas);
      brushCanvasRef.current = brushCanvas; brushScratchRef.current = document.createElement("canvas");
      map.on("move zoomend resize", scheduleBrush);
      map.on("click", (event: Leaflet.LeafletMouseEvent) => {
        const position = event.latlng.wrap();
        if (Math.abs(position.lat) > 85) return;
        mapClickRef.current([Number(position.lng.toFixed(7)), Number(position.lat.toFixed(7))]);
      });
      map.getContainer().setAttribute("aria-label", "Mapa de visitas. Use as setas para navegar e os botões mais e menos para mudar o zoom.");
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false, pan: false }));
        resizeObserver.observe(containerRef.current);
      }
      setMapReady(true);
      scheduleBrush();
    }).catch(() => { if (!disposed) setMapError("Não foi possível carregar o mapa. Seus registros continuam disponíveis abaixo."); });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      restoreInteractionsRef.current?.();
      locationRequestRef.current++;
      regionRequestRef.current++; streetRequestRef.current++;
      boundaryRequestRef.current++; boundaryAbortRef.current?.abort();
      const active = currentStrokeRef.current;
      currentStrokeRef.current = null;
      if (active?.canvas.hasPointerCapture(active.pointerId)) active.canvas.releasePointerCapture(active.pointerId);
      if (brushFrameRef.current !== null) cancelAnimationFrame(brushFrameRef.current);
      brushFrameRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      recordsLayerRef.current = null;
      plateLayerRef.current = null; plateMarkersRef.current.clear();
      focusedPlateRef.current = null;
      draftLayerRef.current = null;
      tileLayerRef.current = null;
      locationLayerRef.current = null;
      boundaryLayerRef.current = null; streetsLayerRef.current = null;
      brushCanvasRef.current = null; brushScratchRef.current = null;
      libraryRef.current = null;
    };
  }, [boot, scheduleBrush]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || mode !== "Brush") return;
    map.stop(); map.closePopup();
    const handlers = [map.dragging, map.scrollWheelZoom, map.doubleClickZoom, map.touchZoom, map.boxZoom, map.keyboard, map.tapHold].filter((handler): handler is Leaflet.Handler => Boolean(handler));
    const enabled = handlers.map(handler => handler.enabled());
    handlers.forEach(handler => handler.disable());
    const hadZoomControl = Boolean(map.zoomControl?.getContainer()?.parentElement);
    if (hadZoomControl) map.zoomControl.remove();
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      handlers.forEach((handler, index) => enabled[index] ? handler.enable() : handler.disable());
      if (hadZoomControl) map.zoomControl.addTo(map);
      paintingRef.current = false;
    };
    restoreInteractionsRef.current = restore;
    const input = paintInputRef.current;
    const blockScroll = (event: Event) => event.preventDefault();
    input?.addEventListener("wheel", blockScroll, { passive: false });
    input?.addEventListener("touchmove", blockScroll, { passive: false });
    input?.focus({ preventScroll: true });
    return () => {
      input?.removeEventListener("wheel", blockScroll);
      input?.removeEventListener("touchmove", blockScroll);
      restore();
      if (restoreInteractionsRef.current === restore) restoreInteractionsRef.current = null;
    };
  }, [mapReady, mode]);

  useEffect(() => {
    const map = mapRef.current, L = libraryRef.current, group = plateLayerRef.current;
    if (!mapReady || !map || !L || !group) return;
    group.clearLayers(); plateMarkersRef.current.clear();
    const pane = map.getPane("registeredPlates");
    if (pane) pane.style.pointerEvents = mode ? "none" : "auto";
    for (const loja of locatedPlates) {
      const html = document.createElement("div"); html.className = "vm-plate-pin-content";
      // Static artwork only. All database text is assigned through textContent.
      const pin = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      pin.setAttribute("viewBox", "0 0 36 44"); pin.setAttribute("aria-hidden", "true");
      pin.innerHTML = '<path d="M18 1C8.6 1 1 8.6 1 18c0 12 17 25 17 25s17-13 17-25C35 8.6 27.4 1 18 1Z" fill="currentColor" stroke="#fff" stroke-width="2"/><path d="M9 9h6v6H9zm12 0h6v6h-6zM9 21h6v6H9z" fill="none" stroke="#fff" stroke-width="2"/><path d="M10.5 10.5h3v3h-3zm12 0h3v3h-3zm-12 12h3v3h-3zM18 9h2v2h-2zm0 5h2v6h-2zm4 4h5v2h-5zm-3 4h3v3h-3zm5 1h3v4h-3zm-8 5h5v2h-5z" fill="#fff"/>';
      html.appendChild(pin);
      const code = document.createElement("span"); code.className = "vm-plate-marker-code"; code.textContent = loja.code; html.appendChild(code);
      const marker = L.marker([loja.latitude, loja.longitude], {
        pane: "registeredPlates", interactive: !mode, keyboard: !mode, bubblingMouseEvents: false,
        title: `${loja.name} · ${loja.code}`, alt: `Placa ${loja.code}`, riseOnHover: true,
        icon: L.divIcon({ className: `vm-plate-marker${loja.active ? "" : " vm-plate-paused"}`, html,
          iconSize: [76, 65], iconAnchor: [38, 43], popupAnchor: [0, -41], tooltipAnchor: [0, -40] }),
      });
      const popup = document.createElement("div"); popup.className = "vm-popup vm-plate-popup";
      const badge = document.createElement("span"); badge.className = `vm-plate-popup-code${loja.active ? "" : " vm-plate-paused"}`;
      badge.textContent = `Placa ${loja.code} · ${loja.active ? "Ativa" : "Pausada"}`; popup.appendChild(badge);
      const name = document.createElement("strong"); name.textContent = loja.name; popup.appendChild(name);
      const address = document.createElement("p"); address.textContent = plateLocationLabel(loja); popup.appendChild(address);
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Abrir cadastro";
      open.disabled = Boolean(mode) || !canOpenPlate;
      open.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation();
        if (drawingModeRef.current || paintingRef.current) return;
        mapRef.current?.closePopup(); openPlateCallbackRef.current?.(loja.id);
      });
      popup.appendChild(open); L.DomEvent.disableClickPropagation(popup); L.DomEvent.disableScrollPropagation(popup);
      marker.bindPopup(popup, { maxWidth: 300 });
      const tooltip = document.createElement("span"); tooltip.textContent = `${loja.code} · ${loja.name}`;
      marker.bindTooltip(tooltip);
      marker.on("add", () => {
        const element = marker.getElement(); if (!element) return;
        element.setAttribute("aria-label", `Placa ${loja.code}, ${loja.name}, ${loja.active ? "ativa" : "pausada"}. Abrir informações.`);
        if (mode) { element.removeAttribute("tabindex"); return; }
        element.setAttribute("role", "button"); element.setAttribute("tabindex", "0");
        element.addEventListener("keydown", event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); event.stopPropagation();
          if (!drawingModeRef.current && !paintingRef.current) marker.openPopup();
        });
      });
      marker.addTo(group); plateMarkersRef.current.set(loja.id, marker);
    }
    return () => { group.clearLayers(); plateMarkersRef.current.clear(); };
  }, [locatedPlates, mapReady, mode, canOpenPlate]);

  useEffect(() => {
    if (!focusPlateId) { focusedPlateRef.current = null; return; }
    const map = mapRef.current, marker = plateMarkersRef.current.get(focusPlateId);
    if (!mapReady || !map || !marker || mode || paintingRef.current) return;
    const point = marker.getLatLng(), key = `${boot}:${focusPlateId}:${point.lat}:${point.lng}`;
    if (focusedPlateRef.current === key) return;
    map.stop(); map.setView(point, 17, { animate: false }); marker.openPopup(); focusedPlateRef.current = key;
  }, [focusPlateId, locatedPlates, mapReady, mode, boot]);

  const coveredStreets = useMemo(() => {
    const covered = new Map<string, VisitStatus>();
    for (const visit of visits) if (!visit.archived && visit.geometry.type === "Streets") {
      for (const street of visit.geometry.streets) covered.set(street.id, visit.status);
    }
    return covered;
  }, [visits]);
  const coveredCount = streetOptions.filter(street => coveredStreets.has(street.id)).length;

  useEffect(() => {
    const L = libraryRef.current, group = boundaryLayerRef.current;
    if (!mapReady || !L || !group) return;
    group.clearLayers();
    if (!selectedRegion?.geometry) return;
    const polygons = selectedRegion.geometry.type === "Polygon" ? [selectedRegion.geometry.coordinates] : selectedRegion.geometry.coordinates;
    L.polygon(polygons.map(polygon => polygon.map(latLngs)), { color: "#42556f", weight: 2.5, dashArray: "7 6", fill: false, interactive: false, pane: "visitBoundary" }).addTo(group);
  }, [selectedRegion, mapReady]);

  const toggleStreet = useCallback((street: MapStreet) => {
    setSelectedStreetIds(current => {
      if (current.includes(street.id)) return current.filter(id => id !== street.id);
      const count = streetOptions.filter(item => current.includes(item.id)).reduce((total, item) => total + item.geometry.coordinates.length, street.geometry.coordinates.length);
      if (current.length >= 80 || count > 3000) { setError("Este registro atingiu o limite de ruas. Confirme e crie outro para continuar a cobertura."); return current; }
      return [...current, street.id];
    });
  }, [streetOptions]);

  useEffect(() => {
    const L = libraryRef.current, group = streetsLayerRef.current;
    if (!mapReady || !L || !group) return;
    group.clearLayers();
    if (mode !== "Streets") return;
    for (const street of streetOptions) {
      const selected = selectedStreetIds.includes(street.id), covered = coveredStreets.get(street.id);
      const line = L.polyline(latLngs(street.geometry.coordinates), { color: selected ? "#1a73e8" : covered ? STATUS[covered].color : "#8092a9", weight: selected ? 8 : covered ? 6 : 4, opacity: selected ? 1 : covered ? 0.85 : 0.6, bubblingMouseEvents: false });
      const label = document.createElement("span"); label.textContent = `${street.name}${selected ? " · selecionada" : covered ? ` · ${STATUS[covered].label}` : ""}`;
      line.bindTooltip(label); line.on("click", () => toggleStreet(street)); line.addTo(group);
    }
  }, [mapReady, mode, streetOptions, selectedStreetIds, coveredStreets, toggleStreet]);

  async function searchRegions(query = regionQuery) {
    if (paintingRef.current || query.trim().length < 2) return;
    const request = ++regionRequestRef.current;
    setRegionLoading(true); setRegionSearched(true); setError(null);
    try {
      const data = await responseData<{ regions: MapRegion[] }>(await fetch("/api/mapa/regioes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim() }) }));
      if (request === regionRequestRef.current) setRegions(Array.isArray(data.regions) ? data.regions : []);
    } catch (caught) { if (request === regionRequestRef.current) setError(caught instanceof Error ? caught.message : "Não foi possível buscar essa região."); }
    finally { if (request === regionRequestRef.current) setRegionLoading(false); }
  }

  async function chooseRegion(region: MapRegion) {
    const map = mapRef.current, L = libraryRef.current;
    if (!map || !L || paintingRef.current || !region.bbox.every(Number.isFinite)) return;
    const request = ++boundaryRequestRef.current;
    boundaryAbortRef.current?.abort();
    boundaryAbortRef.current = null;
    setSelectedRegion(region); setRegionPanel(false); setStreetOptions([]); setSelectedStreetIds([]); setStreetsTruncated(false); setStreetSearch("");
    locationRequestRef.current++; setLocating(false);
    streetRequestRef.current++; setStreetLoading(false);
    if (mode === "Streets") setMode(null);
    map.fitBounds(L.latLngBounds([region.bbox[1], region.bbox[0]], [region.bbox[3], region.bbox[2]]), { padding: [25, 25], maxZoom: 16 });
    if (region.geometry) { setRegionResolving(false); setNotice(`Limite de ${region.name} destacado no mapa.`); return; }
    const controller = new AbortController(); boundaryAbortRef.current = controller;
    setRegionResolving(true); setNotice(`Marcando limite de ${region.name}…`);
    try {
      const data = await responseData<{ region: MapRegion }>(await fetch("/api/mapa/limite", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region: { id: region.id } }) }));
      if (request !== boundaryRequestRef.current || controller.signal.aborted) return;
      const resolved = data.region;
      if (!resolved?.bbox?.every(Number.isFinite)) throw new Error("O limite desta região não está disponível agora.");
      setSelectedRegion(resolved);
      if (resolved.geometry && !paintingRef.current) {
        map.fitBounds(L.latLngBounds([resolved.bbox[1], resolved.bbox[0]], [resolved.bbox[3], resolved.bbox[2]]), { padding: [25, 25], maxZoom: 16 });
        setNotice(`Limite de ${resolved.name} destacado no mapa.`);
      } else setNotice(`${region.name} localizada. Não há contorno disponível nesta fonte; a região permanece centralizada.`);
    } catch (caught) {
      if (request === boundaryRequestRef.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o limite desta região. Você pode continuar usando o mapa.");
    } finally {
      if (request === boundaryRequestRef.current) { setRegionResolving(false); boundaryAbortRef.current = null; }
    }
  }

  async function loadStreets() {
    if (!selectedRegion || needsNeighborhood(selectedRegion) || paintingRef.current || streetLoading || regionResolving) return;
    const request = ++streetRequestRef.current;
    setStreetLoading(true); setError(null);
    try {
      const data = await responseData<{ streets: MapStreet[]; truncated: boolean }>(await fetch("/api/mapa/ruas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region: { id: selectedRegion.id } }) }));
      if (request !== streetRequestRef.current) return;
      setStreetOptions(Array.isArray(data.streets) ? data.streets : []); setStreetsTruncated(Boolean(data.truncated)); setSelectedStreetIds([]); setStreetSearch("");
      if (!data.streets?.length) setNotice("Nenhuma rua disponível nesta região. Você pode usar a pintura livre sobre o mapa.");
      else { setDraft(null); setMode("Streets"); setNotice("Ruas carregadas. Toque nos trechos do mapa ou escolha pela lista para registrar a cobertura."); }
    } catch (caught) { if (request === streetRequestRef.current) setError(caught instanceof Error ? caught.message : "Não foi possível carregar as ruas."); }
    finally { if (request === streetRequestRef.current) setStreetLoading(false); }
  }

  function startStreets(redraw = false) {
    if (paintingRef.current || saving) return;
    if (redraw && draft?.geometry.type === "Streets") {
      const existing = draft.geometry.streets;
      setStreetOptions(current => [...current, ...existing.filter(street => !current.some(item => item.id === street.id)).map(street => ({ id: street.id, name: street.name, geometry: { type: "LineString" as const, coordinates: street.coordinates } }))]);
      setSelectedStreetIds(existing.map(street => street.id));
    } else { if (!streetOptions.length) return; setDraft(null); setSelectedStreetIds([]); }
    setStreetSearch(""); setMode("Streets"); setError(null); setNotice(null); mapRef.current?.closePopup();
  }

  function confirmStreets() {
    const selected = streetOptions.filter(street => selectedStreetIds.includes(street.id));
    if (!selected.length) return;
    const geometry: VisitGeometry = { type: "Streets", streets: selected.map(street => ({ id: street.id, name: street.name, coordinates: street.geometry.coordinates })) };
    setDraft(current => current ? { ...current, geometry } : { ...newDraft(geometry), title: selectedRegion ? `Ruas de ${selectedRegion.name}`.slice(0, 100) : "Ruas visitadas" });
    setMode(null); setError(null); setNotice("Ruas selecionadas. Preencha os dados e salve para registrar a cobertura.");
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  const focusGeometry = useCallback((geometry: VisitGeometry) => {
    const L = libraryRef.current;
    const map = mapRef.current;
    if (!L || !map || paintingRef.current) return;
    if (geometry.type === "Point") map.setView([geometry.coordinates[1], geometry.coordinates[0]], 17);
    else map.fitBounds(L.latLngBounds(latLngs(coordinates(geometry))), { padding: [35, 35], maxZoom: 17 });
  }, []);

  const editVisit = useCallback((visit: Visit) => {
    if (saving || busyId || paintingRef.current) return;
    setMode(null); setDraft(fromVisit(visit)); setError(null); setNotice(null);
    focusGeometry(visit.geometry);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [focusGeometry, saving, busyId]);

  useEffect(() => { editingRef.current = editVisit; }, [editVisit]);

  useEffect(() => {
    const L = libraryRef.current;
    const group = recordsLayerRef.current;
    if (!mapReady || !L || !group) return;
    group.clearLayers();
    for (const visit of filtered) {
      if (visit.geometry.type === "Brush" || (mode === "Brush" && visit.id === draft?.id)) continue;
      const color = visit.archived ? "#6b7280" : STATUS[visit.status].color;
      const selected = draft?.id === visit.id;
      const style: Leaflet.PathOptions = {
        color, weight: selected ? 5 : 3, opacity: visit.archived ? 0.55 : 0.9,
        fillColor: color, fillOpacity: visit.archived ? 0.06 : 0.15,
        dashArray: visit.archived ? "6 6" : undefined,
        interactive: !mode, bubblingMouseEvents: false,
      };
      let layer: Leaflet.Path;
      if (visit.geometry.type === "Point") {
        layer = L.circleMarker([visit.geometry.coordinates[1], visit.geometry.coordinates[0]], {
          ...style, radius: selected ? 10 : 8, color: "#ffffff", weight: 2.5, fillColor: color, fillOpacity: visit.archived ? 0.55 : 1,
        });
      } else if (visit.geometry.type === "LineString") layer = L.polyline(latLngs(visit.geometry.coordinates), { ...style, weight: selected ? 6 : 4 });
      else if (visit.geometry.type === "Streets") layer = L.polyline(visit.geometry.streets.map(street => latLngs(street.coordinates)), { ...style, weight: selected ? 7 : 5 });
      else layer = L.polygon(visit.geometry.coordinates.map(latLngs), style);
      const popup = document.createElement("div");
      popup.className = "vm-popup";
      const heading = document.createElement("strong"); heading.textContent = visit.title; popup.appendChild(heading);
      const detail = document.createElement("p");
      detail.textContent = `${STATUS[visit.status].label} · ${displayDate(visit.visitedAt)}${visit.archived ? " · Arquivado" : ""}`;
      popup.appendChild(detail);
      if (visit.address) { const address = document.createElement("p"); address.textContent = visit.address; popup.appendChild(address); }
      if (visit.notes) { const notes = document.createElement("p"); notes.textContent = visit.notes; notes.className = "vm-popup-notes"; popup.appendChild(notes); }
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Editar registro";
      edit.disabled = saving || Boolean(busyId);
      edit.addEventListener("click", () => { mapRef.current?.closePopup(); editingRef.current(visit); });
      popup.appendChild(edit);
      layer.bindPopup(popup, { maxWidth: 280 });
      const tooltip = document.createElement("span"); tooltip.textContent = visit.title;
      layer.bindTooltip(tooltip);
      layer.on("add", () => {
        const element = layer.getElement();
        if (!element || mode) return;
        element.setAttribute("tabindex", "0"); element.setAttribute("role", "button");
        element.setAttribute("aria-label", `${visit.title}, ${STATUS[visit.status].label}. Abrir detalhes.`);
        element.addEventListener("keydown", event => {
          const key = (event as KeyboardEvent).key;
          if (key === "Enter" || key === " ") { event.preventDefault(); layer.openPopup(); }
        });
      });
      layer.addTo(group);
    }
  }, [filtered, mapReady, mode, draft?.id, saving, busyId]);

  useEffect(() => {
    const L = libraryRef.current;
    const group = draftLayerRef.current;
    if (!mapReady || !L || !group) return;
    group.clearLayers();
    const style: Leaflet.PathOptions = { color: "#202124", weight: 3, dashArray: "7 6", fillColor: "#1a73e8", fillOpacity: 0.13, interactive: false };
    if (!mode && draft && draft.geometry.type !== "Brush") {
      if (draft.geometry.type === "Point") L.circleMarker([draft.geometry.coordinates[1], draft.geometry.coordinates[0]], { ...style, radius: 12, fillOpacity: 0.5 }).addTo(group);
      else if (draft.geometry.type === "LineString") L.polyline(latLngs(draft.geometry.coordinates), style).addTo(group);
      else if (draft.geometry.type === "Streets") L.polyline(draft.geometry.streets.map(street => latLngs(street.coordinates)), style).addTo(group);
      else L.polygon(draft.geometry.coordinates.map(latLngs), style).addTo(group);
    }
  }, [mapReady, mode, draft]);

  function startPoint(redraw = false) {
    if (!mapReady || saving || paintingRef.current) return;
    if (!redraw) setDraft(null);
    mapRef.current?.closePopup();
    setMode("Point"); setError(null); setNotice(null);
  }

  function startBrush(redraw = false) {
    const map = mapRef.current;
    if (!mapReady || !map || saving || locating || streetLoading || regionResolving || paintingRef.current) return;
    if (map.getZoom() < 12) { setError("Aproxime o mapa até ver as ruas antes de começar a pintar."); return; }
    const existingBrush = draft?.geometry.type === "Brush" ? draft.geometry : null;
    const initial = existingBrush ? existingBrush.strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => [...point] as Coordinate) })) : [];
    if (!redraw && !existingBrush) setDraft(null);
    updateBrushHistory(emptyBrushHistory(initial));
    paintingRef.current = true;
    setBrushTool("paint"); setMode("Brush"); setError(null); setNotice(null);
    map.closePopup(); map.stop();
  }

  function discardActiveStroke() {
    const active = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (active?.canvas.hasPointerCapture(active.pointerId)) active.canvas.releasePointerCapture(active.pointerId);
    if (brushCursorRef.current) brushCursorRef.current.style.display = "none";
    scheduleBrush();
  }

  function cancelDrawing() {
    discardActiveStroke();
    setMode(null); setError(null);
    updateBrushHistory(emptyBrushHistory());
  }

  const handleMapClick = useCallback((coordinate: Coordinate) => {
    if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 85) return;
    if (mode === "Point") {
      const geometry: VisitGeometry = { type: "Point", coordinates: coordinate };
      setDraft(current => current ? { ...current, geometry } : newDraft(geometry));
      setMode(null); setError(null); setNotice("Local marcado. Preencha os dados e salve o registro.");
      requestAnimationFrame(() => titleRef.current?.focus());
    } else if (!mode) {
      const visit = [...filtered].reverse().find(item => item.geometry.type === "Brush" && brushContains(item.geometry.strokes, coordinate));
      if (visit) editVisit(visit);
    }
  }, [mode, filtered, editVisit]);

  useEffect(() => { mapClickRef.current = handleMapClick; }, [handleMapClick]);

  function paintPosition(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
    const map = mapRef.current;
    if (!map) return null;
    const rect = canvas.getBoundingClientRect();
    const pixel = { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
    const location = map.containerPointToLatLng([pixel.x, pixel.y]).wrap();
    if (Math.abs(location.lat) > 85) return null;
    return { pixel, coordinate: [Number(location.lng.toFixed(7)), Number(location.lat.toFixed(7))] as Coordinate };
  }

  function updateBrushCursor(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
    const position = paintPosition(event, canvas), map = mapRef.current, cursor = brushCursorRef.current;
    if (!position || !map || !cursor) return;
    const radius = radiusInMeters(brushSize / 2, position.coordinate[1], map.getZoom()) / metersPerPixel(position.coordinate[1], map.getZoom());
    cursor.style.width = `${2 * radius}px`; cursor.style.height = `${2 * radius}px`;
    cursor.style.transform = `translate(${position.pixel.x - radius}px, ${position.pixel.y - radius}px)`;
    cursor.style.display = "block";
  }

  function extendActiveStroke(event: { clientX: number; clientY: number }, force = false) {
    const active = currentStrokeRef.current;
    if (!active) return;
    const position = paintPosition(event, active.canvas);
    if (!position || (!force && Math.hypot(position.pixel.x - active.lastPixel.x, position.pixel.y - active.lastPixel.y) < 2)) return;
    if (brushPointCount(brushHistoryRef.current.strokes) + active.stroke.points.length >= MAX_BRUSH_POINTS) {
      setError("Esta pintura chegou ao limite de detalhes. Confirme para salvar ou use Desfazer para continuar."); return;
    }
    const last = active.stroke.points[active.stroke.points.length - 1];
    if (last[0] === position.coordinate[0] && last[1] === position.coordinate[1]) return;
    active.stroke.points.push(position.coordinate); active.lastPixel = position.pixel;
    scheduleBrush();
  }

  function finishActiveStroke(event?: { clientX: number; clientY: number }) {
    const active = currentStrokeRef.current;
    if (!active) return;
    if (event) extendActiveStroke(event, true);
    currentStrokeRef.current = null;
    if (active.canvas.hasPointerCapture(active.pointerId)) active.canvas.releasePointerCapture(active.pointerId);
    const history = brushHistoryRef.current;
    updateBrushHistory(commitBrush(history, [...history.strokes, active.stroke]));
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (mode !== "Brush" || currentStrokeRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    const history = brushHistoryRef.current;
    if (history.strokes.length >= MAX_BRUSH_STROKES || brushPointCount(history.strokes) >= MAX_BRUSH_POINTS) { setError("Esta pintura chegou ao limite de detalhes. Confirme para salvar ou use Desfazer."); return; }
    const position = paintPosition(event, event.currentTarget), map = mapRef.current;
    if (!position || !map) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    currentStrokeRef.current = { pointerId: event.pointerId, canvas: event.currentTarget, lastPixel: position.pixel, stroke: { points: [position.coordinate], radiusMeters: Number(radiusInMeters(brushSize / 2, position.coordinate[1], map.getZoom()).toFixed(4)), mode: brushTool } };
    setError(null); updateBrushCursor(event, event.currentTarget); scheduleBrush();
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault(); event.stopPropagation();
    updateBrushCursor(event, event.currentTarget);
    if (currentStrokeRef.current?.pointerId !== event.pointerId) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event.nativeEvent]) extendActiveStroke(sample);
  }

  function confirmBrush() {
    finishActiveStroke();
    const strokes = brushHistoryRef.current.strokes;
    if (!strokes.some(stroke => stroke.mode === "paint")) { setError("Pinte uma área antes de confirmar."); return; }
    const geometry: VisitGeometry = { type: "Brush", strokes };
    setDraft(current => current ? { ...current, geometry } : newDraft(geometry));
    setMode(null); setError(null); setNotice("Pintura pronta. Preencha os dados e salve o registro.");
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function locateMe() {
    if (!mapReady || paintingRef.current || locating) return;
    if (!navigator.geolocation) { setError("Este navegador não oferece localização. Você pode navegar pelo mapa normalmente."); return; }
    const request = ++locationRequestRef.current;
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(position => {
      if (locationRequestRef.current !== request) return;
      setLocating(false);
      const map = mapRef.current, L = libraryRef.current, layer = locationLayerRef.current;
      if (!map || !L || !layer || paintingRef.current) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (Math.abs(latitude) > 85) { setError("Não foi possível mostrar essa localização no mapa."); return; }
      layer.clearLayers();
      L.circle([latitude, longitude], { radius: accuracy, color: "#4285f4", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layer);
      const label = document.createElement("span"); label.textContent = `Você está aqui · precisão aproximada de ${Math.round(accuracy)} m`;
      L.circleMarker([latitude, longitude], { radius: 7, color: "white", weight: 2, fillColor: "#4285f4", fillOpacity: 1 }).bindTooltip(label).addTo(layer);
      map.setView([latitude, longitude], 17);
      setNotice("Localização encontrada. Marque a loja ou escolha Pintar áreas. Nada foi salvo automaticamente.");
    }, reason => {
      if (locationRequestRef.current !== request) return;
      setLocating(false);
      setError(reason.code === 1 ? "A localização não foi autorizada. Permita o acesso no navegador ou navegue pelo mapa." : reason.code === 3 ? "A localização demorou para responder. Tente novamente ou navegue pelo mapa." : "Não foi possível encontrar sua localização. Você pode navegar pelo mapa normalmente.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  async function saveVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || mode || saving) return;
    const payload = { title: draft.title.trim(), geometry: draft.geometry, status: draft.status, visitedAt: draft.visitedAt, notes: draft.notes.trim(), address: draft.address.trim() };
    if (!payload.title) { setError("Dê um nome para este registro."); titleRef.current?.focus(); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const data = await responseData<{ visita: Visit }>(await fetch(draft.id ? `/api/visitas/${encodeURIComponent(draft.id)}` : "/api/visitas", {
        method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }));
      if (!data.visita?.id) throw new Error("Não foi possível confirmar o registro. Atualize a lista antes de tentar novamente.");
      mutationVersionRef.current++;
      setVisits(current => [data.visita, ...current.filter(visit => visit.id !== data.visita.id)]);
      setDraft(null); setNotice(draft.id ? "Registro atualizado." : "Visita salva no mapa.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar o registro."); }
    finally { setSaving(false); }
  }

  async function toggleArchived(visit: Visit) {
    if (busyId || saving || paintingRef.current) return;
    setBusyId(visit.id); setError(null); setNotice(null);
    try {
      const data = await responseData<{ visita: Visit }>(await fetch(`/api/visitas/${encodeURIComponent(visit.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: !visit.archived }),
      }));
      if (!data.visita?.id) throw new Error("Não foi possível confirmar a alteração. Atualize a lista.");
      mutationVersionRef.current++;
      setVisits(current => current.map(item => item.id === visit.id ? data.visita : item));
      if (draft?.id === visit.id) { setDraft(null); setMode(null); }
      setNotice(visit.archived ? "Registro restaurado no mapa." : "Registro arquivado. Você pode restaurá-lo pelo filtro Arquivados.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível alterar o registro."); }
    finally { setBusyId(null); }
  }

  function seeAll() {
    const L = libraryRef.current;
    const map = mapRef.current;
    if (!L || !map || !filtered.length || paintingRef.current) return;
    const allPoints = filtered.flatMap(visit => coordinates(visit.geometry));
    map.fitBounds(L.latLngBounds(latLngs(allPoints)), { padding: [35, 35], maxZoom: 17 });
  }

  function seePlates() {
    const map = mapRef.current, L = libraryRef.current;
    if (!mapReady || !map || !L || !locatedPlates.length || drawingModeRef.current || paintingRef.current) return;
    map.stop(); map.fitBounds(L.latLngBounds(locatedPlates.map(loja => [loja.latitude, loja.longitude] as Leaflet.LatLngTuple)), { padding: [48, 48], maxZoom: 17 });
  }

  function clearFilters() {
    setStatusFilter("all"); setArchiveFilter("active"); setSearch(""); setDateFilter("");
  }

  const brushHasPaint = brushHistory.strokes.some(stroke => stroke.mode === "paint");
  return <section className="vm-root fieldwork" aria-label="Mapa de visitas e prospecção">
    <header className="fieldwork-heading">
      <div><span className="fieldwork-live"><i />Caderno de campo</span><h1>Explore a próxima rua.</h1></div>
      <button className="vm-button vm-button-quiet" type="button" aria-label="Atualizar registros" onClick={() => void loadVisits()} disabled={loading || saving || Boolean(busyId) || mode === "Brush"}><RotateCcw size={16} aria-hidden="true" className={loading ? "vm-spin" : undefined} /><span>Atualizar</span></button>
    </header>

    {error && <div className="vm-message vm-message-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Fechar mensagem de erro"><X size={17} aria-hidden="true" /></button></div>}
    {notice && <div className="vm-message vm-message-success" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Fechar mensagem"><X size={17} aria-hidden="true" /></button></div>}

    <div className={`vm-workspace${draft ? " fieldwork-editing" : ""}`}>
      <div className="vm-map-card">
        <div className="vm-toolbar" aria-label="Ferramentas do mapa">
          <div className="vm-tools">
            <button className={`vm-tool${mode === "Point" ? " vm-tool-active" : ""}`} type="button" onClick={() => startPoint()} disabled={!mapReady || saving || mode === "Brush"} aria-pressed={mode === "Point"}><MapPin size={17} aria-hidden="true" />Marcar loja</button>
            <button className={`vm-tool${mode === "Brush" ? " vm-tool-active" : ""}`} type="button" onClick={() => startBrush()} disabled={!mapReady || saving || locating || streetLoading || regionResolving || mode === "Brush"} aria-pressed={mode === "Brush"}><Paintbrush size={17} aria-hidden="true" />Pintar áreas</button>
            <button className={`vm-tool${mode === "Streets" ? " vm-tool-active" : ""}`} type="button" onClick={() => startStreets()} disabled={!mapReady || saving || !streetOptions.length || mode === "Brush"} aria-pressed={mode === "Streets"}><Route size={17} aria-hidden="true" />Selecionar ruas</button>
          </div>
          <div className="vm-map-navigation">
            <button className="vm-tool" type="button" onClick={() => { const open = !regionPanel; setRegionPanel(open); if (open && !regionSearched) void searchRegions("Aracaju"); }} disabled={!mapReady || mode === "Brush"} aria-expanded={regionPanel}><Navigation size={16} aria-hidden="true" /><span>{selectedRegion?.name || "Aracaju"}</span></button>
            <button className="vm-tool" type="button" onClick={locateMe} disabled={!mapReady || locating || mode === "Brush"} title="Usar minha localização apenas no mapa">{locating ? <LoaderCircle className="vm-spin" size={16} aria-hidden="true" /> : <LocateFixed size={16} aria-hidden="true" />}<span>Minha localização</span></button>
            <button className="vm-tool" type="button" onClick={seeAll} disabled={!mapReady || !filtered.length || mode === "Brush"} title="Enquadrar todos os registros filtrados"><Focus size={17} aria-hidden="true" /><span>Ver todos</span></button>
            <button className="vm-tool vm-see-plates" type="button" onClick={seePlates} disabled={!mapReady || !locatedPlates.length || Boolean(mode)} title="Enquadrar as placas cadastradas com localização"><QrCode size={16} aria-hidden="true" /><span>Ver placas ({locatedPlates.length})</span></button>
          </div>
        </div>

        {regionPanel && <div className="vm-region-panel">
          <form className="vm-region-search" onSubmit={event => { event.preventDefault(); void searchRegions(); }}><label>Estado, cidade ou bairro<input type="search" value={regionQuery} maxLength={120} onChange={event => setRegionQuery(event.target.value)} placeholder="Busque qualquer região" disabled={mode === "Brush"} /></label><button className="vm-button vm-button-primary" type="submit" disabled={regionLoading || regionQuery.trim().length < 2 || mode === "Brush"}>{regionLoading ? <LoaderCircle className="vm-spin" size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}Buscar</button></form>
          {regionLoading ? <p className="vm-region-empty" role="status">Buscando regiões…</p> : regions.length ? <div className="vm-region-results" aria-label="Regiões encontradas">{regions.map(region => <button key={region.id} type="button" onClick={() => chooseRegion(region)} disabled={mode === "Brush"}><strong>{region.name}</strong><span>{region.label}</span></button>)}</div> : regionSearched && <p className="vm-region-empty">Nenhuma região encontrada. Tente incluir a cidade ou o estado na busca.</p>}
        </div>}

        {selectedRegion && <div className="vm-region-context"><div><strong>{selectedRegion.name}</strong><span>{regionResolving ? "Marcando limite…" : needsNeighborhood(selectedRegion) ? "Escolha um bairro para carregar ruas" : selectedRegion.geometry ? "Limite destacado" : "Sem limite oficial disponível"} · Fonte: {selectedRegion.source}</span>{streetOptions.length > 0 && <div className="vm-street-coverage"><progress value={coveredCount} max={streetOptions.length} /><span>{coveredCount} de {streetOptions.length} trechos com registro</span></div>}</div><button className="vm-button vm-button-quiet" type="button" onClick={() => void loadStreets()} disabled={streetLoading || regionResolving || mode === "Brush" || needsNeighborhood(selectedRegion)}>{streetLoading ? <LoaderCircle className="vm-spin" size={15} aria-hidden="true" /> : <Route size={15} aria-hidden="true" />}{streetLoading ? "Carregando ruas…" : streetOptions.length ? "Recarregar ruas" : "Carregar ruas"}</button></div>}

        {mode === "Streets" && <div className="vm-street-selection"><strong>Escolha os trechos que você percorreu</strong><p>Toque nas ruas do mapa ou selecione pelos nomes abaixo. As ruas confirmadas ficam ligadas a este registro.</p><input className="vm-street-search" type="search" value={streetSearch} onChange={event => setStreetSearch(event.target.value)} placeholder="Filtrar ruas pelo nome" aria-label="Filtrar ruas disponíveis" />{streetOptions.filter(street => searchable(street.name).includes(searchable(streetSearch))).length > 100 && <p className="vm-street-list-hint">Mostrando até 100 trechos. Filtre pelo nome ou selecione qualquer trecho no mapa.</p>}<div className="vm-street-list">{streetOptions.filter(street => searchable(street.name).includes(searchable(streetSearch))).slice(0, 100).map((street, index) => <button key={street.id} type="button" onClick={() => toggleStreet(street)} aria-pressed={selectedStreetIds.includes(street.id)} aria-label={`${street.name}, trecho ${index + 1}`} title={street.name}>{selectedStreetIds.includes(street.id) && <Check size={12} aria-hidden="true" />}{street.name}</button>)}</div><div className="vm-drawing-actions"><button type="button" className="vm-button vm-button-primary" onClick={confirmStreets} disabled={!selectedStreetIds.length}><Check size={15} aria-hidden="true" />Confirmar {selectedStreetIds.length} {selectedStreetIds.length === 1 ? "trecho" : "trechos"}</button><button type="button" className="vm-button vm-button-quiet" onClick={() => setSelectedStreetIds([])} disabled={!selectedStreetIds.length}>Limpar seleção</button><button type="button" className="vm-button vm-button-quiet" onClick={cancelDrawing}>Cancelar</button></div>{streetsTruncated && <p>Foram carregadas parte das ruas. Escolha uma região menor para detalhar a cobertura.</p>}</div>}

        {mode === "Point" && <div className="vm-drawing" role="status">
          <div><strong>Onde fica esta loja?</strong><p>Toque ou clique no mapa para marcar o local.</p></div>
          <div className="vm-drawing-actions">
            <button type="button" className="vm-button vm-button-quiet" onClick={() => { const position = mapRef.current?.getCenter(); if (position) handleMapClick([Number(position.wrap().lng.toFixed(7)), Number(position.lat.toFixed(7))]); }}><Plus size={15} aria-hidden="true" />Ponto no centro</button>
            <button className="vm-button vm-button-quiet" type="button" onClick={cancelDrawing}><X size={15} aria-hidden="true" />Cancelar</button>
          </div>
        </div>}

        {mode === "Brush" && <div className="vm-drawing vm-paint-controls">
          <div className="vm-paint-heading"><strong><LockKeyhole size={16} aria-hidden="true" />Mapa parado para pintar</strong><span>Passe o dedo ou arraste o mouse. Confirme para preencher os dados.</span></div>
          <div className="vm-brush-tools"><div className="vm-brush-toolset" aria-label="Ferramenta de pintura"><button type="button" className={brushTool === "paint" ? "vm-brush-selected" : ""} aria-pressed={brushTool === "paint"} onClick={() => setBrushTool("paint")}><Paintbrush size={16} aria-hidden="true" />Pincel</button><button type="button" className={brushTool === "erase" ? "vm-brush-selected" : ""} aria-pressed={brushTool === "erase"} onClick={() => setBrushTool("erase")}><Eraser size={16} aria-hidden="true" />Borracha</button></div><label className="vm-brush-size">Tamanho<input type="range" min={6} max={64} step={2} value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} aria-label="Tamanho do pincel" /><span>{brushSize} px</span></label></div>
          <div className="vm-drawing-actions"><button type="button" className="vm-button vm-button-quiet" disabled={!brushHistory.past.length} onClick={() => updateBrushHistory(undoBrush(brushHistoryRef.current))}><Undo2 size={15} aria-hidden="true" />Desfazer</button><button type="button" className="vm-button vm-button-quiet" disabled={!brushHistory.future.length} onClick={() => updateBrushHistory(redoBrush(brushHistoryRef.current))}><Redo2 size={15} aria-hidden="true" />Refazer</button><button type="button" className="vm-button vm-button-quiet" disabled={!brushHistory.strokes.length} onClick={() => updateBrushHistory(commitBrush(brushHistoryRef.current, []))}><Trash2 size={15} aria-hidden="true" />Limpar</button><button type="button" className="vm-button vm-button-primary" onClick={confirmBrush} disabled={!brushHasPaint}><Check size={15} aria-hidden="true" />Confirmar pintura</button><button type="button" className="vm-button vm-button-quiet" onClick={cancelDrawing}><X size={15} aria-hidden="true" />Cancelar</button></div>
          <p>A borracha afeta somente esta pintura. Desfazer: Ctrl/⌘ Z · Refazer: Ctrl/⌘ Shift Z.</p>
        </div>}

        <div className={`vm-map-shell${mode ? " vm-is-drawing" : ""}`}>
          <div className="vm-canvas" ref={containerRef} onKeyDown={event => { if (event.key === "Escape" && mode) { event.preventDefault(); cancelDrawing(); } }} />
          {mode === "Brush" && <><canvas className={`vm-paint-input vm-paint-${brushTool}`} ref={paintInputRef} tabIndex={0} aria-label="Área de pintura. Arraste para pintar. Escape cancela; Control Z desfaz." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => { if (currentStrokeRef.current?.pointerId === event.pointerId) { event.preventDefault(); finishActiveStroke(event); } }} onPointerCancel={event => { if (currentStrokeRef.current?.pointerId === event.pointerId) finishActiveStroke(); }} onLostPointerCapture={event => { if (currentStrokeRef.current?.pointerId === event.pointerId) finishActiveStroke(); }} onPointerLeave={() => { if (brushCursorRef.current) brushCursorRef.current.style.display = "none"; }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); cancelDrawing(); }
            else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) { event.preventDefault(); updateBrushHistory(event.shiftKey || event.key.toLowerCase() === "y" ? redoBrush(brushHistoryRef.current) : undoBrush(brushHistoryRef.current)); }
            else if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "+", "-", "="].includes(event.key)) event.preventDefault();
          }} /><div ref={brushCursorRef} className={`vm-brush-cursor vm-cursor-${brushTool}`} aria-hidden="true" /></>}
          {!mapReady && !mapError && <div className="vm-map-loading"><LoaderCircle size={24} className="vm-spin" aria-hidden="true" /><span>Carregando mapa…</span></div>}
          {mapError && <div className="vm-map-loading vm-map-failed"><MapPin size={28} aria-hidden="true" /><p>{mapError}</p><button type="button" className="vm-button vm-button-primary" onClick={() => setBoot(current => current + 1)}>Tentar novamente</button></div>}
        </div>
        <div className="vm-map-footer"><span>{filtered.length} {filtered.length === 1 ? "registro no mapa" : "registros no mapa"}</span><span>{mode === "Brush" ? "Navegação pausada até confirmar ou cancelar" : "Arraste para explorar · use + e − para aproximar"}</span></div>
        <div className="vm-map-legend" aria-label="Cores das visitas">{STATUS_KEYS.map(status => <span className={`vm-${STATUS[status].className}`} key={status}><i />{STATUS[status].label}</span>)}</div>
        <div className="vm-plate-legend" aria-label="Placas cadastradas no mapa"><span><QrCode size={14} aria-hidden="true" />{locatedPlates.filter(loja => loja.active).length} {locatedPlates.filter(loja => loja.active).length === 1 ? "placa ativa" : "placas ativas"}</span><span className="vm-plate-legend-paused"><QrCode size={14} aria-hidden="true" />{locatedPlates.filter(loja => !loja.active).length} {locatedPlates.filter(loja => !loja.active).length === 1 ? "placa pausada" : "placas pausadas"}</span>{unlocatedPlateCount > 0 && <span className="vm-plate-legend-missing">{unlocatedPlateCount} {unlocatedPlateCount === 1 ? "placa sem localização" : "placas sem localização"}</span>}</div>
        {tileError && <div className="vm-tile-error" role="status">Algumas ruas não carregaram. Confira a conexão.<button type="button" onClick={() => { setTileError(false); tileLayerRef.current?.redraw(); }}>Recarregar ruas</button></div>}
      </div>

      {draft && <aside className="vm-editor-card">
        <form onSubmit={saveVisit}>
          <div className="vm-editor-heading"><div><p className="vm-eyebrow">{draft.id ? "EDITAR REGISTRO" : "NOVO REGISTRO"}</p><h3>{GEOMETRY_LABEL[draft.geometry.type]} no mapa</h3></div><button type="button" className="vm-icon-button" aria-label="Fechar edição" onClick={() => { cancelDrawing(); setDraft(null); }} disabled={saving}><X size={19} aria-hidden="true" /></button></div>
          <label htmlFor={`${formId}-title`}>Nome do local ou da região<input id={`${formId}-title`} ref={titleRef} required maxLength={100} value={draft.title} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="Ex.: Padarias do centro" disabled={saving} /></label>
          <div className="vm-form-row"><label htmlFor={`${formId}-status`}>Situação<select id={`${formId}-status`} value={draft.status} onChange={event => setDraft(current => current ? { ...current, status: event.target.value as VisitStatus } : current)} disabled={saving}>{STATUS_KEYS.map(status => <option value={status} key={status}>{STATUS[status].label}</option>)}</select></label><label htmlFor={`${formId}-date`}>Data<input type="date" id={`${formId}-date`} required value={draft.visitedAt} onChange={event => setDraft(current => current ? { ...current, visitedAt: event.target.value } : current)} disabled={saving} /></label></div>
          <label htmlFor={`${formId}-address`}>Endereço ou referência <span className="vm-optional">opcional</span><input id={`${formId}-address`} maxLength={300} value={draft.address} onChange={event => setDraft(current => current ? { ...current, address: event.target.value } : current)} placeholder="Rua, bairro ou ponto de referência" disabled={saving} /></label>
          <label htmlFor={`${formId}-notes`}>Anotações <span className="vm-optional">opcional</span><textarea id={`${formId}-notes`} rows={4} maxLength={2000} value={draft.notes} onChange={event => setDraft(current => current ? { ...current, notes: event.target.value } : current)} placeholder="Com quem conversou, como foi a visita e o próximo passo…" disabled={saving} /><span className="vm-character-count">{draft.notes.length}/2000</span></label>
          <div className="vm-geometry-summary"><GeometryIcon type={draft.geometry.type} /><span>{GEOMETRY_LABEL[draft.geometry.type]}</span><button type="button" onClick={() => draft.geometry.type === "Point" ? startPoint(true) : draft.geometry.type === "Streets" ? startStreets(true) : startBrush(true)} disabled={saving || Boolean(mode)}>{draft.geometry.type === "Brush" ? "Continuar pintura" : draft.geometry.type === "Streets" ? "Alterar ruas" : "Redesenhar"}</button></div>
          {mode && <p className="vm-editor-hint">Conclua ou cancele o desenho no mapa para salvar.</p>}
          <div className="vm-form-actions"><button className="vm-button vm-button-primary" type="submit" disabled={saving || Boolean(mode) || Boolean(busyId)}>{saving ? <LoaderCircle className="vm-spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}{saving ? "Salvando…" : draft.id ? "Salvar alterações" : "Salvar registro"}</button><button className="vm-button vm-button-quiet" type="button" onClick={() => { cancelDrawing(); setDraft(null); }} disabled={saving}>Cancelar</button></div>
        </form>
      </aside>}
    </div>

    <div className="vm-records">
      <div className="fieldwork-records-top"><div className="vm-records-heading"><div><span className="fieldwork-section-label">HISTÓRICO NO TERRITÓRIO</span><h3>Diário de visitas <span>{filtered.length}</span></h3></div></div>
        <div className="fieldwork-status-strip" aria-label={`${activeCount} registros em uso`}>
          {STATUS_KEYS.map(status => <button type="button" className={`fieldwork-status vm-${STATUS[status].className}${statusFilter === status ? " is-selected" : ""}`} key={status} onClick={() => setStatusFilter(current => current === status ? "all" : status)} aria-pressed={statusFilter === status}><span className="vm-dot" /><span>{STATUS[status].plural}</span><b>{visits.filter(visit => !visit.archived && visit.status === status).length}</b></button>)}
        </div>
      </div>
      <div className="vm-filters">
        <label className="vm-search"><span>Buscar nos registros</span><div><Search size={17} aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Loja, endereço ou anotação" /></div></label>
        <label><span>Situação</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as VisitStatus | "all")}><option value="all">Todas as situações</option>{STATUS_KEYS.map(status => <option value={status} key={status}>{STATUS[status].label}</option>)}</select></label>
        <label><span>Exibir</span><select value={archiveFilter} onChange={event => setArchiveFilter(event.target.value as "active" | "archived" | "all")}><option value="active">Em uso</option><option value="archived">Arquivados</option><option value="all">Todos os registros</option></select></label>
        <label><span>Data</span><input type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} aria-label="Filtrar registros por data" /></label>
        {hasFilters && <button type="button" className="vm-clear-filters" onClick={clearFilters}>Limpar filtros</button>}
      </div>
      {loading ? <div className="vm-records-empty"><LoaderCircle size={24} className="vm-spin" aria-hidden="true" /><p>Carregando suas visitas…</p></div> : !filtered.length ? <div className="vm-records-empty"><MapPin size={28} aria-hidden="true" /><h4>{hasFilters ? "Nenhum registro com esses filtros" : "Seu mapa começa aqui"}</h4><p>{hasFilters ? "Tente outra busca ou limpe os filtros para ver mais locais." : "Marque sua primeira loja e guarde o resultado da conversa."}</p>{hasFilters ? <button type="button" className="vm-button vm-button-quiet" onClick={clearFilters}>Limpar filtros</button> : <button type="button" className="vm-button vm-button-primary" onClick={() => startPoint()} disabled={!mapReady || mode === "Brush"}><Plus size={17} aria-hidden="true" />Marcar primeira loja</button>}</div> : <>
        <div className="vm-record-grid">{visibleRows.map(visit => <article className={`vm-record${visit.archived ? " vm-record-archived" : ""}`} key={visit.id}>
          <div className={`fieldwork-record-date vm-${STATUS[visit.status].className}`}><GeometryIcon type={visit.geometry.type} /><time dateTime={visit.visitedAt}>{displayDate(visit.visitedAt)}</time><span>{GEOMETRY_LABEL[visit.geometry.type]}</span></div>
          <div className="fieldwork-record-body"><div className="fieldwork-record-title"><button type="button" className="vm-record-name" onClick={() => focusGeometry(visit.geometry)} disabled={mode === "Brush"} title={`Encontrar ${visit.title} no mapa`}>{visit.title}</button><span className={`vm-badge vm-${STATUS[visit.status].className}`}>{STATUS[visit.status].label}</span>{visit.archived && <span className="vm-archived-label">Arquivado</span>}</div>{visit.address && <p className="vm-record-address"><MapPin size={13} aria-hidden="true" />{visit.address}</p>}{visit.notes && <p className="vm-record-notes">{visit.notes}</p>}</div>
          <div className="vm-record-actions"><button type="button" className="vm-record-locate" onClick={() => focusGeometry(visit.geometry)} disabled={!mapReady || mode === "Brush"}><Focus size={14} aria-hidden="true" />Ver no mapa</button><button type="button" onClick={() => editVisit(visit)} disabled={saving || Boolean(busyId) || mode === "Brush"}><Pencil size={14} aria-hidden="true" />Editar</button><button type="button" onClick={() => void toggleArchived(visit)} disabled={saving || Boolean(busyId) || mode === "Brush"}>{busyId === visit.id ? <LoaderCircle size={14} className="vm-spin" aria-hidden="true" /> : visit.archived ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}{visit.archived ? "Restaurar" : "Arquivar"}</button></div>
        </article>)}</div>
        {pages > 1 && <nav className="vm-pagination" aria-label="Páginas de registros"><span>Página {currentPage} de {pages}</span><div><button type="button" className="vm-button vm-button-quiet" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}><ChevronLeft size={17} aria-hidden="true" />Anterior</button><button type="button" className="vm-button vm-button-quiet" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pages}>Próxima<ChevronRight size={17} aria-hidden="true" /></button></div></nav>}
      </>}
    </div>
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Layers3, Check, CheckCircle2, Copy, ExternalLink, FileImage, FileText, Globe2, Link2, LoaderCircle, LocateFixed, LockKeyhole, LogOut, MapPin, MapPinned, Package, Pause, Play, Plus, Printer, QrCode, RefreshCw, Search, Settings2, SmartphoneNfc, Store, X } from "lucide-react";
import { PlaquePreview } from "./components/plaquinha";
import { EstablishmentRecord } from "./components/establishment-record";
import { VisitMap } from "./components/visit-map";
import { RegistrationLocationMap } from "./components/registration-location-map";
import { ThemeToggle } from "./components/theme-toggle";
import { downloadQrSvg, downloadQrPng, downloadPlaquePdf, downloadA4Pdf, downloadBatchA4Pdf, downloadPlaquePng, downloadBatchPlaquePngs, PLAQUE_SIZE_CM, type PrintPlaque } from "./lib/print";
import type { Loja } from "./lib/types";
import { initialJoinedAt, joinedAtForSave, manualFormFields, initialReviewCount, shouldAutoLocate } from "./lib/store-form";
import { hasPlateLocation, plateLocationLabel } from "./lib/plate-location";
import { isChunkLoadError } from "./lib/chunk-load-error";
import { rememberPrintSelection, takePrintSelection } from "./lib/print-recovery";
import "./crm.css";
import "./plate-locations.css";

type View = "lojas" | "impressao" | "mapa" | "configuracao";
type Modal = { kind: "batch" } | { kind: "store"; loja: Loja };
type Notice = { message: string; kind: "success" | "error" };
type ResolvedLink = { sourceUrl: string; targetUrl: string; converted: boolean; destinationKind: "review" | "saved" };
type CrmFields = { joinedAt: string; initialReviews: string; currentReviews: string; ownerName: string; ownerPhone: string; businessPhone: string; address: string; neighborhood: string; notes: string; nextContactAt: string };
type FormLocation = { latitude: number | null; longitude: number | null; source: "saved" | "gps" | null };
const emptyCrm = (): CrmFields => ({ joinedAt: "", initialReviews: "", currentReviews: "", ownerName: "", ownerPhone: "", businessPhone: "", address: "", neighborhood: "", notes: "", nextContactAt: "" });
const DOMAIN = "placas.guirab.com.br";
const PRINT_BATCH_LIMIT = 50;
const isAvailable = (loja: Loja) => !loja.targetUrl.trim();
function plateName(loja: Loja) { const number = loja.plateNumber ?? (/^[1-9][0-9]{0,8}$/.test(loja.code) ? Number(loja.code) : null); return number != null ? `Placa ${String(number).padStart(3, "0")}` : "Placa"; }
function plateLabel(loja: Loja) { return `${plateName(loja)} · ${loja.code}`; }
function officialLink(code: string) { return `https://${DOMAIN}/r/${encodeURIComponent(code)}`; }
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  let payload: T & { error?: string; message?: string };
  try { payload = await response.json(); } catch { throw new Error("O servidor não respondeu como esperado. Tente novamente."); }
  if (!response.ok) throw new Error(payload.error || payload.message || "Não foi possível concluir. Tente novamente.");
  return payload;
}
function StatusBadge({ loja }: { loja: Loja }) {
  const available = isAvailable(loja);
  return <span className={`status-badge ${available ? "available" : loja.active ? "active" : "paused"}`}><i />{available ? "Disponível" : loja.active ? "Ativa" : "Pausada"}</span>;
}
function ExportButton({ icon, title, detail, disabled, working, onClick }: { icon: ReactNode; title: string; detail: string; disabled: boolean; working: boolean; onClick: () => void }) {
  return <button className="g-export" disabled={disabled || working} onClick={onClick}><span className="g-export-icon">{working ? <LoaderCircle className="spin" size={21} /> : icon}</span><span><strong>{title}</strong><small>{detail}</small></span><ArrowDownToLine size={17} /></button>;
}

export default function Dashboard({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [view, setView] = useState<View>("lojas");
  const [printMode, setPrintMode] = useState<"batch" | "single">("batch");
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [view]);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [mapPlateId, setMapPlateId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [origin, setOrigin] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [crm, setCrm] = useState<CrmFields>(emptyCrm);
  const [formLocation, setFormLocation] = useState<FormLocation>({ latitude: null, longitude: null, source: null });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [resolvedLink, setResolvedLink] = useState<ResolvedLink | null>(null);
  const [resolvingLink, setResolvingLink] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [domainStatus, setDomainStatus] = useState("loading");
  const [loggingOut, setLoggingOut] = useState(false);
  const [migratingCodes, setMigratingCodes] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const initialInputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);
  const resolveVersionRef = useRef(0);
  const resolvedLinkRef = useRef<ResolvedLink | null>(null);
  const resolveRequestRef = useRef<{ sourceUrl: string; controller: AbortController; promise: Promise<ResolvedLink | null> } | null>(null);
  const crmRef = useRef<CrmFields>(crm);
  const nameValueRef = useRef(name);
  const manualEditsRef = useRef(new Set<keyof CrmFields | "name">());
  const locationRef = useRef<FormLocation>(formLocation);
  const locationVersionRef = useRef(0);
  const locationRequestRef = useRef<AbortController | null>(null);
  const locationPendingRef = useRef(false);
  savingRef.current = saving;

  const selected = lojas.find((loja) => loja.id === selectedId) || null;
  const record = lojas.find((loja) => loja.id === recordId) || null;
  const checked = lojas.filter((loja) => checkedIds.includes(loja.id));
  const availableCount = lojas.filter(isAvailable).length;
  const linkedCount = lojas.length - availableCount;
  const activeCount = lojas.filter((loja) => !isAvailable(loja) && loja.active).length;
  const capacity = Math.max(0, 200 - lojas.length);
  const maxBatch = Math.min(50, capacity);
  const visible = lojas.filter((loja) => {
    const matchesSearch = !search || `${loja.name} ${loja.code} ${plateLabel(loja)} ${loja.address} ${loja.neighborhood}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"));
    const available = isAvailable(loja);
    const matchesStatus = filter === "all" || (filter === "available" ? available : filter === "linked" ? !available : !available && loja.active === (filter === "active"));
    return matchesSearch && matchesStatus;
  });
  const allVisibleChecked = visible.length > 0 && visible.every((loja) => checkedIds.includes(loja.id));
  const someVisibleChecked = visible.some((loja) => checkedIds.includes(loja.id));
  const officialUrl = selected ? officialLink(selected.code) : "";
  const testUrl = selected && origin ? `${origin}/r/${encodeURIComponent(selected.code)}` : "";
  const selectedLabel = selected ? plateLabel(selected) : "";

  const notify = useCallback((message: string, kind: Notice["kind"] = "success") => setNotice({ message, kind }), []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const result = await api<{ lojas: Loja[] }>("/api/lojas");
      setLojas(result.lojas);
      setSelectedId((old) => result.lojas.some((loja) => loja.id === old) ? old : result.lojas[0]?.id || null);
      setCheckedIds((old) => old.filter((id) => result.lojas.some((loja) => loja.id === id)));
    } catch (failure) { setLoadError(failure instanceof Error ? failure.message : "Não foi possível carregar suas placas."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const resumed = takePrintSelection(window.sessionStorage);
      if (resumed) { setView(resumed.view); setPrintMode(resumed.printMode); setSelectedId(resumed.selectedId); setCheckedIds(resumed.checkedIds); notify("Painel atualizado. As placas selecionadas foram mantidas; clique em imprimir novamente."); }
    } catch { /* Ordinary loading remains available when browser storage is disabled. */ }
    void load();
    void api<{ domainStatus: string }>("/api/config").then((config) => setDomainStatus(config.domainStatus || "unverified")).catch(() => setDomainStatus("unverified"));
  }, [load, notify]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 6500); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleChecked && !allVisibleChecked; }, [allVisibleChecked, someVisibleChecked, view, loading]);
  useEffect(() => {
    if (!modal) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => initialInputRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) { event.preventDefault(); setModal(null); }
      if (event.key !== "Tab") return;
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], select:not([disabled]), [tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKey); previousFocus.current?.focus(); resolveVersionRef.current += 1; resolveRequestRef.current?.controller.abort(); resolveRequestRef.current = null; locationVersionRef.current += 1; locationRequestRef.current?.abort(); locationPendingRef.current = false; };
  }, [modal]);

  function resetLinkResolution() {
    resolveVersionRef.current += 1;
    resolveRequestRef.current?.controller.abort();
    resolveRequestRef.current = null;
    resolvedLinkRef.current = null;
    setResolvedLink(null); setResolveError(""); setResolvingLink(false);
  }
  function openBatch() { resetLinkResolution(); setQuantity(String(Math.min(10, maxBatch))); setFormError(""); setModal({ kind: "batch" }); }
  function openRecord(loja: Loja) { setSelectedId(loja.id); setRecordId(loja.id); }
  function showPlateOnMap(loja: Loja) { setSelectedId(loja.id); setMapPlateId(loja.id); setView("mapa"); }
  function openStore(loja: Loja) {
    resetLinkResolution(); setRecordId(null); manualEditsRef.current.clear();
    const initialName = isAvailable(loja) && [plateName(loja), plateLabel(loja)].includes(loja.name) ? "" : loja.name;
    nameValueRef.current = initialName; setName(initialName); setTargetUrl(loja.targetUrl); setFormError("");
    if (loja.targetUrl.trim()) {
      const saved: ResolvedLink = { sourceUrl: loja.targetUrl.trim(), targetUrl: loja.targetUrl.trim(), converted: false, destinationKind: "saved" };
      resolvedLinkRef.current = saved; setResolvedLink(saved);
    }
    const initialCrm = { joinedAt: initialJoinedAt(loja), initialReviews: loja.initialReviews == null ? "" : String(loja.initialReviews), currentReviews: loja.currentReviews == null ? "" : String(loja.currentReviews), ownerName: loja.ownerName || "", ownerPhone: loja.ownerPhone || "", businessPhone: loja.businessPhone || "", address: loja.address || "", neighborhood: loja.neighborhood || "", notes: loja.notes || "", nextContactAt: loja.nextContactAt?.slice(0, 10) || "" };
    crmRef.current = initialCrm; setCrm(initialCrm);
    locationVersionRef.current += 1; locationRequestRef.current?.abort(); locationPendingRef.current = false; setLocating(shouldAutoLocate(loja)); setLocationError("");
    const initialLocation: FormLocation = { latitude: loja.latitude ?? null, longitude: loja.longitude ?? null, source: loja.latitude != null && loja.longitude != null ? "saved" : null };
    locationRef.current = initialLocation; setFormLocation(initialLocation);
    setModal({ kind: "store", loja });
  }
  function updateRecord(loja: Loja) { setLojas((old) => old.map((item) => item.id === loja.id ? loja : item)); }
  function updateName(value: string) { manualEditsRef.current.add("name"); nameValueRef.current = value; setName(value); }
  function updateCrm(field: keyof CrmFields, value: string) { manualEditsRef.current.add(field); const next = { ...crmRef.current, [field]: value }; crmRef.current = next; setCrm(next); }
  const useMyLocation = useCallback(async () => {
    if (locationPendingRef.current || savingRef.current) return;
    if (!navigator.geolocation) { setLocating(false); setLocationError("Este navegador não oferece localização. Preencha o endereço manualmente."); return; }
    const version = ++locationVersionRef.current;
    locationRequestRef.current?.abort();
    const controller = new AbortController(); locationRequestRef.current = controller;
    locationPendingRef.current = true;
    setLocating(true); setLocationError("");
    const timeout = window.setTimeout(() => controller.abort(new Error("A localização demorou a responder. Tente novamente ou preencha o endereço manualmente.")), 25_000);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
      });
      if (version !== locationVersionRef.current || controller.signal.aborted) return;
      const location: FormLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, source: "gps" };
      locationRef.current = location; setFormLocation(location);
      const result = await api<{ address: string; neighborhood: string; latitude: number; longitude: number; displayName: string; source: "OpenStreetMap" }>("/api/location/reverse", { method: "POST", body: JSON.stringify({ latitude: location.latitude, longitude: location.longitude }), signal: controller.signal });
      if (version !== locationVersionRef.current || controller.signal.aborted) return;
      const next = { ...crmRef.current };
      if (result.address && !next.address.trim() && !manualEditsRef.current.has("address")) next.address = result.address.slice(0, 300);
      if (result.neighborhood && !next.neighborhood.trim() && !manualEditsRef.current.has("neighborhood")) next.neighborhood = result.neighborhood.slice(0, 100);
      crmRef.current = next; setCrm(next);
    } catch (failure) {
      if (version !== locationVersionRef.current) return;
      const code = typeof failure === "object" && failure && "code" in failure ? failure.code : null;
      setLocationError(code === 1 ? "Permissão de localização negada. Você pode preencher o endereço manualmente." : code === 3 ? "A localização demorou a responder. Tente novamente ou preencha o endereço manualmente." : failure instanceof Error ? failure.message : "Não foi possível obter o endereço. A entrada manual continua disponível.");
    } finally { window.clearTimeout(timeout); if (version === locationVersionRef.current) { locationPendingRef.current = false; setLocating(false); } }
  }, []);

  useEffect(() => {
    if (modal?.kind !== "store" || !shouldAutoLocate(modal.loja)) return;
    const timer = window.setTimeout(() => void useMyLocation(), 0);
    return () => window.clearTimeout(timer);
  }, [modal, useMyLocation]);
  async function migrateCodes() {
    if (migratingCodes) return;
    setMigratingCodes(true);
    try { const result = await api<{ migrated: number; lojas: Loja[] }>("/api/placas/codigos", { method: "POST", body: "{}" }); await load(); notify(result.migrated ? `${result.migrated} código${result.migrated === 1 ? " atualizado" : "s atualizados"}. Os endereços antigos continuam funcionando.` : "Todos os códigos já estão atualizados."); }
    catch (failure) { notify(failure instanceof Error ? failure.message : "Não foi possível atualizar os códigos.", "error"); }
    finally { setMigratingCodes(false); }
  }
  function changeTarget(value: string) {
    resetLinkResolution(); setTargetUrl(value); setFormError("");
  }

  async function resolveLink(value: string): Promise<ResolvedLink | null> {
    const sourceUrl = value.trim();
    if (!sourceUrl || modal?.kind !== "store") return null;
    if (sourceUrl === modal.loja.targetUrl.trim()) {
      const saved: ResolvedLink = { sourceUrl, targetUrl: sourceUrl, converted: false, destinationKind: "saved" };
      resolvedLinkRef.current = saved; setResolvedLink(saved); setResolveError("");
      return saved;
    }
    if (resolvedLinkRef.current?.sourceUrl === sourceUrl) return resolvedLinkRef.current;
    if (resolveRequestRef.current?.sourceUrl === sourceUrl) return resolveRequestRef.current.promise;
    resolveRequestRef.current?.controller.abort();
    const version = ++resolveVersionRef.current;
    const controller = new AbortController();
    setResolvingLink(true); setResolveError("");
    const promise = (async (): Promise<ResolvedLink | null> => {
      try {
        const result = await api<{ targetUrl: string; converted: boolean; destinationKind: "review" }>("/api/links/resolve", { method: "POST", body: JSON.stringify({ url: sourceUrl }), signal: controller.signal });
        if (version !== resolveVersionRef.current || controller.signal.aborted) return null;
        let validResult = false;
        try { validResult = result.destinationKind === "review" && new URL(result.targetUrl).protocol === "https:"; } catch { /* The server must return a usable HTTPS review link. */ }
        if (!validResult) throw new Error("Não foi possível preparar um link de avaliação válido. Cole o link fornecido pelo Google.");
        const resolved = { ...result, sourceUrl };
        resolvedLinkRef.current = resolved;
        setResolvedLink(resolved);
        return resolved;
      } catch (failure) {
        if (version !== resolveVersionRef.current || controller.signal.aborted) return null;
        setResolveError(failure instanceof Error ? failure.message : "Não foi possível identificar a avaliação. Cole o link de avaliação fornecido pelo Google.");
        return null;
      } finally {
        if (version === resolveVersionRef.current) { setResolvingLink(false); resolveRequestRef.current = null; }
      }
    })();
    resolveRequestRef.current = { sourceUrl, controller, promise };
    return promise;
  }
  function toggleChecked(id: string) { if (!checkedIds.includes(id) && checkedIds.length >= PRINT_BATCH_LIMIT) { notify("Selecione até 50 placas por arquivo. Baixe este lote antes de preparar o próximo.", "error"); return; } setCheckedIds((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]); }
  function toggleAllVisible() { if (allVisibleChecked) { setCheckedIds((old) => old.filter((id) => !visible.some((loja) => loja.id === id))); return; } const next = Array.from(new Set([...checkedIds, ...visible.map((loja) => loja.id)])); if (next.length > PRINT_BATCH_LIMIT) notify("Foram selecionadas as primeiras 50 placas. Cada arquivo comporta até 50."); setCheckedIds(next.slice(0, PRINT_BATCH_LIMIT)); }

  async function generateBatch(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < 1 || amount > maxBatch) { setFormError(`Escolha uma quantidade entre 1 e ${maxBatch}.`); return; }
    setSaving(true); setFormError("");
    try {
      const result = await api<{ lojas: Loja[] }>("/api/placas/lote", { method: "POST", body: JSON.stringify({ quantity: amount }) });
      setLojas((old) => [...result.lojas, ...old]);
      setSelectedId(result.lojas[0]?.id || null);
      setCheckedIds(result.lojas.map((loja) => loja.id));
      setSearch(""); setFilter("all"); setView("lojas"); setModal(null);
      notify(`${result.lojas.length} placa${result.lojas.length === 1 ? " gerada e selecionada" : "s geradas e selecionadas"}. Imprima agora e configure as lojas após a venda.`);
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "Não foi possível gerar as placas."); }
    finally { setSaving(false); }
  }

  async function saveStore(event: FormEvent) {
    event.preventDefault(); if (modal?.kind !== "store" || saving) return;
    if (locating || locationPendingRef.current) { setFormError("Aguarde a localização terminar. Se não for possível obtê-la, você poderá salvar os dados manualmente."); return; }
    const sourceUrl = targetUrl.trim(), original = modal.loja;
    if (!sourceUrl && original.targetUrl) { setFormError("Para liberar uma placa vinculada, use Redefinir placa na ficha do estabelecimento."); targetInputRef.current?.focus(); return; }
    setSaving(true); setFormError("");
    try {
      const resolved = sourceUrl ? await resolveLink(sourceUrl) : null;
      if (sourceUrl && !resolved) { window.setTimeout(() => targetInputRef.current?.focus(), 0); return; }
      const cleanName = nameValueRef.current.trim() || (sourceUrl ? "" : original.name);
      if (!cleanName) { setFormError("Informe o nome da loja."); window.setTimeout(() => initialInputRef.current?.focus(), 0); return; }
      const fields = crmRef.current;
      const initialReviews = initialReviewCount(original, fields, Boolean(sourceUrl));
      const currentReviews = fields.currentReviews.trim() === "" ? null : Number(fields.currentReviews);
      if ([initialReviews, currentReviews].some((value) => value != null && (!Number.isInteger(value) || value < 0 || value > 10_000_000))) { setFormError("As contagens precisam ser números inteiros entre 0 e 10.000.000, ou ficar em branco."); return; }
      const joinedAt = joinedAtForSave(original, fields.joinedAt, manualEditsRef.current.has("joinedAt"), Boolean(sourceUrl));
      const result = await api<{ loja: Loja }>(`/api/lojas/${encodeURIComponent(original.id)}`, { method: "PATCH", body: JSON.stringify({ name: cleanName, ...(sourceUrl && sourceUrl !== original.targetUrl.trim() ? { targetUrl: resolved?.targetUrl || sourceUrl, targetMode: "review" } : {}), joinedAt, initialReviews, ...manualFormFields(fields, locationRef.current), ownerName: fields.ownerName.trim(), ownerPhone: fields.ownerPhone.trim(), notes: fields.notes.trim(), nextContactAt: fields.nextContactAt || null }) });
      setLojas((old) => old.map((loja) => loja.id === result.loja.id ? result.loja : loja));
      setSelectedId(result.loja.id); setModal(null); setRecordId(result.loja.id);
      notify(isAvailable(original) && result.loja.targetUrl ? `${plateLabel(original)} configurada e ativada. O QR impresso já leva à loja.` : "Cadastro atualizado. O endereço permanente da placa foi preservado.");
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "Não foi possível configurar a loja."); }
    finally { setSaving(false); }
  }

  async function toggle(loja: Loja) {
    if (mutatingId || isAvailable(loja)) return;
    setMutatingId(loja.id);
    try {
      const result = await api<{ loja: Loja }>(`/api/lojas/${encodeURIComponent(loja.id)}`, { method: "PATCH", body: JSON.stringify({ active: !loja.active }) });
      setLojas((old) => old.map((item) => item.id === loja.id ? result.loja : item));
      notify(result.loja.active ? "Plaquinha reativada." : "Plaquinha pausada. O link foi preservado.");
    } catch (failure) { notify(failure instanceof Error ? failure.message : "Não foi possível alterar o status.", "error"); }
    finally { setMutatingId(null); }
  }

  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); notify(`${label} copiado.`); } catch { notify("Não foi possível copiar automaticamente. Selecione o endereço e copie pelo teclado.", "error"); } }
  async function logout() { if (loggingOut) return; setLoggingOut(true); try { const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); if (!response.ok) throw new Error("Não foi possível sair. Tente novamente."); window.location.href = "/login"; } catch (failure) { notify(failure instanceof Error ? failure.message : "Não foi possível sair. Tente novamente.", "error"); setLoggingOut(false); } }

  function recoverPrintFailure(failure: unknown): boolean {
    if (!isChunkLoadError(failure)) return false;
    let canReload = false;
    if (!modal) {
      try { canReload = rememberPrintSelection(window.sessionStorage, { view: view === "impressao" ? "impressao" : "lojas", selectedId, checkedIds, printMode }); } catch { /* Keep the page if its selection cannot be retained. */ }
    }
    if (canReload) window.location.reload();
    else notify("Não foi possível carregar a impressão. Atualize esta página e tente imprimir novamente.", "error");
    return true;
  }

  async function download(kind: "svg" | "png" | "photo" | "plaque" | "a4") {
    if (!selected || exporting) return;
    setExporting(kind);
    const stem = `placa-${selected.plateNumber != null ? String(selected.plateNumber).padStart(3, "0") : /^[1-9][0-9]{0,8}$/.test(selected.code) ? selected.code.padStart(3, "0") : selected.code}`;
    try {
      if (kind === "svg") await downloadQrSvg(officialUrl, `${stem}-qr.svg`);
      if (kind === "png") await downloadQrPng(officialUrl, `${stem}-qr.png`);
      if (kind === "photo") await downloadPlaquePng(officialUrl, `${stem}-arte.png`, selectedLabel);
      if (kind === "plaque") await downloadPlaquePdf(officialUrl, `${stem}.pdf`, selectedLabel);
      if (kind === "a4") await downloadA4Pdf(officialUrl, `${stem}-2-copias-A4.pdf`, selectedLabel);
      notify(`${selectedLabel}: arquivo preparado com seu link permanente.`);
    } catch (failure) { if (!recoverPrintFailure(failure)) notify(failure instanceof Error ? failure.message : "Não foi possível gerar o arquivo. Tente novamente.", "error"); }
    finally { setExporting(null); }
  }

  async function downloadBatch() {
    if (!checked.length || exporting) return;
    setExporting("batch");
    const items: PrintPlaque[] = checked.map((loja) => ({ url: officialLink(loja.code), label: plateLabel(loja) }));
    try { await downloadBatchA4Pdf(items, "placas-selecionadas-A4.pdf"); notify(`${items.length} placa${items.length === 1 ? " pronta" : "s prontas"} em ${Math.ceil(items.length / 2)} folha${items.length > 2 ? "s" : ""} A4.`); }
    catch (failure) { if (!recoverPrintFailure(failure)) notify(failure instanceof Error ? failure.message : "Não foi possível gerar o lote. Tente novamente.", "error"); }
    finally { setExporting(null); }
  }

  async function downloadBatchImages() {
    if (!checked.length || exporting) return;
    setExporting("batch-images");
    const items: PrintPlaque[] = checked.map((loja) => ({ url: officialLink(loja.code), label: plateLabel(loja) }));
    try { await downloadBatchPlaquePngs(items, "placas-selecionadas-imagens.zip"); notify(`${items.length} ${items.length === 1 ? "imagem completa pronta" : "imagens completas prontas"} no arquivo ZIP.`); }
    catch (failure) { if (!recoverPrintFailure(failure)) notify(failure instanceof Error ? failure.message : "Não foi possível gerar as imagens. Tente novamente.", "error"); }
    finally { setExporting(null); }
  }

  const domainActive = domainStatus === "active";
  const domainLabel = domainActive ? "Conectado" : domainStatus === "loading" ? "Verificando conexão…" : domainStatus === "pending" ? "Conexão pendente" : "Conexão não verificada";
  const domainDescription = domainActive ? "O subdomínio está conectado com HTTPS ativo. Use este endereço nas plaquinhas e na gravação das tags NFC." : domainStatus === "loading" ? "Estamos conferindo a conexão do domínio." : domainStatus === "pending" ? "O domínio precisa apontar para a hospedagem deste site. As instruções de DNS são fornecidas ao conectar o subdomínio no serviço de hospedagem." : "Não foi possível verificar o domínio neste momento. Atualize o painel para consultar novamente.";

  const totalScans = lojas.reduce((sum, loja) => sum + Number(loja.scans || 0), 0);
  const navItems = [
    { id: "lojas" as View, title: "Placas", icon: <Layers3 size={17} /> },
    { id: "impressao" as View, title: "Impressão", icon: <Printer size={17} /> },
    { id: "mapa" as View, title: "Território", icon: <MapPinned size={17} /> },
    { id: "configuracao" as View, title: "Conexões", icon: <Settings2 size={17} /> },
  ];
  return <div className="g-app"><a className="skip-link" href="#main-content">Ir para o conteúdo</a>
    <header className="g-header">
      <a href="/" className="g-wordmark" aria-label="Guirab Placas — início"><svg viewBox="0 0 38 38" fill="none" aria-hidden="true"><path d="M10 28a13 13 0 0 1 0-18m8 18a13 13 0 0 0 0-18" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><path d="M26 10a13 13 0 0 1 0 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><circle cx="14" cy="19" r="3" fill="currentColor"/></svg><span>guirab<span className="g-wordmark-divider">/</span><small>placas</small></span></a>
      <nav className="g-nav" aria-label="Navegação principal">{navItems.map(item => <button key={item.id} onClick={() => setView(item.id)} className={view === item.id ? "is-current" : ""} aria-current={view === item.id ? "page" : undefined}>{item.icon}<span>{item.title}</span></button>)}</nav>
      <div className="g-header-tools"><ThemeToggle /><button className="g-exit" onClick={() => void logout()} disabled={loggingOut} aria-label="Sair do painel" title="Sair do painel">{loggingOut ? <LoaderCircle size={17} className="spin" /> : <LogOut size={17} />}</button></div>
    </header>
    <main className={`g-main g-view-${view}`} id="main-content" tabIndex={-1}>
      {view === "lojas" && <>
        <section className="g-collection-heading">
          <div className="g-heading-copy"><span className="g-overline"><i />SEU ESPAÇO DE TRABALHO</span><h1>Seu estoque.<br /><span>Suas próximas lojas.</span></h1><p>Gere, imprima e vincule cada placa quando vender.</p></div>
          <div className="g-stock-overview"><div className="g-stock-number"><strong>{loading ? "—" : String(availableCount).padStart(2, "0")}</strong><span>placas prontas<br />para vender</span><QrCode size={35} strokeWidth={1.3} aria-hidden="true" /></div><div className="g-stock-track" role="img" aria-label={`${linkedCount} de ${lojas.length} placas vinculadas a lojas`}><span style={{width: `${lojas.length ? linkedCount / lojas.length * 100 : 0}%`}} /></div><div className="g-stock-detail"><span><i />{linkedCount} de {lojas.length} em lojas</span><span>{totalScans.toLocaleString("pt-BR")} acessos aos links</span></div></div>
        </section>
        <section className="g-inventory" aria-label="Coleção de placas">
          <div className="g-collection-bar"><div><span className="g-overline">COLEÇÃO</span><h2>Suas placas <span>{loading ? "…" : lojas.length}</span></h2></div><button className="g-btn g-btn-main" onClick={openBatch} disabled={loading || !capacity}><Plus size={18} />Gerar placas</button></div>
          <div className="g-library-tools"><div className="g-filters" aria-label="Filtrar placas">{[{id:"all",label:"Todas",count:lojas.length},{id:"available",label:"Disponíveis",count:availableCount},{id:"linked",label:"Em lojas",count:linkedCount},{id:"paused",label:"Pausadas",count:linkedCount-activeCount}].map(item => <button key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}</div><label className="g-search"><Search size={17} /><span className="sr-only">Buscar placa, loja, endereço ou bairro</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Código, loja ou bairro" />{search && <button onClick={() => setSearch("")} aria-label="Limpar busca"><X size={14} /></button>}</label></div>
          {!loading && lojas.length > 0 && !loadError && <div className="g-selection-line"><label><input ref={selectAllRef} type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} aria-label="Selecionar todas as placas exibidas" disabled={Boolean(exporting)} /><span>{checked.length ? `${checked.length} selecionadas para impressão` : "Selecionar para impressão"}</span></label><div>{checked.length > 0 && <><button className="g-text-btn" onClick={() => setCheckedIds([])} disabled={Boolean(exporting)}>Limpar</button><button className="g-btn g-btn-small" onClick={() => { setPrintMode("batch"); setView("impressao"); }}><Printer size={15} />Preparar {checked.length} placas<ArrowRight size={14} /></button></>}<button className="g-icon-btn" aria-label="Atualizar placas" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /></button></div></div>}
          {loading ? <div className="g-state" role="status"><LoaderCircle size={27} className="spin" /><h3>Organizando suas placas…</h3></div> : loadError ? <div className="g-state" role="alert"><h3>As placas não carregaram.</h3><p>{loadError}</p><button className="g-btn" onClick={() => void load()}>Tentar novamente</button></div> : !lojas.length ? <div className="g-state g-empty"><QrCode size={52} strokeWidth={1.2} /><h3>Seu primeiro lote começa aqui.</h3><p>Gere os códigos, imprima suas placas e vincule cada loja na venda.</p><button className="g-btn g-btn-main" onClick={openBatch}><Plus size={17} />Gerar primeiras placas</button></div> : !visible.length ? <div className="g-state"><Search size={30} /><h3>Nenhuma placa por aqui.</h3><p>Tente outro código ou mude os filtros.</p><button className="g-btn" onClick={() => { setSearch(""); setFilter("all"); }}>Limpar filtros</button></div> : <div className="g-ticket-grid">{visible.map(loja => <article key={loja.id} className={`g-ticket${checkedIds.includes(loja.id) ? " is-selected" : ""}${!isAvailable(loja) ? " is-linked" : ""}`}>
            <div className="g-ticket-top"><label className="g-ticket-select"><input type="checkbox" checked={checkedIds.includes(loja.id)} onChange={() => toggleChecked(loja.id)} aria-label={`Selecionar ${plateLabel(loja)} para impressão`} disabled={Boolean(exporting)} /><span>{plateName(loja)}</span></label><StatusBadge loja={loja} /></div>
            <button className="g-ticket-identity" onClick={() => openRecord(loja)} aria-label={`Abrir ficha de ${plateLabel(loja)}${isAvailable(loja) ? "" : `, ${loja.name}`}`}><span className="g-ticket-code">{loja.code}</span><ArrowUpRight size={22} strokeWidth={1.4} /><span className="g-ticket-business">{isAvailable(loja) ? "Sem estabelecimento vinculado" : loja.name}</span></button>
            <div className="g-ticket-perforation"><i /><span>QR CODE + NFC</span><Link2 size={13} /><i /></div>
            <div className="g-ticket-bottom">{isAvailable(loja) ? <><span className="g-ticket-ready"><span className="g-ready-dot" />Pronta para vincular</span><button onClick={() => openStore(loja)} aria-label={`Configurar loja da ${plateLabel(loja)}`}><Plus size={15} />Configurar</button></> : <><div className="g-ticket-location">{hasPlateLocation(loja) ? <button onClick={() => showPlateOnMap(loja)} title={plateLocationLabel(loja)}><MapPin size={13} /><span>{plateLocationLabel(loja)}</span></button> : <span><MapPin size={13} />{plateLocationLabel(loja)}</span>}<small>{Number(loja.scans || 0).toLocaleString("pt-BR")} acessos · {loja.currentReviews == null ? "Avaliações não informadas" : `${loja.currentReviews} avaliações`}</small></div><div className="g-ticket-actions"><button className="g-icon-btn" onClick={() => openStore(loja)} aria-label={`Editar cadastro de ${plateLabel(loja)}`} title="Editar cadastro"><Settings2 size={16} /></button><button className="g-icon-btn" onClick={() => void toggle(loja)} disabled={Boolean(mutatingId)} title={loja.active ? "Pausar placa" : "Reativar placa"} aria-label={`${loja.active ? "Pausar" : "Reativar"} ${plateLabel(loja)}`}>{mutatingId === loja.id ? <LoaderCircle size={15} className="spin" /> : loja.active ? <Pause size={15} /> : <Play size={15} />}</button></div></>}</div>
          </article>)}</div>}
          <div className="g-collection-footer"><span>{visible.length} de {lojas.length} placas</span><span><LockKeyhole size={12} />Seu estoque, no seu controle.</span></div>
        </section>
        <button className="g-fieldwork-link" onClick={() => setView("mapa")}><span className="g-fieldwork-symbol"><MapPinned size={29} strokeWidth={1.4} /></span><span><strong>A próxima conexão está lá fora.</strong><small>Organize as visitas e marque os lugares por onde passou.</small></span><span className="g-fieldwork-link-label">Abrir território<ArrowUpRight size={19} /></span></button>
      </>}
      {view === "impressao" && <>
        <div className="g-page-title"><div><span className="g-overline">DA TELA PARA O BALCÃO</span><h1>Bancada de impressão.</h1><p>Uma arte, um código por placa. Seus arquivos prontos para sair.</p></div><span className="g-format-seal"><span>A4</span><small>{PLAQUE_SIZE_CM}<br />por placa</small></span></div>
        <div className="g-print-mode" aria-label="Modo de impressão"><button className={printMode === "batch" ? "is-active" : ""} onClick={() => setPrintMode("batch")} aria-pressed={printMode === "batch"}><Layers3 size={17} />Lote de placas<span>QR Codes diferentes</span></button><button className={printMode === "single" ? "is-active" : ""} onClick={() => setPrintMode("single")} aria-pressed={printMode === "single"}><QrCode size={17} />Uma placa<span>Arquivos individuais</span></button></div>
        <div className="g-print-bench"><section className="g-print-canvas" aria-label="Prévia dos arquivos"><div className="g-canvas-caption"><span><i />{printMode === "batch" ? "PRÉVIA DA PRIMEIRA FOLHA" : "PRÉVIA DA ARTE"}</span><span>{printMode === "batch" ? "297 × 210 mm" : PLAQUE_SIZE_CM}</span></div>{printMode === "batch" ? checked.length > 0 ? <><div className="g-a4-sheet">{checked.slice(0,2).map(loja => <div className="g-sheet-art" key={loja.id}><PlaquePreview url={officialLink(loja.code)} label={plateLabel(loja)} /></div>)}</div><div className="g-sheet-identities">{checked.slice(0,2).map(loja => <span key={loja.id}>{plateName(loja)}<strong>{loja.code}</strong></span>)}</div></> : <div className="g-bench-empty"><Layers3 size={46} strokeWidth={1} /><h2>Escolha o que vai para o papel.</h2><p>Selecione até 50 placas na coleção.<br />Organizamos duas diferentes em cada folha A4.</p><button className="g-btn g-btn-main" onClick={() => setView("lojas")}>Escolher placas<ArrowRight size={17} /></button></div> : selected ? <div className="g-single-art"><PlaquePreview url={officialUrl} label={selectedLabel} /></div> : <div className="g-bench-empty"><h2>Gere uma placa para começar.</h2><button className="g-btn" onClick={openBatch}>Gerar placas</button></div>}<div className="g-canvas-bottom"><span>Arte vetorial · QR individual</span><span>Imprima em tamanho real, 100%</span></div></section>
          <aside className="g-print-controls">{printMode === "batch" ? <><span className="g-overline">FILA DE IMPRESSÃO</span><h2>{String(checked.length).padStart(2,"0")}<span> placas selecionadas</span></h2><p>{checked.length ? `${Math.ceil(checked.length/2)} folha${checked.length > 2 ? "s" : ""} A4 · 2 placas por folha` : "Sua fila está vazia."}</p><div className="g-print-queue">{checked.map(loja => <div key={loja.id}><strong>{loja.code}</strong><span>{plateName(loja)}</span><button onClick={() => toggleChecked(loja.id)} disabled={Boolean(exporting)} aria-label={`Retirar ${plateLabel(loja)} da seleção`}><X size={14} /></button></div>)}</div><button className="g-text-btn g-choose" onClick={() => setView("lojas")}>Alterar seleção<ArrowRight size={15} /></button><button className="g-btn g-btn-main g-full" onClick={() => void downloadBatch()} disabled={!checked.length || Boolean(exporting)}>{exporting === "batch" ? <LoaderCircle size={17} className="spin" /> : <ArrowDownToLine size={17} />}Baixar PDF para impressão</button><button className="g-btn g-full" onClick={() => void downloadBatchImages()} disabled={!checked.length || Boolean(exporting)}>{exporting === "batch-images" ? <LoaderCircle size={17} className="spin" /> : <FileImage size={17} />}Baixar imagens · ZIP</button><small className="g-export-note">PDF vetorial. Imagens PNG em 300 dpi. A última folha pode conter uma única placa.</small></> : <><label className="g-overline" htmlFor="print-store">ESCOLHA A PLACA</label><select className="g-select" id="print-store" value={selectedId || ""} onChange={event => setSelectedId(event.target.value || null)} disabled={!lojas.length}><option value="" disabled>Selecione uma placa</option>{lojas.map(loja => <option key={loja.id} value={loja.id}>{loja.code} · {plateName(loja)}{isAvailable(loja) ? "" : ` · ${loja.name}`}</option>)}</select><div className="g-single-code">{selected?.code || "—"}<span>{selected ? isAvailable(selected) ? "Disponível para uma nova loja" : selected.name : "Nenhuma placa selecionada"}</span></div><div className="g-exports"><ExportButton title="Plaquinha individual" detail={`PDF vetorial · ${PLAQUE_SIZE_CM}`} icon={<FileText size={21} />} disabled={!selected || Boolean(exporting)} working={exporting === "plaque"} onClick={() => void download("plaque")} /><ExportButton title="2 cópias da mesma placa" detail="PDF A4 · Mesmo QR nas duas cópias" icon={<Printer size={21} />} disabled={!selected || Boolean(exporting)} working={exporting === "a4"} onClick={() => void download("a4")} /><ExportButton title="Imagem completa" detail="PNG · 300 dpi" icon={<FileImage size={21} />} disabled={!selected || Boolean(exporting)} working={exporting === "photo"} onClick={() => void download("photo")} /><ExportButton title="Somente o QR Code" detail="SVG · Arquivo vetorial" icon={<QrCode size={21} />} disabled={!selected || Boolean(exporting)} working={exporting === "svg"} onClick={() => void download("svg")} /><ExportButton title="QR Code em imagem" detail="PNG · Alta resolução" icon={<QrCode size={21} />} disabled={!selected || Boolean(exporting)} working={exporting === "png"} onClick={() => void download("png")} /></div></>}<div className={`g-domain-check${domainActive ? " is-connected" : ""}`}><Globe2 size={15} /><span>{DOMAIN}<small>{domainLabel}</small></span></div></aside></div>
        <div className="g-print-instructions"><span className="g-instruction-number">01</span><div><strong>A4 em paisagem</strong><p>O PDF já organiza as placas.</p></div><span className="g-instruction-number">02</span><div><strong>Tamanho real · 100%</strong><p>Desative “Ajustar à página”.</p></div><span className="g-instruction-number">03</span><div><strong>Confira antes de recortar</strong><p>A linha de conferência deve medir 10 cm.</p></div></div>
      </>}
      {view === "mapa" && <VisitMap lojas={lojas} focusPlateId={mapPlateId} onOpenPlate={id => { const loja = lojas.find(item => item.id === id); if (loja) openRecord(loja); }} />}
      {view === "configuracao" && <><div className="g-page-title"><div><span className="g-overline">DO FÍSICO AO DIGITAL</span><h1>Uma conexão permanente.</h1><p>O endereço fica na placa. Você escolhe para onde ele leva.</p></div></div><section className="g-connection-workspace"><div className="g-connection-label"><span className="g-overline">SEU ENDEREÇO</span><span className={`g-connected-label${domainActive ? " is-connected" : ""}`}><i />{domainLabel}</span></div><h2>{DOMAIN}</h2><p>{domainDescription}</p><div className="g-connection-route"><div><span><SmartphoneNfc size={31} strokeWidth={1.3} /><QrCode size={31} strokeWidth={1.3} /></span><strong>Sua placa</strong><small>NFC e QR Code</small></div><ArrowRight size={22} /><div><span className="g-route-domain"><Link2 size={32} strokeWidth={1.3} /></span><strong>/r/código</strong><small>Link que acompanha a placa</small></div><ArrowRight size={22} /><div><span><Store size={34} strokeWidth={1.3} /></span><strong>Avaliação da loja</strong><small>Destino editável no cadastro</small></div></div>{selected && <div className="g-test-connection"><div><label htmlFor="settings-link">Link permanente · {selectedLabel}</label><div><input id="settings-link" readOnly value={officialUrl} /><button className="g-icon-btn" onClick={() => void copy(officialUrl,"Link oficial")} aria-label="Copiar link oficial"><Copy size={16} /></button></div></div><a className="g-btn" href={testUrl || undefined} target="_blank" rel="noopener noreferrer">Testar placa<ArrowUpRight size={17} /></a></div>}</section><section className="g-access-panel"><span className="g-access-icon"><LockKeyhole size={24} /></span><div><h2>Seu painel, reservado.</h2><p>Entre com sua senha para administrar. Os clientes abrem os QR Codes sem login.</p></div><span className="g-account-label">{userEmail || userName || "Administrador"}<small>Acesso por senha</small></span></section>{lojas.some(loja => loja.code.length > 4 || /^[0-9]{1,3}$/.test(loja.code)) && <section className="g-access-panel"><RefreshCw size={25} /><div><h2>Atualizar códigos antigos</h2><p>Adote códigos curtos. Os links antigos continuam funcionando.</p></div><button className="g-btn" onClick={() => void migrateCodes()} disabled={migratingCodes || loading}>{migratingCodes ? "Atualizando…" : "Atualizar códigos"}</button></section>}</>}
      <footer className="g-footer"><span>guirab<span>/</span>placas</span><span><i />Do balcão para novas conexões.</span><small>{DOMAIN}</small></footer>
    </main>

    {notice && <div className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "success" ? <Check size={19} /> : <X size={19} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={15} /></button></div>}
    {record && !modal && <EstablishmentRecord loja={record} label={plateLabel(record)} onClose={() => setRecordId(null)} onEdit={openStore} onPrint={(loja) => { setSelectedId(loja.id); setRecordId(null); setPrintMode("single"); setView("impressao"); }} onChanged={updateRecord} />}
    {modal && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModal(null); }}><div className={`modal${modal.kind === "store" ? " crm-edit-modal" : ""}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description"><div className="modal-heading"><span className="modal-icon">{modal.kind === "batch" ? <Package size={24} /> : <Store size={24} />}</span><button className="icon-button" onClick={() => setModal(null)} disabled={saving} aria-label="Fechar formulário"><X size={20} /></button></div>
      <h2 id="modal-title">{modal.kind === "batch" ? "Gerar placas" : "Editar cadastro"}</h2>
      <p id="modal-description">{modal.kind === "batch" ? "Cada placa ganha um número e um QR Code permanente. Você pode imprimir antes de saber qual loja vai comprá-la." : isAvailable(modal.loja) ? `${plateLabel(modal.loja)} está disponível. Registre o estabelecimento e vincule seu link quando estiver pronto para ativar a placa.` : "Atualize os dados do estabelecimento, as contagens ou o link de avaliação. A placa continua com o mesmo endereço."}</p>
      {modal.kind === "batch" ? <form onSubmit={generateBatch}><label className="field-label" htmlFor="batch-quantity">Quantidade de placas</label><input className="form-input batch-quantity" ref={initialInputRef} id="batch-quantity" type="number" min={1} max={maxBatch} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} required disabled={saving} aria-describedby="batch-help" /><p className="input-help" id="batch-help">Gere de 1 a {maxBatch} por vez. Há espaço para {capacity} placa{capacity === 1 ? "" : "s"} no seu painel.</p><div className="batch-modal-note"><Printer size={20} /><p>As novas placas serão selecionadas automaticamente para impressão em A4, duas diferentes por folha.</p></div>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)} disabled={saving}>Cancelar</button><button className="button primary" type="submit" disabled={saving || !capacity}>{saving ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}{saving ? "Gerando…" : "Gerar placas"}</button></div></form> : <form onSubmit={saveStore} aria-busy={saving}>
        <label className="field-label" htmlFor="store-name">Nome da loja</label>
        <input className="form-input" ref={initialInputRef} id="store-name" placeholder="Ex.: Nome do estabelecimento" value={name} maxLength={100} onChange={(event) => updateName(event.target.value)} disabled={saving} aria-required={Boolean(targetUrl.trim())} autoComplete="organization" />
        <label className="field-label" htmlFor="target-url">Link do perfil ou avaliação no Google</label>
        <input className={`form-input${resolveError ? " resolve-input-error" : ""}`} ref={targetInputRef} id="target-url" type="url" placeholder="https://maps.app.goo.gl/…" value={targetUrl} maxLength={2048} onChange={(event) => changeTarget(event.target.value)} onBlur={(event) => void resolveLink(event.currentTarget.value)} disabled={saving} aria-invalid={Boolean(resolveError)} aria-describedby={`url-help${resolveError ? " resolve-error" : ""}`} />
        <p className="input-help" id="url-help">No Google Maps, toque em Compartilhar e cole o link aqui. Ao sair do campo, ele é convertido automaticamente para abrir a avaliação diretamente. O nome e as contagens continuam manuais. Enquanto a placa estiver no estoque, este campo pode ficar vazio.</p>
        <div className="resolve-controls"><button type="button" className="button secondary resolve-button" onClick={() => void resolveLink(targetUrl)} disabled={!targetUrl.trim() || resolvingLink || saving}>{resolvingLink ? <LoaderCircle size={14} className="spin" /> : <Link2 size={14} />}{resolvingLink ? "Convertendo…" : "Converter para avaliação"}</button><span role="status" aria-live="polite">{resolvingLink ? "Preparando o link direto de avaliação…" : ""}</span></div>
        {resolveError && <div className="resolve-error" id="resolve-error" role="alert"><p>{resolveError}</p><small>Para abrir diretamente a tela de avaliação, siga as instruções abaixo para copiar o link do seu Perfil da Empresa.</small></div>}
        {resolvedLink && <section className="resolved-link-preview" aria-label={resolvedLink.destinationKind === "saved" ? "Destino atual preservado" : "Link direto de avaliação pronto"}><div className="resolved-link-heading"><CheckCircle2 size={17} /><strong>{resolvedLink.destinationKind === "saved" ? "Destino atual preservado" : "Link direto de avaliação pronto"}</strong></div>{resolvedLink.destinationKind === "saved" && <p className="resolved-destination-note">Este destino já está cadastrado e será mantido ao salvar as outras informações.</p>}<label className="sr-only" htmlFor="resolved-review-url">Endereço de destino da placa</label><input id="resolved-review-url" readOnly value={resolvedLink.targetUrl} onFocus={(event) => event.currentTarget.select()} /><div className="resolved-link-footer"><span>{resolvedLink.destinationKind === "saved" ? "Sem nova consulta ao Google." : resolvedLink.converted ? "Conversão direta concluída." : "Link direto de avaliação reconhecido."}</span><a href={resolvedLink.targetUrl} target="_blank" rel="noopener noreferrer">Testar destino <ExternalLink size={12} /></a></div></section>}
        <details className="review-link-help"><summary>Como conseguir o link direto de avaliação?</summary><ol><li>Abra no Google o Perfil da Empresa que você administra.</li><li>Toque em <strong>Ler avaliações</strong>, depois em <strong>Receba mais avaliações</strong> e em <strong>Copiar</strong>. Algumas versões usam <strong>Pedir avaliações</strong>.</li><li>Cole o link neste campo e confira o destino antes de salvar.</li></ol><p>O link de avaliação é gratuito. <a href="https://support.google.com/business/answer/16816815?hl=pt-BR" target="_blank" rel="noopener noreferrer">Ver instruções do Google <ExternalLink size={11} /></a></p></details>
        <div className="crm-form-section"><h3>Adesão e avaliações</h3><p>Informe as contagens manualmente. O crescimento é calculado a partir dos números cadastrados. Deixe em branco o que ainda não souber.</p><div className="crm-form-grid">
          <div><label className="field-label" htmlFor="crm-joined-at">Data de adesão</label><input className="form-input" id="crm-joined-at" type="date" value={crm.joinedAt} onChange={(event) => updateCrm("joinedAt", event.target.value)} disabled={saving} /><p className="crm-field-hint">Na primeira configuração, usamos a data de hoje no seu aparelho. Você pode ajustar; a data existente é preservada nas edições.</p></div>
          <div><label className="field-label" htmlFor="crm-current-reviews">Contagem atual de avaliações</label><input className="form-input" id="crm-current-reviews" type="number" min={0} max={10_000_000} step={1} placeholder="Informe manualmente" value={crm.currentReviews} onChange={(event) => updateCrm("currentReviews", event.target.value)} disabled={saving} /><p className="crm-field-hint">Atualize este número manualmente. A data da alteração é registrada ao salvar.</p></div>
          <div><label className="field-label" htmlFor="crm-initial-reviews">Avaliações no início da adesão</label><input className="form-input" id="crm-initial-reviews" type="number" min={0} max={10_000_000} step={1} placeholder="Não informada" value={crm.initialReviews} onChange={(event) => updateCrm("initialReviews", event.target.value)} disabled={saving} /><p className="crm-field-hint">Se estiver vazia na primeira associação, a contagem atual será usada como base. Uma base já cadastrada é preservada.</p></div>
          <div><label className="field-label" htmlFor="crm-next-contact">Próximo contato</label><input className="form-input" id="crm-next-contact" type="date" value={crm.nextContactAt} onChange={(event) => updateCrm("nextContactAt", event.target.value)} disabled={saving} /></div>
        </div></div>
        <div className="crm-form-section"><h3>Contato e localização</h3><p>Guarde os dados que ajudam no acompanhamento do estabelecimento.</p><div className="crm-location-tools"><div><strong>Localização do aparelho</strong><p>{shouldAutoLocate(modal.loja) ? "Na primeira configuração, o navegador pede permissão para obter sua localização. Com a permissão, consultamos o endereço via OpenStreetMap. Se não for possível, preencha o endereço manualmente." : "A localização cadastrada é preservada. Use o botão se quiser obter a posição atual do aparelho, com sua permissão, e consultar o endereço via OpenStreetMap."}</p></div><button type="button" className="button secondary" onClick={() => void useMyLocation()} disabled={locating || saving}>{locating ? <LoaderCircle size={15} className="spin" /> : <LocateFixed size={15} />}{locating ? "Obtendo localização…" : "Usar minha localização"}</button>{locationError && <p className="crm-location-error" role="alert">{locationError}</p>}{formLocation.latitude != null && formLocation.longitude != null && <div className="crm-location-result"><MapPin size={15} /><div><strong>{formLocation.latitude.toFixed(6)}, {formLocation.longitude.toFixed(6)}</strong><span>{formLocation.source === "gps" ? "Localização obtida deste aparelho. Confira o endereço antes de salvar." : "Localização já cadastrada e preservada nesta edição."}</span><small>{formLocation.source === "saved" ? "" : "A localização só será gravada ao salvar o cadastro."}</small></div><button type="button" aria-label="Limpar localização deste cadastro" disabled={saving || locating} onClick={() => { const next: FormLocation = { latitude: null, longitude: null, source: null }; locationRef.current = next; setFormLocation(next); }}><X size={13} /></button></div>}</div>{hasPlateLocation(formLocation) && <div className="registration-map-wrap"><RegistrationLocationMap latitude={formLocation.latitude} longitude={formLocation.longitude} address={crm.address} neighborhood={crm.neighborhood} locationSource={formLocation.source} /></div>}<div className="crm-form-grid">
          <div><label className="field-label" htmlFor="crm-owner">Nome do responsável</label><input className="form-input" id="crm-owner" value={crm.ownerName} maxLength={120} placeholder="Não informado" onChange={(event) => updateCrm("ownerName", event.target.value)} disabled={saving} autoComplete="name" /></div>
          <div><label className="field-label" htmlFor="crm-phone">Telefone do responsável</label><input className="form-input" id="crm-phone" type="tel" value={crm.ownerPhone} maxLength={40} placeholder="(00) 00000-0000" onChange={(event) => updateCrm("ownerPhone", event.target.value)} disabled={saving} autoComplete="tel" /></div>
          <div className="wide"><label className="field-label" htmlFor="crm-business-phone">Telefone comercial do estabelecimento</label><input className="form-input" id="crm-business-phone" type="tel" value={crm.businessPhone} maxLength={40} placeholder="Telefone público da loja, separado do responsável" onChange={(event) => updateCrm("businessPhone", event.target.value)} disabled={saving} /></div>
          <div className="wide"><label className="field-label" htmlFor="crm-address">Endereço</label><input className="form-input" id="crm-address" value={crm.address} maxLength={300} placeholder="Rua, número e complemento" onChange={(event) => updateCrm("address", event.target.value)} disabled={saving} autoComplete="street-address" /></div>
          <div className="wide"><label className="field-label" htmlFor="crm-neighborhood">Bairro</label><input className="form-input" id="crm-neighborhood" value={crm.neighborhood} maxLength={100} placeholder="Não informado" onChange={(event) => updateCrm("neighborhood", event.target.value)} disabled={saving} /></div>
          <div className="wide"><label className="field-label" htmlFor="crm-notes">Observações</label><textarea className="form-input" id="crm-notes" rows={4} value={crm.notes} maxLength={2000} placeholder="Preferências, combinados e informações para o próximo contato…" onChange={(event) => updateCrm("notes", event.target.value)} disabled={saving} /></div>
        </div></div>
        <div className="permanent-code"><Link2 size={17} /><span>{plateLabel(modal.loja)}<strong>/r/{modal.loja.code} · endereço permanente</strong></span><LockKeyhole size={14} /></div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)} disabled={saving}>Cancelar</button><button className="button primary" type="submit" disabled={saving || locating}>{saving || locating ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{locating ? "Obtendo localização…" : saving ? resolvingLink ? "Preparando link…" : "Salvando…" : isAvailable(modal.loja) && targetUrl.trim() ? "Configurar e ativar" : "Salvar cadastro"}</button></div>
      </form>}
    </div></div>}
  </div>;
}

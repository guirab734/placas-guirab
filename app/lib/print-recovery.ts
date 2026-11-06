type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PrintSelection = { view: "lojas" | "impressao"; selectedId: string | null; checkedIds: string[]; printMode: "batch" | "single" };
type PrintSelectionInput = Omit<PrintSelection, "printMode"> & { printMode?: PrintSelection["printMode"] };
const RESUME_KEY = "guirab-print-selection";
const RELOAD_KEY = "guirab-print-reload-at";
const MAX_AGE = 10 * 60_000;
const RELOAD_COOLDOWN = 2 * 60_000;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

function selection(value: Record<string, unknown>): PrintSelection {
  return { view: value.view === "impressao" ? "impressao" : "lojas",
    printMode: value.printMode === "single" ? "single" : "batch",
    selectedId: validId(value.selectedId) ? value.selectedId : null,
    checkedIds: Array.isArray(value.checkedIds) ? [...new Set(value.checkedIds.filter(validId))].slice(0, 50) : [] };
}

// Only temporary UI selections are retained, never credentials or establishment data.
export function rememberPrintSelection(storage: StorageAccess, value: PrintSelectionInput, now = Date.now()): boolean {
  try {
    const previous = Number(storage.getItem(RELOAD_KEY));
    if (previous > 0 && Math.abs(now - previous) < RELOAD_COOLDOWN) return false;
    storage.setItem(RESUME_KEY, JSON.stringify({ ...selection(value), createdAt: now, version: 1 }));
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    try { storage.removeItem(RESUME_KEY); } catch { /* Storage may be unavailable. */ }
    return false;
  }
}

export function takePrintSelection(storage: StorageAccess, now = Date.now()): PrintSelection | null {
  try {
    const raw = storage.getItem(RESUME_KEY);
    storage.removeItem(RESUME_KEY);
    if (!raw || raw.length > 16_384) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1
      || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)
      || value.createdAt > now || now - value.createdAt > MAX_AGE) return null;
    return selection(value);
  } catch { return null; }
}

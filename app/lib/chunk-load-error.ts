const CHUNK_LOAD_MESSAGES = [
  /\bFailed to fetch dynamically imported module\b/i,
  /\b(?:error|failed) loading dynamically imported module\b/i,
  /\bImporting a module script failed\b/i,
  /\bLoading (?:CSS )?chunk [^\s]+ failed(?:[.\s]|$)/i,
  /\bUnable to preload CSS for\b/i,
];

// A tab kept open across a deployment can still request a removed, hashed module.
// Match module/preload failures only; ordinary fetch and export errors must not reload the page.
export function isChunkLoadError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current === "string") return CHUNK_LOAD_MESSAGES.some(pattern => pattern.test(current as string));
    if (!current || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    try {
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string" && CHUNK_LOAD_MESSAGES.some(pattern => pattern.test(message))) return true;
      current = (current as { cause?: unknown }).cause;
    } catch { return false; }
  }
  return false;
}

import type { Loja } from "./types";
import type { LojaPatch } from "./validation";

// Capture the manually entered starting count once; later edits never move the baseline.
export function initialManualReviews(existing: Pick<Loja, "targetUrl" | "initialReviews">, patch: LojaPatch): number | null | undefined {
  if (existing.targetUrl || !patch.targetUrl || existing.initialReviews !== null || patch.initialReviews != null) return patch.initialReviews;
  return patch.currentReviews ?? patch.initialReviews;
}

import { deviceCalendarDate } from "./calendar-date";
import type { Loja } from "./types";

export function initialJoinedAt(loja: Pick<Loja, "joinedAt" | "targetUrl">, now = new Date()): string {
  return loja.joinedAt?.slice(0, 10) || (!loja.targetUrl.trim() ? deviceCalendarDate(now) : "");
}

export function joinedAtForSave(loja: Pick<Loja, "joinedAt" | "targetUrl">, value: string, manuallyEdited: boolean, linking: boolean, now = new Date()): string | null {
  if (loja.joinedAt || manuallyEdited) return value || null;
  return linking && !loja.targetUrl.trim() ? deviceCalendarDate(now) : null;
}

export function shouldAutoLocate(loja: Pick<Loja, "targetUrl" | "latitude" | "longitude">): boolean {
  return !loja.targetUrl.trim() && loja.latitude == null && loja.longitude == null;
}

export function initialReviewCount(loja: Pick<Loja, "targetUrl" | "initialReviews">, fields: {
  initialReviews: string; currentReviews: string;
}, linking: boolean): number | null {
  if (fields.initialReviews.trim()) return Number(fields.initialReviews);
  if (linking && !loja.targetUrl.trim() && loja.initialReviews == null && fields.currentReviews.trim()) return Number(fields.currentReviews);
  return null;
}

export function manualFormFields(fields: {
  currentReviews: string; address: string; neighborhood: string; businessPhone: string;
}, location: { latitude: number | null; longitude: number | null }): Record<string, string | number | null> {
  return {
    currentReviews: fields.currentReviews.trim() === "" ? null : Number(fields.currentReviews),
    address: fields.address.trim(), neighborhood: fields.neighborhood.trim(), businessPhone: fields.businessPhone.trim(),
    latitude: location.latitude, longitude: location.longitude,
  };
}

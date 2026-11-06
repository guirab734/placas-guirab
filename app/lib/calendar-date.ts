// Use this in browser forms so dates follow the device's calendar, without a UTC shift.
export function deviceCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Server-only fallback for requests that do not supply a calendar date.
export function saoPauloDate(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

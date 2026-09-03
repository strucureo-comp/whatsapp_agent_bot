/**
 * Deterministic date formatting.
 *
 * NEVER use bare `new Date(x).toLocaleString()` inside a Client Component:
 * the server prerenders with its locale and the browser hydrates with the
 * user's locale (e.g. "4/9/2026, 2:43:34 am" vs "04/09/2026, 02:43:34"),
 * which throws a React hydration-mismatch error. Fixed locale + fixed
 * time zone renders byte-identical HTML on both sides.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

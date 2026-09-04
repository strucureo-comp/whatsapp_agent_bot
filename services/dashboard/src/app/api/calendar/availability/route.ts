import { getCalendarFreeSlots } from "@/lib/google";
import { requireAuth } from "@/lib/auth-server";

/**
 * GET /api/calendar/availability?tenant_id=...&date=YYYY-MM-DD&duration=30
 * Returns available free slots within business hours (09:00 - 18:00 IST) for that date.
 */
export async function GET(request: Request) {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id");
  const date = url.searchParams.get("date");
  const duration = parseInt(url.searchParams.get("duration") ?? "30", 10) || 30;

  if (!tenantId) {
    return Response.json({ error: "tenant_id is required" }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const result = await getCalendarFreeSlots(tenantId, date, duration);
    return Response.json({
      date,
      businessHours: "09:00 – 18:00 IST",
      slots: result.slots,
      error: result.error,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

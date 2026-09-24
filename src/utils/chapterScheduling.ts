function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function toDateTimeLocalInput(value: unknown): string {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function minimumScheduledDateTimeInput(now = new Date(), leadMinutes = 2): string {
  return toDateTimeLocalInput(new Date(now.getTime() + Math.max(1, leadMinutes) * 60_000));
}

/** datetime-local is intentionally interpreted in the author's device zone. */
export function futureScheduleIso(value: unknown, nowMs = Date.now()): string | null {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= nowMs) return null;
  return date.toISOString();
}

export function scheduledDateLabel(value: unknown): string {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function browserTimeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "زمان محلی دستگاه";
  } catch {
    return "زمان محلی دستگاه";
  }
}

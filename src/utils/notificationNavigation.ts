export function canonicalNotificationPath(pathname: string): string {
  return String(pathname || "").replace(/^\/novel(?=\/|$)/, "/novels");
}

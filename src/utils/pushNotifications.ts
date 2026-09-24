function decodeBase64Url(value: string) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(padded);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export function canUsePushNotifications() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getPushStatus(token: string) {
  if (!canUsePushNotifications()) return { supported: false, subscribed: false, permission: "unsupported" };
  const response = await fetch("/api/notifications/push/config", { credentials: "same-origin", cache: "no-store", headers: { "X-CSRF-Token": token } });
  if (!response.ok) throw new Error("دریافت وضعیت Push ناموفق بود.");
  const config = await response.json();
  const registration = await navigator.serviceWorker.ready;
  const localSubscription = await registration.pushManager.getSubscription();
  return { ...config, subscribed: !!localSubscription && !!config.subscribed, permission: Notification.permission };
}

export async function enablePushNotifications(token: string) {
  if (!canUsePushNotifications()) throw new Error("مرورگر شما Push Notification را پشتیبانی نمی‌کند.");
  if (await Notification.requestPermission() !== "granted") throw new Error("اجازهٔ اعلان در مرورگر داده نشد.");
  const configResponse = await fetch("/api/notifications/push/config", { credentials: "same-origin", cache: "no-store", headers: { "X-CSRF-Token": token } });
  if (!configResponse.ok) throw new Error("کلید Push از سرور دریافت نشد.");
  const config = await configResponse.json();
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(config.publicKey) });
  const response = await fetch("/api/notifications/push/subscribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "ثبت Push ناموفق بود.");
}

export async function disablePushNotifications(token: string) {
  if (!canUsePushNotifications()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch("/api/notifications/push/unsubscribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify({ endpoint: subscription?.endpoint || "" }) });
  if (!response.ok) throw new Error("غیرفعال‌سازی Push ناموفق بود.");
  await subscription?.unsubscribe();
}

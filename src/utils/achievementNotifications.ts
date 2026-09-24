export type AchievementNotification = {
  id: string;
  type?: string;
  title?: string;
  createdAt?: string;
};

const STORAGE_PREFIX = "reptoc-achievement-toast-seen:";
const MAX_REMEMBERED_IDS = 200;

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function readSeenAchievementNotificationIds(
  userId: string,
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): Set<string> {
  if (!userId || !storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(userId)) || "[]");
    return new Set(
      (Array.isArray(parsed) ? parsed : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
        .slice(-MAX_REMEMBERED_IDS),
    );
  } catch {
    return new Set();
  }
}

export function rememberAchievementNotificationIds(
  userId: string,
  ids: Iterable<string>,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) {
  if (!userId || !storage) return;
  const normalized = [...new Set([...ids].map((id) => String(id || "").trim()).filter(Boolean))]
    .slice(-MAX_REMEMBERED_IDS);
  try {
    storage.setItem(storageKey(userId), JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in private browsing. The in-memory guard in
    // App still prevents repeat toasts for the current session.
  }
}

export function findNewAchievementNotification<T extends AchievementNotification>(
  notifications: T[],
  previousIds: Set<string> | null,
  seenIds: Set<string>,
  sessionStartedAt?: number,
): T | null {
  // The first successful request establishes a baseline. Existing history is
  // shown in the bell panel but must never replay as a fresh unlock toast. An
  // item actually created after this page session began is still a live unlock.
  if (!previousIds) {
    if (!sessionStartedAt) return null;
    return notifications.find((notification) => {
      const createdAt = new Date(String(notification.createdAt || "")).getTime();
      return notification.type === "achievement"
        && Boolean(notification.id)
        && !seenIds.has(notification.id)
        && Number.isFinite(createdAt)
        && createdAt >= sessionStartedAt - 2_000;
    }) || null;
  }
  return notifications.find((notification) =>
    notification.type === "achievement"
    && Boolean(notification.id)
    && !previousIds.has(notification.id)
    && !seenIds.has(notification.id)
  ) || null;
}

export function dedupeAchievementNotifications<T extends AchievementNotification>(
  notifications: T[],
): T[] {
  const receipts = new Set<string>();
  return notifications.filter((notification) => {
    if (notification.type !== "achievement") return true;
    const receiptKey = String(notification.title || notification.id).trim().toLocaleLowerCase();
    if (receipts.has(receiptKey)) return false;
    receipts.add(receiptKey);
    return true;
  });
}

type NotificationSummary = {
  id?: unknown;
  type?: unknown;
};

const NOVEL_MODERATION_NOTIFICATION_TYPES = new Set([
  "editorial_novel_approved",
  "editorial_novel_rejected",
  "novel_approved",
  "novel_rejected",
  "editor_update",
]);

export function hasNovelModerationUpdate(
  notifications: NotificationSummary[],
  knownNotificationIds: ReadonlySet<string> | null,
): boolean {
  return notifications.some((notification) => {
    const type = String(notification?.type || "").toLowerCase();
    if (!NOVEL_MODERATION_NOTIFICATION_TYPES.has(type)) return false;

    const id = String(notification?.id || "");
    return knownNotificationIds === null || !id || !knownNotificationIds.has(id);
  });
}

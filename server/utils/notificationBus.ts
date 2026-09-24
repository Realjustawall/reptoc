import { EventEmitter } from "events";

export interface RealtimeNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  text: string;
  link?: string;
}

/**
 * In-process bridge between notification persistence and the Socket.IO layer.
 * server/utils/notifications.ts publishes here; server.ts subscribes and
 * forwards to the recipient's private socket room. Keeps the data layer
 * decoupled from the transport.
 */
class NotificationBus extends EventEmitter {
  emitNotification(payload: RealtimeNotification) {
    if (!payload || !payload.userId) return;
    this.emit("notification", payload);
  }
}

const globalForBus = globalThis as typeof globalThis & { __reptocNotificationBus?: NotificationBus };

export const notificationBus: NotificationBus = globalForBus.__reptocNotificationBus ?? new NotificationBus();
globalForBus.__reptocNotificationBus = notificationBus;

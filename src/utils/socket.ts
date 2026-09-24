import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let socketToken: string | null = null;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let eventListeners: { [key: string]: Function[] } = {};

/**
 * ✅ SECURITY FIX (NB-5): Reads CSRF token from BOTH cookie names.
 *
 * The backend sets the cookie under:
 *   - `__Host-XSRF-TOKEN` in production (with Secure + __Host- prefix)
 *   - `XSRF-TOKEN` in development (HTTP localhost cannot use __Host-)
 *
 * Without this fix, the socket connection would fail in production because
 * `auth.token` would be `null` and the backend would reject the handshake.
 */
function getCsrfToken(): string | null {
  const cookies = document.cookie.split("; ");
  const cookie = cookies.find(row => row.startsWith("__Host-XSRF-TOKEN=") || row.startsWith("XSRF-TOKEN="));
  if (!cookie) return null;
  // The cookie value may contain `=` (base64 padding), so join the rest.
  const value = cookie.split("=").slice(1).join("=");
  return value ? decodeURIComponent(value) : null;
}

export const initSocket = (token?: string) => {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  // ✅ SECURITY: If caller didn't pass a token, read from the cookie.
  // This is the normal flow — the CSRF token is only ever stored in the cookie.
  const effectiveToken = token || getCsrfToken();
  if (!effectiveToken) {
    console.warn("[socket] No CSRF token available; socket connection skipped.");
    return null;
  }

  if (socket && socketToken === effectiveToken) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
    // Clean up event listeners
    socket.off();
    socket = null;
  }

  socketToken = effectiveToken;
  socket = io(window.location.origin, {
    auth: { token: effectiveToken },
    // Cloudflare and the origin both support WebSockets. Starting with the
    // final transport avoids a noisy polling-session upgrade failure, while
    // tryAllTransports retains HTTP polling for restrictive client networks.
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    withCredentials: true,
  });

  // Setup disconnect handler to cleanup
  socket.on('disconnect', () => {
    // Clear all tracked event listeners
    Object.keys(eventListeners).forEach(key => {
      delete eventListeners[key];
    });
  });

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => {
    if (!socket) return;
    // Remove all listeners before disconnecting
    socket.off();
    socket.disconnect();
    socket = null;
    socketToken = null;
    eventListeners = {};
    disconnectTimer = null;
  }, 300);
};

// Helper to track listeners for cleanup
export const onSocketEvent = (eventName: string, handler: Function) => {
  if (!socket) return;

  if (!eventListeners[eventName]) {
    eventListeners[eventName] = [];
  }
  eventListeners[eventName].push(handler);

  socket.on(eventName, handler as any);
};

// Helper to remove specific listener
export const offSocketEvent = (eventName: string, handler?: Function) => {
  if (!socket) return;

  if (handler) {
    socket.off(eventName, handler as any);
    if (eventListeners[eventName]) {
      eventListeners[eventName] = eventListeners[eventName].filter(h => h !== handler);
    }
  } else {
    socket.off(eventName);
    delete eventListeners[eventName];
  }
};

import sanitizeHtml from "sanitize-html";
import { supabase } from "../postgres";
import { resolveUsername } from "./usernames";

function sanitizePlainText(value: unknown, maxLength = 2000) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
    allowedSchemes: [],
    allowProtocolRelative: false,
  })
    .trim()
    .slice(0, maxLength);
}

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,50}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUsername(value: unknown) {
  return sanitizePlainText(value, 50).toLowerCase();
}

export function isValidUsername(value: string) {
  return USERNAME_REGEX.test(value);
}

export function isValidEmail(value: string) {
  return EMAIL_REGEX.test(value);
}

export async function createDirectMessage(options: {
  from: string;
  to: string;
  subject: string;
  snippet: string;
  createdAt?: string;
}) {
  const sender = normalizeUsername(options.from);
  const recipient = normalizeUsername(options.to);
  const subject = sanitizePlainText(options.subject, 160);
  const snippet = sanitizePlainText(options.snippet, 5000);
  const createdAt = options.createdAt ? sanitizePlainText(options.createdAt, 64) : new Date().toISOString();

  if (!sender || !recipient) {
    throw new Error("Invalid sender or recipient");
  }
  if (!isValidUsername(sender) || !isValidUsername(recipient)) {
    throw new Error("Sender or recipient username is invalid");
  }
  if (sender === recipient) {
    throw new Error("Cannot send a direct message to yourself");
  }
  if (!subject) {
    throw new Error("Message subject is required");
  }
  if (!snippet) {
    throw new Error("Message body is required");
  }

  const [senderUser, recipientUser] = await Promise.all([
    resolveUsername(sender),
    resolveUsername(recipient),
  ]);
  if (!senderUser || !recipientUser) {
    throw new Error("Recipient not found");
  }
  if (senderUser.id === recipientUser.id) throw new Error("Cannot send a direct message to yourself");

  const { data: blocked } = await supabase
    .from("blocked_users")
    .select("id")
    .or(
      `and(blocker_user_id.eq.${senderUser.id},blocked_user_id.eq.${recipientUser.id}),and(blocker_user_id.eq.${recipientUser.id},blocked_user_id.eq.${senderUser.id})`
    )
    .limit(1);

  if (blocked && blocked.length > 0) {
    throw new Error("Messaging is blocked between these users");
  }

  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const record = {
    id,
    recipient_id: recipientUser.id,
    sender_id: senderUser.id,
    username: recipientUser.username,
    sender: senderUser.username,
    subject,
    snippet,
    is_read: 0,
    created_at: createdAt,
  };

  const { error } = await supabase.from("messages").insert(record);
  if (error) {
    throw new Error("Failed to save message");
  }

  return {
    id,
    sender: senderUser.username,
    to: recipientUser.username,
    subject,
    snippet,
    created_at: createdAt,
    read: false,
  };
}

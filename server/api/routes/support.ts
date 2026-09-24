import express from "express";
import { v4 as uuidv4 } from "uuid";
import { db, supabase } from "../../postgres";
import { getActiveUser, hasPermission, isOwnerUser, PERMISSIONS } from "../../utils/auth";
import { filterPayloadToExistingColumns, getTableColumns } from "../../utils/dbSchema";
import sanitizeHtml from "sanitize-html";
import { interactionLimiter } from "../limiters";

function cleanText(input: unknown) {
  return sanitizeHtml(String(input || ""), { allowedTags: [], allowedAttributes: {} }).trim();
}

const router = express.Router();
const SUPPORT_STAFF_ROLES = new Set(["publisher", "support", "editor"]);
let supportSchemaReady: Promise<void> | null = null;

async function ensureSupportSchema() {
  if (!supportSchemaReady) {
    supportSchemaReady = Promise.all([
      getTableColumns("support_tickets"),
      getTableColumns("support_messages")
    ]).then(([ticketColumns, messageColumns]) => {
      const missingTicket = ["id", "user_id", "title", "status", "created_at"].filter((column) => !ticketColumns.has(column));
      const missingMessage = ["id", "ticket_id", "user_id", "content", "is_admin", "created_at"].filter((column) => !messageColumns.has(column));
      if (missingTicket.length || missingMessage.length) {
        throw new Error(`Support database schema is incomplete (${[...missingTicket, ...missingMessage].join(", ")}). Run migration 011.`);
      }
    }).catch((error) => {
      supportSchemaReady = null;
      throw error;
    });
  }
  await supportSchemaReady;
}

function throwDbError(result: any, action: string) {
  if (result?.error) {
    // Details stay in the server log; clients get a generic message so the
    // database schema cannot be fingerprinted from ticket operations.
    console.error(`[support] ${action} failed:`, result.error);
    throw new Error("عملیات پشتیبانی ممکن نشد. لطفاً بعداً دوباره تلاش کنید.");
  }
}

// ✅ SECURITY: Whitelist of columns that callers are allowed to INSERT into
// the support_tickets table. Any column not on this list is rejected, even
// if it exists in the DB schema. This prevents an attacker (or a future
// code change) from injecting values into sensitive columns like `assigned_to`
// or `resolution_note` via the public ticket-creation endpoint.
const ALLOWED_TICKET_INSERT_COLUMNS = new Set([
  "id", "user_id", "title", "category", "status", "priority",
  "reporter_name", "reporter_email", "reporter_phone",
  "created_at", "updated_at",
]);

// ✅ SECURITY: Validate ticket ID format. Tickets use the prefix "tk-"
// followed by a UUID-like identifier.
const VALID_TICKET_ID = /^tk-[a-f0-9-]{8,80}$/i;

async function insertTicketWithInitialMessage(ticket: Record<string, any>, message: Record<string, any>) {
  const ticketColumns = await getTableColumns("support_tickets");
  const entries = Object.entries(ticket).filter(
    ([column]) => ticketColumns.has(column) && ALLOWED_TICKET_INSERT_COLUMNS.has(column)
  );
  if (!entries.some(([column]) => column === "id") || !entries.some(([column]) => column === "user_id")) {
    throw new Error("Support ticket database schema is incomplete.");
  }
  await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO support_tickets (${entries.map(([column]) => `"${column}"`).join(", ")}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(", ")})`,
      entries.map(([, value]) => value)
    );
    await client.query(
      `INSERT INTO support_messages (id, ticket_id, user_id, content, is_admin, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [message.id, message.ticket_id, message.user_id, message.content, message.is_admin, message.created_at]
    );
  });
}

function normalizedRole(user: any) {
  return String(user?.role || "").toLowerCase().trim();
}

function canViewAllTickets(user: any) {
  const role = normalizedRole(user);
  return !!user && (
    isOwnerUser(user) ||
    SUPPORT_STAFF_ROLES.has(role) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    hasPermission(user, PERMISSIONS.TICKET_READ_ALL)
  );
}

function canManageTicketStatus(user: any) {
  const role = normalizedRole(user);
  return !!user && (
    isOwnerUser(user) ||
    SUPPORT_STAFF_ROLES.has(role) ||
    hasPermission(user, PERMISSIONS.ADMIN) ||
    hasPermission(user, PERMISSIONS.TICKET_UPDATE) ||
    hasPermission(user, PERMISSIONS.TICKET_CLOSE)
  );
}

router.get("/tickets", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureSupportSchema();

    const scope = String(req.query.scope || "mine").toLowerCase();
    const query = scope === "all" && canViewAllTickets(user)
      ? supabase.from("support_tickets").select("*").order("created_at", { ascending: false })
      : supabase.from("support_tickets").select("*").eq("user_id", user.id).order("created_at", { ascending: false });

    const result = await query;
    throwDbError(result, scope === "all" ? "load all tickets" : "load user tickets");
    res.json(result.data || []);
  } catch (err) {
    console.error("[support] Failed to load tickets:", err);
    res.status(400).json({ error: "بارگیری تیکت‌ها ناموفق بود" });
  }
});

router.post("/tickets", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureSupportSchema();

    const title = cleanText(req.body.title);
    const message = cleanText(req.body.message);
    const category = cleanText(req.body.category || "general") || "general";
    const reporterName = cleanText(req.body.name) || user.nickname || user.username;
    const reporterEmail = cleanText(req.body.email) || user.email || "";
    const reporterPhone = cleanText(req.body.phone) || user.phone || "";
    const requestedPriority = cleanText(req.body.priority || "normal").toLowerCase();
    const priority = ["low", "normal", "high", "urgent"].includes(requestedPriority) ? requestedPriority : "normal";

    if (!title || !message) return res.status(400).json({ error: "عنوان یا متن پیام وارد نشده یا نامعتبر است" });

    const ticketId = `tk-${uuidv4()}`;
    const now = new Date().toISOString();
    const ticketPayload = {
      id: ticketId,
      user_id: user.id,
      title,
      category,
      status: "OPEN",
      priority,
      reporter_name: reporterName,
      reporter_email: reporterEmail,
      reporter_phone: reporterPhone,
      created_at: now,
      updated_at: now
    };

    const messagePayload = {
      id: uuidv4(),
      ticket_id: ticketId,
      user_id: user.id,
      content: message,
      is_admin: 0,
      created_at: now
    };
    await insertTicketWithInitialMessage(ticketPayload, messagePayload);

    res.status(201).json({ success: true, ticketId });
  } catch (err) {
    console.error("[support] Error creating ticket:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "خطا در ثبت تیکت" });
  }
});

router.get("/tickets/:id", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureSupportSchema();

    // ✅ SECURITY: Validate ticket ID format.
    const ticketId = String(req.params.id || "");
    if (!VALID_TICKET_ID.test(ticketId)) {
      return res.status(400).json({ error: "شناسه تیکت نامعتبر است." });
    }

    const ticketResult = await supabase.from("support_tickets").select("*").eq("id", ticketId).single();
    if (ticketResult.error && ticketResult.error.code !== "PGRST116") throwDbError(ticketResult, "load ticket");
    const ticket = ticketResult.data;
    if (!ticket) return res.status(404).json({ error: "تیکت یافت نشد" });

    if (!canViewAllTickets(user) && ticket.user_id !== user.id) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }

    const messagesResult = await db.query(
      `SELECT m.*, u.username AS sender FROM support_messages m JOIN users u ON u.id = m.user_id WHERE m.ticket_id = $1 ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    const messages = messagesResult.rows;

    res.json({ ticket, messages });
  } catch (err) {
    console.error("[support] Failed to load ticket:", err);
    res.status(400).json({ error: "بارگیری تیکت ناموفق بود" });
  }
});

router.post("/tickets/:id/messages", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureSupportSchema();

    // ✅ SECURITY: Validate ticket ID format.
    const ticketId = String(req.params.id || "");
    if (!VALID_TICKET_ID.test(ticketId)) {
      return res.status(400).json({ error: "شناسه تیکت نامعتبر است." });
    }

    const ticketResult = await supabase.from("support_tickets").select("*").eq("id", ticketId).single();
    if (ticketResult.error && ticketResult.error.code !== "PGRST116") throwDbError(ticketResult, "load ticket for reply");
    const ticket = ticketResult.data;
    if (!ticket) return res.status(404).json({ error: "تیکت یافت نشد" });

    if (!canViewAllTickets(user) && ticket.user_id !== user.id) {
      return res.status(403).json({ error: "دسترسی غیرمجاز" });
    }

    const content = cleanText(req.body.content);
    if (!content) return res.status(400).json({ error: "متن پیام وارد نشده است" });

    const isAdmin = canManageTicketStatus(user) ? 1 : 0;
    const now = new Date().toISOString();
    const ticketColumns = await getTableColumns("support_tickets");
    await db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO support_messages (id, ticket_id, user_id, content, is_admin, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), req.params.id, user.id, content, isAdmin, now]
      );
      await client.query(
        ticketColumns.has("updated_at")
          ? `UPDATE support_tickets SET status = $1, updated_at = $2 WHERE id = $3`
          : `UPDATE support_tickets SET status = $1 WHERE id = $2`,
        ticketColumns.has("updated_at") ? [isAdmin ? "PENDING" : "OPEN", now, req.params.id] : [isAdmin ? "PENDING" : "OPEN", req.params.id]
      );
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[support] Failed to post message:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "ارسال پیام ناموفق بود" });
  }
});

router.get("/editor-messages/:novelId", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { data: novel } = await supabase.from("novels").select("id, author_id").eq("id", req.params.novelId).single();
    if (!novel || novel.author_id !== user.id) return res.status(403).json({ error: "برای مشاهده این پیام‌ها مجاز نیستید" });

    const { data: messages } = await supabase.from("editor_messages")
      .select("*").eq("novel_id", req.params.novelId).order("created_at", { ascending: true });

    res.json(messages || []);
  } catch (err) {
    res.status(400).json({ error: "خطا در دریافت پیام‌های ویراستار" });
  }
});

router.post("/editor-messages/:novelId", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { data: novel } = await supabase.from("novels").select("id, author_id, approved_by").eq("id", req.params.novelId).single();
    if (!novel || novel.author_id !== user.id) return res.status(403).json({ error: "دسترسی غیرمجاز" });

    const content = cleanText(req.body.content);
    if (!content) return res.status(400).json({ error: "متن پیام وارد نشده است" });

    await supabase.from("editor_messages").insert({
      id: `nem-${Date.now()}-${uuidv4().substring(0, 5)}`,
      novel_id: novel.id,
      sender_id: user.id,
      receiver_id: novel.approved_by || user.id,
      content,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "ارسال پیام ناموفق بود" });
  }
});

const allowedStatuses = ["OPEN", "PENDING", "CLOSED", "RESOLVED"];

router.patch("/tickets/:id/status", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });
    await ensureSupportSchema();

    // ✅ SECURITY: Validate ticket ID format.
    const ticketId = String(req.params.id || "");
    if (!VALID_TICKET_ID.test(ticketId)) {
      return res.status(400).json({ error: "شناسه تیکت نامعتبر است." });
    }

    const status = String(req.body.status || "").toUpperCase();
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "وضعیت نامعتبر است" });
    }

    const ticketResult = await supabase
      .from("support_tickets")
      .select("id, user_id")
      .eq("id", req.params.id)
      .single();
    if (ticketResult.error && ticketResult.error.code !== "PGRST116") throwDbError(ticketResult, "load ticket for status update");
    if (!ticketResult.data) return res.status(404).json({ error: "تیکت یافت نشد" });
    const ownsTicket = ticketResult.data.user_id === user.id;
    if (!canManageTicketStatus(user) && !(ownsTicket && status === "CLOSED")) {
      return res.status(403).json({ error: "شما فقط می‌توانید تیکت خودتان را ببندید." });
    }

    const updates = await filterPayloadToExistingColumns("support_tickets", {
      status,
      updated_at: new Date().toISOString()
    });
    const updateResult = await supabase.from("support_tickets").update(updates).eq("id", req.params.id);
    throwDbError(updateResult, "update ticket status");

    res.json({ success: true });
  } catch (err) {
    console.error("[support] Failed to update ticket status:", err);
    res.status(400).json({ error: "عملیات ناموفق بود" });
  }
});

router.delete("/tickets/:id", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user || !canManageTicketStatus(user)) return res.status(403).json({ error: "این عملیات نیاز به مجوز پشتیبانی دارد." });
    await ensureSupportSchema();
    // ✅ SECURITY: Validate ticket ID format.
    const ticketId = String(req.params.id || "");
    if (!VALID_TICKET_ID.test(ticketId)) {
      return res.status(400).json({ error: "شناسه تیکت نامعتبر است." });
    }
    const ticketResult = await supabase.from("support_tickets").select("id").eq("id", ticketId).single();
    if (!ticketResult.data) return res.status(404).json({ error: "تیکت یافت نشد." });
    await db.withTransaction(async (client) => {
      await client.query("DELETE FROM support_messages WHERE ticket_id = $1", [ticketId]);
      await client.query("DELETE FROM support_tickets WHERE id = $1", [ticketId]);
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[support] Failed to delete ticket:", err);
    res.status(400).json({ error: "حذف تیکت ناموفق بود." });
  }
});

export default router;

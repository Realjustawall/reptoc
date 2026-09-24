import express from "express";
import { db, supabase } from "../../postgres";
import { getActiveUser } from "../../utils/auth";
import { sanitizePlainText } from "../../utils/content";
import { canManageNovel } from "../../utils/chapters";
import { analyzeContentText, buildTextDiff, ensureOperationalTables } from "../../utils/operations";
import { createUserNotification } from "../../utils/notifications";
import { filterExistingColumns, filterPayloadToExistingColumns, reportSchemaGapOnce } from "../../utils/dbSchema";
import { detectAIWriting } from "../../utils/aiDetection";
import { invalidateNovelCaches } from "../../utils/catalogCache";
import { loadChapterPages } from "../../utils/manga";
import { normalizeContentKind, normalizeReadingDirection } from "../../../shared/manga";

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    const user = await getActiveUser(req, ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method));
    const normalizedRole = String(user?.role || "").toLowerCase().trim();
    if (!user || !['owner', 'publisher', 'editor'].includes(normalizedRole)) {
      return res.status(403).json({ error: "دسترسی غیرمجاز: نقش سردبیر یا مدیر لازم است." });
    }
    (req as any).user = user;
    next();
  } catch {
    res.status(401).json({ error: "دسترسی غیرمجاز" });
  }
});

const CHAPTER_WORKFLOW_STATUSES = new Set(["draft", "submitted", "needs_changes", "approved", "scheduled", "published"]);

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  needs_changes: "نیازمند تغییرات",
  approved: "تأیید شده",
  scheduled: "زمان‌بندی شده",
  published: "منتشر شده"
};

/**
 * Editorial queries degrade to an empty result instead of failing the panel.
 *
 * A missing relation or column (pending migration) is reported once per
 * process by the schema helper so the cause is visible without one log line
 * per request.
 */
async function safeDbQuery(sql: string, params?: any[]) {
  try {
    return await db.query(sql, params);
  } catch (error: any) {
    const relation = sql.match(/\bFROM\s+([a-z_][a-z0-9_.]*)/i)?.[1] || "unknown";
    reportSchemaGapOnce(`editor query ${relation}`, error);
    return { rows: [] };
  }
}

function isEditorialManager(user: any) {
  return ["owner", "publisher"].includes(String(user?.role || "").toLowerCase().trim());
}

function normalizeChapterWorkflowStatus(value: unknown) {
  const normalized = sanitizePlainText(value, 40).toLowerCase().replace(/\s+/g, "_");
  return CHAPTER_WORKFLOW_STATUSES.has(normalized) ? normalized : "";
}

function chapterVisibilityStatus(editorialStatus: string) {
  if (editorialStatus === "published") return "Published";
  if (editorialStatus === "scheduled") return "Scheduled";
  return "Draft";
}

async function canAccessNovel(user: any, novel: any) {
  await ensureOperationalTables().catch(() => {});
  if (!user || !novel) return false;
  if (canManageNovel(user, novel)) return true;
  if (
    String(user.role || "").toLowerCase().trim() === "editor" &&
    String(novel.approval_status || "pending_approval").toLowerCase() === "pending_approval"
  ) return true;
  if (String(user.role || "").toLowerCase().trim() === "editor") {
    const submitted = await safeDbQuery(
      `SELECT id FROM chapters WHERE novel_id = $1 AND editorial_status = 'submitted' LIMIT 1`,
      [novel.id]
    );
    if (submitted.rows.length > 0) return true;
  }
  const { rows } = await safeDbQuery(
    `SELECT id FROM editor_assignments WHERE editor_id = $1 AND status <> 'closed' AND (target_id = $2 OR novel_id = $2) LIMIT 1`,
    [user.id, novel.id]
  );
  return rows.length > 0;
}

async function canAccessChapter(user: any, novel: any, chapterId: string) {
  if (await canAccessNovel(user, novel)) return true;
  const { rows } = await safeDbQuery(
    `SELECT id FROM editor_assignments WHERE editor_id = $1 AND status <> 'closed' AND target_type = 'chapter' AND target_id = $2 LIMIT 1`,
    [user.id, chapterId]
  );
  return rows.length > 0;
}

async function saveChapterScan(scanId: string, chapter: any, userId: string, scan: any) {
  await safeDbQuery(
    `INSERT INTO content_moderation_scans
      (id, target_type, target_id, novel_id, chapter_id, scanner_id, risk_score, nsfw_score, violence_score, ai_score, plagiarism_score, profanity_score, warning_mismatch_score, quality_score, flags, summary)
     VALUES ($1,'chapter',$2,$3,$2,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
    [
      scanId,
      chapter.id,
      chapter.novel_id,
      userId,
      scan.riskScore,
      scan.nsfwScore,
      scan.violenceScore,
      scan.aiScore,
      scan.plagiarismScore,
      scan.profanityScore,
      scan.warningMismatchScore,
      scan.qualityScore,
      JSON.stringify(scan.flags),
      scan.summary
    ]
  );
}

router.get("/novels", async (req, res) => {
  try {
    await ensureOperationalTables();
    const user = (req as any).user;
    const { data: novelsList, error } = await supabase.from('novels').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const normalizedRole = String(user.role || "").toLowerCase().trim();
    const novelIds = (novelsList || []).map((novel: any) => novel.id);
    const assignments = novelIds.length
      ? (await safeDbQuery(
        `SELECT * FROM editor_assignments WHERE novel_id = ANY($1) AND status <> 'closed'`,
        [novelIds]
      )).rows
      : [];
    const chapters = novelIds.length
      ? (await safeDbQuery(
        `SELECT id, novel_id, title, editorial_status, status, assigned_editor_id, review_due_at, submitted_at, approved_by, approved_at FROM chapters WHERE novel_id = ANY($1)`,
        [novelIds]
      )).rows
      : [];

    const reviewableNovelIds = new Set(
      chapters
        .filter((chapter: any) => chapter.editorial_status === "submitted")
        .map((chapter: any) => chapter.novel_id)
    );
    const visibleNovels = ["owner", "publisher"].includes(normalizedRole)
      ? novelsList || []
      : (novelsList || []).filter((novel: any) =>
          String(novel.approval_status || "pending_approval").toLowerCase() === "pending_approval" ||
          reviewableNovelIds.has(novel.id) ||
          novel.approved_by === user.id ||
          assignments.some((assignment: any) => assignment.editor_id === user.id && assignment.novel_id === novel.id) ||
          chapters.some((chapter: any) => chapter.assigned_editor_id === user.id && chapter.novel_id === novel.id)
        );

    const filtered = visibleNovels.map(n => {
      const novelAssignments = assignments.filter((assignment: any) => assignment.novel_id === n.id);
      const novelChapters = chapters.filter((chapter: any) => chapter.novel_id === n.id);
      const myAssignments = novelAssignments.filter((assignment: any) => assignment.editor_id === user.id);
      const myAssignedChapters = novelChapters.filter((chapter: any) => chapter.assigned_editor_id === user.id || myAssignments.length > 0);
      const now = Date.now();
      return {
        ...n,
        approved_by_me: n.approved_by === user.id,
        assignments: novelAssignments,
        assigned_to_me: myAssignments.length > 0 || n.approved_by === user.id || myAssignedChapters.length > 0,
        assigned_editor_ids: [...new Set(novelAssignments.map((assignment: any) => assignment.editor_id).filter(Boolean))],
        review_due_at: myAssignments[0]?.due_at || myAssignedChapters.find((chapter: any) => chapter.review_due_at)?.review_due_at || null,
        editorial_counts: {
          draft: novelChapters.filter((chapter: any) => (chapter.editorial_status || "draft") === "draft").length,
          submitted: novelChapters.filter((chapter: any) => chapter.editorial_status === "submitted").length,
          needs_changes: novelChapters.filter((chapter: any) => chapter.editorial_status === "needs_changes").length,
          approved: novelChapters.filter((chapter: any) => chapter.editorial_status === "approved").length,
          scheduled: novelChapters.filter((chapter: any) => chapter.editorial_status === "scheduled").length,
          published: novelChapters.filter((chapter: any) => chapter.editorial_status === "published" || chapter.status === "Published").length,
          overdue: myAssignedChapters.filter((chapter: any) => chapter.review_due_at && new Date(chapter.review_due_at).getTime() < now && !["approved", "published"].includes(chapter.editorial_status)).length
        }
      }
    }) || [];

    res.json(filtered);
  } catch (error: any) {
    console.error("[editor/novels] load failed", { code: error?.code, message: error?.message || String(error) });
    res.status(503).json({ error: "بارگذاری صف تحریریه ناموفق بود. اگر مایگریشن‌ها اجرا نشده‌اند، npm run db:migrate را اجرا کنید." });
  }
});

router.post("/novels/:id/moderate", async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: "وضعیت نامعتبر است." });

    const { data: nvl } = await supabase.from('novels').select('id, author, title, author_id, approved_by, approval_status').eq('id', id).single();
    if (!nvl) return res.status(404).json({ error: "رمان مورد یافت نشد." });
    const canModerate = await canAccessNovel(user, nvl);
    if (!canModerate) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });

    const cleanNote = sanitizePlainText(note, 5000);
    const { data: moderatedNovel, error: moderationError } = await supabase.from('novels').update({ 
      approval_status: status, 
      editor_note: cleanNote,
      approved_by: user.id
    }).eq('id', id).select('id, approval_status').single();
    if (moderationError || !moderatedNovel || moderatedNovel.approval_status !== status) {
      console.error("[editor] Failed to persist novel moderation", moderationError);
      return res.status(500).json({ error: "ذخیره تصمیم بررسی ناموفق بود." });
    }

    // Make the persisted decision visible before publishing its notification.
    // Otherwise the author's notification poll can race the post-response cache
    // eviction and hydrate the writer area with the previous approval status.
    await invalidateNovelCaches(id);

    if (nvl?.author_id) {
      await createUserNotification(
        nvl.author_id,
        status === "approved" ? "editorial_novel_approved" : "editorial_novel_rejected",
        status === "approved" ? "رمان تأیید شد" : "رد شد: در انتظار تغییرات نویسنده",
        status === "approved"
          ? `رمان شما «${nvl.title}» توسط ${user.username} تأیید شد.`
          : `رمان شما «${nvl.title}» نیازمند تغییرات نویسنده است. ${cleanNote ? `دلیل: ${cleanNote}` : ""}`.trim(),
        `/novels/${encodeURIComponent(id)}`
      );
    }

    res.json({ success: true });
  } catch(err) {
    res.status(400).json({ error: "بررسی رمان ناموفق بود." });
  }
});

router.get("/staff", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    if (!isEditorialManager(user)) return res.status(403).json({ error: "فقط مالک/ناشر می‌تواند فهرست سردبیران را ببیند." });
    const userColumns = await filterExistingColumns("users", ["id", "username", "nickname", "role", "avatar", "is_staff"]);
    const { data } = await supabase
      .from("users")
      .select(userColumns.join(", ") || "id, username, role")
      .in("role", ["editor", "publisher", "owner"]);
    res.json({ staff: data || [] });
  } catch (error: any) {
    console.error("[editor/staff] load failed", { code: error?.code, message: error?.message || String(error) });
    res.json({ staff: [] });
  }
});

router.post("/assignments", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    if (!isEditorialManager(user)) return res.status(403).json({ error: "فقط مالک/ناشر می‌تواند کارهای تحریریه را واگذار کند." });
    const targetType = sanitizePlainText(req.body.targetType, 40);
    const novelId = sanitizePlainText(req.body.novelId, 160);
    const chapterId = req.body.chapterId ? sanitizePlainText(req.body.chapterId, 160) : null;
    const editorId = sanitizePlainText(req.body.editorId, 160);
    const dueAt = req.body.dueAt ? new Date(req.body.dueAt).toISOString() : null;
    if (!["novel", "chapter"].includes(targetType) || !novelId || !editorId || (targetType === "chapter" && !chapterId)) {
      return res.status(400).json({ error: "داده‌های واگذاری نامعتبر است." });
    }
    const { data: editor } = await supabase.from("users").select("id, username, role, is_staff").eq("id", editorId).single();
    const editorRole = String(editor?.role || "").toLowerCase().trim();
    if (!editor || !["editor", "publisher", "owner"].includes(editorRole)) return res.status(400).json({ error: "کاربر انتخاب‌شده سردبیر نیست." });
    const { data: novel } = await supabase.from("novels").select("id, title").eq("id", novelId).single();
    const { data: chapter } = chapterId
      ? await supabase.from("chapters").select("id, title").eq("id", chapterId).eq("novel_id", novelId).single()
      : ({ data: null } as any);
    const targetId = targetType === "chapter" ? chapterId! : novelId;
    const assignment = {
      id: `ea-${targetType}-${targetId}-${editorId}`,
      target_type: targetType,
      target_id: targetId,
      novel_id: novelId,
      chapter_id: chapterId,
      editor_id: editorId,
      assigned_by: user.id,
      status: "assigned",
      due_at: dueAt,
      updated_at: new Date().toISOString()
    };
    await supabase.from("editor_assignments").upsert(assignment, { onConflict: "target_type,target_id,editor_id" });
    if (targetType === "novel") {
      const novelUpdates = await filterPayloadToExistingColumns("novels", { approved_by: editorId });
      if (Object.keys(novelUpdates).length) await supabase.from("novels").update(novelUpdates).eq("id", novelId);
    } else {
      const chapterUpdates = await filterPayloadToExistingColumns("chapters", { assigned_editor_id: editorId, review_due_at: dueAt });
      if (Object.keys(chapterUpdates).length) await supabase.from("chapters").update(chapterUpdates).eq("id", chapterId).eq("novel_id", novelId);
    }
    await createUserNotification(
      editorId,
      "editor_assignment",
      "واگذاری تحریریه جدید",
      targetType === "chapter"
        ? `شما برای بررسی «${chapter?.title || "فصل بدون عنوان"}» در رمان «${novel?.title || "رمان بدون عنوان"}» واگذار شده‌اید.`
        : `شما برای بررسی رمان «${novel?.title || "رمان بدون عنوان"}» واگذار شده‌اید.`,
      "/editor-panel"
    );
    res.json({ success: true, assignment });
  } catch (err) {
    console.error("[editor/assignments] failed", err);
    res.status(400).json({ error: "واگذاری به سردبیر ناموفق بود" });
  }
});

router.get("/novels/:id/chapters", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const { id } = req.params;
    const user = (req as any).user;
    const { data: novel } = await supabase.from('novels').select('id, title, author_id, approved_by').eq('id', id).single();
    if (!await canAccessNovel(user, novel)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });

    const { data: chapters } = await supabase.from('chapters').select('*').eq('novel_id', id).order('order_index', { ascending: true });
    res.json(chapters || []);
  } catch(err) {
    res.status(400).json({ error: "دریافت فصل‌ها ناموفق بود" });
  }
});

router.patch("/novels/:id/chapters/:chapterId/status", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id, chapterId } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, title, author_id, approved_by').eq('id', id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });
    const { data: chapter } = await supabase.from("chapters").select("id, title").eq("id", chapterId).eq("novel_id", id).single();

    const editorialStatus = normalizeChapterWorkflowStatus(req.body.status);
    if (!editorialStatus) return res.status(400).json({ error: "وضعیت فصل نامعتبر است." });
    const now = new Date().toISOString();
    const requestedScheduleTime = editorialStatus === "scheduled" ? new Date(req.body.scheduledAt || "").getTime() : null;
    if (editorialStatus === "scheduled" && (!Number.isFinite(requestedScheduleTime) || Number(requestedScheduleTime) <= Date.now())) {
      return res.status(400).json({ error: "برای زمان‌بندی فصل، تاریخ و زمان معتبری در آینده انتخاب کنید." });
    }
    const updates: any = {
      editorial_status: editorialStatus,
      status: chapterVisibilityStatus(editorialStatus),
      moderation_status: editorialStatus === "needs_changes" ? "needs_changes" : editorialStatus === "published" ? "visible" : undefined,
      editor_note: req.body.note !== undefined ? sanitizePlainText(req.body.note, 5000) : undefined,
      scheduled_at: editorialStatus === "scheduled" ? new Date(Number(requestedScheduleTime)).toISOString() : undefined,
      submitted_at: editorialStatus === "submitted" ? now : undefined,
      approved_by: ["approved", "scheduled", "published"].includes(editorialStatus) ? user.id : undefined,
      approved_at: ["approved", "scheduled", "published"].includes(editorialStatus) ? now : undefined,
      published_at: editorialStatus === "published" ? now : undefined
    };
    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
    const chapterUpdates = await filterPayloadToExistingColumns("chapters", updates);
    if (Object.keys(chapterUpdates).length) await supabase.from("chapters").update(chapterUpdates).eq("id", chapterId).eq("novel_id", id);
    await safeDbQuery(
      `UPDATE editor_assignments SET status = $1, updated_at = NOW() WHERE target_type = 'chapter' AND target_id = $2`,
      [["approved", "scheduled", "published"].includes(editorialStatus) ? "closed" : "assigned", chapterId]
    );
    if (novel?.author_id && ["needs_changes", "approved", "scheduled", "published"].includes(editorialStatus)) {
      const statusTitles: Record<string, string> = {
        needs_changes: "فصل نیازمند تغییرات است",
        approved: "فصل تأیید شد",
        scheduled: "فصل زمان‌بندی شد",
        published: "فصل منتشر شد"
      };
      const cleanNote = req.body.note !== undefined ? sanitizePlainText(req.body.note, 5000) : "";
      await createUserNotification(
        novel.author_id,
        `editorial_chapter_${editorialStatus}`,
        statusTitles[editorialStatus],
        editorialStatus === "needs_changes"
          ? `«${chapter?.title || "فصل بدون عنوان"}» نیازمند تغییرات نویسنده است. ${cleanNote ? `یادداشت: ${cleanNote}` : ""}`.trim()
          : `«${chapter?.title || "فصل بدون عنوان"}» در رمان «${novel.title || "رمان بدون عنوان"}» اکنون ${WORKFLOW_STATUS_LABELS[editorialStatus] || editorialStatus.replace("_", " ")} است.`,
        `/novels/${encodeURIComponent(id)}`
      );
    }
    res.json({ success: true, status: editorialStatus });
  } catch (err) {
    console.error("[editor/chapter/status] failed", err);
    res.status(400).json({ error: "به‌روزرسانی وضعیت فصل ناموفق بود" });
  }
});

router.get("/novels/:id/chapters/:chapterId/review-tools", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id, chapterId } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by, content_kind, reading_direction').eq('id', id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });

    const { data: chapter } = await supabase.from("chapters").select("*").eq("id", chapterId).eq("novel_id", id).single();
    if (!chapter) return res.status(404).json({ error: "فصل مورد یافت نشد" });

    // A manga chapter's body is its ordered pages, not HTML. Without them a
    // moderator would see an empty chapter and have nothing to review.
    const contentKind = normalizeContentKind((novel as any)?.content_kind);
    const mangaPages = contentKind === "manga" ? await loadChapterPages(chapterId) : [];

    const [comments, checklist, threads, versions, scans] = await Promise.all([
      safeDbQuery(`SELECT * FROM editor_inline_comments WHERE chapter_id = $1 ORDER BY created_at DESC`, [chapterId]),
      safeDbQuery(`SELECT * FROM editor_review_checklists WHERE chapter_id = $1 AND reviewer_id = $2 LIMIT 1`, [chapterId, user.id]),
      safeDbQuery(`SELECT * FROM editor_threads WHERE novel_id = $1 AND (chapter_id = $2 OR chapter_id IS NULL) ORDER BY updated_at DESC`, [id, chapterId]),
      safeDbQuery(`SELECT id, reason, title, content, status, word_count, created_at FROM chapter_versions WHERE chapter_id = $1 ORDER BY created_at DESC LIMIT 10`, [chapterId]),
      safeDbQuery(`SELECT * FROM content_moderation_scans WHERE chapter_id = $1 OR target_id = $1 ORDER BY created_at DESC LIMIT 10`, [chapterId])
    ]);

    const latestVersion = versions.rows[0];
    const diff = latestVersion ? buildTextDiff(latestVersion.content, chapter.content) : null;
    res.json({
      chapter,
      contentKind,
      readingDirection: normalizeReadingDirection((novel as any)?.reading_direction),
      pages: mangaPages,
      inlineComments: comments.rows,
      checklist: checklist.rows[0] || null,
      threads: threads.rows,
      versions: versions.rows.map((version: any) => ({ ...version, content: undefined })),
      latestDiff: diff,
      scans: scans.rows.map((scan: any) => ({ ...scan, flags: typeof scan.flags === "string" ? JSON.parse(scan.flags) : scan.flags || [] }))
    });
  } catch (err) {
    console.error("[editor/review-tools] failed", err);
    res.status(400).json({ error: "بارگذاری ابزارهای بررسی ناموفق بود" });
  }
});

router.get("/novels/:id/chapters/:chapterId/diff", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id, chapterId } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });
    const { data: chapter } = await supabase.from("chapters").select("*").eq("id", chapterId).eq("novel_id", id).single();
    if (!chapter) return res.status(404).json({ error: "فصل مورد یافت نشد" });
    const versionId = req.query.versionId ? sanitizePlainText(req.query.versionId, 160) : "";
    const versionResult = versionId
      ? await safeDbQuery(`SELECT * FROM chapter_versions WHERE id = $1 AND chapter_id = $2 LIMIT 1`, [versionId, chapterId])
      : await safeDbQuery(`SELECT * FROM chapter_versions WHERE chapter_id = $1 ORDER BY created_at DESC LIMIT 1`, [chapterId]);
    const version = versionResult.rows[0];
    res.json({ version: version ? { ...version, content: undefined } : null, diff: version ? buildTextDiff(version.content, chapter.content) : null });
  } catch {
    res.status(400).json({ error: "ساخت مقایسه نسخه‌ها ناموفق بود" });
  }
});

router.post("/novels/:id/chapters/:chapterId/inline-comments", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id, chapterId } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });
    const comment = sanitizePlainText(req.body.comment, 5000).trim();
    if (!comment) return res.status(400).json({ error: "متن دیدگاه الزامی است" });
    const row = {
      id: `eic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      novel_id: id,
      chapter_id: chapterId,
      anchor_text: sanitizePlainText(req.body.anchorText, 500),
      start_offset: Math.max(0, Number(req.body.startOffset || 0)),
      end_offset: Math.max(0, Number(req.body.endOffset || 0)),
      comment,
      thread_id: req.body.threadId ? sanitizePlainText(req.body.threadId, 160) : null,
      created_by: user.id,
      updated_at: new Date().toISOString()
    };
    await supabase.from("editor_inline_comments").insert(row);
    res.json({ success: true, comment: row });
  } catch {
    res.status(400).json({ error: "ذخیره دیدگاه درون‌خطی ناموفق بود" });
  }
});

router.patch("/inline-comments/:commentId", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { data: inlineComment } = await supabase
      .from("editor_inline_comments")
      .select("id, novel_id, chapter_id")
      .eq("id", req.params.commentId)
      .single();
    if (!inlineComment) return res.status(404).json({ error: "دیدگاه درون‌خطی مورد یافت نشد" });

    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', inlineComment.novel_id).single();
    const hasAccess = inlineComment.chapter_id
      ? await canAccessChapter(user, novel, inlineComment.chapter_id)
      : await canAccessNovel(user, novel);
    if (!hasAccess) return res.status(403).json({ error: "این دیدگاه درون‌خطی به شما واگذار نشده است." });

    const status = ["open", "resolved"].includes(req.body.status) ? req.body.status : "open";
    await supabase.from("editor_inline_comments").update({ status, updated_at: new Date().toISOString() }).eq("id", req.params.commentId);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "به‌روزرسانی دیدگاه درون‌خطی ناموفق بود" });
  }
});

router.post("/novels/:id/chapters/:chapterId/checklist", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id, chapterId } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });
    const checklist = typeof req.body.checklist === "object" && req.body.checklist ? req.body.checklist : {};
    const status = sanitizePlainText(req.body.status || "in_review", 40);
    const row = {
      id: `erc-${chapterId}-${user.id}`,
      novel_id: id,
      chapter_id: chapterId,
      reviewer_id: user.id,
      checklist,
      status,
      updated_at: new Date().toISOString()
    };
    await supabase.from("editor_review_checklists").upsert(row, { onConflict: "chapter_id,reviewer_id" });
    const chapterUpdates = await filterPayloadToExistingColumns("chapters", { editor_checklist: JSON.stringify(checklist) });
    if (Object.keys(chapterUpdates).length) await supabase.from("chapters").update(chapterUpdates).eq("id", chapterId).eq("novel_id", id);
    res.json({ success: true, checklist: row });
  } catch {
    res.status(400).json({ error: "ذخیره چک‌لیست ناموفق بود" });
  }
});

router.post("/novels/:id/chapters/:chapterId/scan", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id, chapterId } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });
    const { data: chapter } = await supabase.from("chapters").select("*").eq("id", chapterId).eq("novel_id", id).single();
    if (!chapter) return res.status(404).json({ error: "فصل مورد یافت نشد" });
    const scan = await analyzeContentText(chapter.content || "", chapter.id);
    const external = await detectAIWriting(chapter.content || "").catch((error) => ({ error: error?.message || "بررسی هوش مصنوعی ناموفق بود" }));
    if (external && "aiScore" in external) {
      scan.aiScore = external.aiScore;
      scan.riskScore = Math.max(scan.riskScore, external.aiScore);
      scan.summary = `${scan.summary} ${external.summary} (${external.provider}، اطمینان ${external.confidence}%).`;
      if (external.aiScore >= 45 && !scan.flags.includes("AI-like")) scan.flags.push("AI-like");
    } else if (external && "error" in external) {
      scan.summary = `${scan.summary} بررسی خارجی هوش مصنوعی در دسترس نیست: ${external.error}.`;
    }
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await saveChapterScan(scanId, chapter, user.id, scan);
    res.json({ success: true, scan: { id: scanId, ...scan } });
  } catch {
    res.status(400).json({ error: "اسکن فصل ناموفق بود" });
  }
});

router.post("/novels/:id/threads", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id } = req.params;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    const requestedChapterId = req.body.chapterId ? sanitizePlainText(req.body.chapterId, 160) : null;
    const hasAccess = requestedChapterId ? await canAccessChapter(user, novel, requestedChapterId) : await canAccessNovel(user, novel);
    if (!hasAccess) return res.status(403).json({ error: "این گفت‌وگوی تحریریه به شما واگذار نشده است." });
    const subject = sanitizePlainText(req.body.subject, 180).trim();
    const content = sanitizePlainText(req.body.content, 10000).trim();
    if (!subject || !content) return res.status(400).json({ error: "موضوع و متن الزامی است" });
    const thread = {
      id: `edt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      novel_id: id,
      chapter_id: requestedChapterId,
      subject,
      created_by: user.id,
      updated_at: new Date().toISOString()
    };
    await supabase.from("editor_threads").insert(thread);
    await supabase.from("editor_thread_messages").insert({ id: `edtm-${Date.now()}`, thread_id: thread.id, sender_id: user.id, content });
    res.json({ success: true, thread });
  } catch {
    res.status(400).json({ error: "ایجاد گفت‌وگو ناموفق بود" });
  }
});

router.post("/threads/:threadId/messages", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { data: thread } = await supabase.from("editor_threads").select("*").eq("id", req.params.threadId).single();
    if (!thread) return res.status(404).json({ error: "گفت‌وگو مورد یافت نشد" });
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', thread.novel_id).single();
    if (!await canAccessNovel(user, novel)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });
    const content = sanitizePlainText(req.body.content, 10000).trim();
    if (!content) return res.status(400).json({ error: "متن الزامی است" });
    await supabase.from("editor_thread_messages").insert({ id: `edtm-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, thread_id: thread.id, sender_id: user.id, content });
    await supabase.from("editor_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread.id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ارسال پیام گفت‌وگو ناموفق بود" });
  }
});

router.get("/threads/:threadId/messages", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { data: thread } = await supabase.from("editor_threads").select("*").eq("id", req.params.threadId).single();
    if (!thread) return res.status(404).json({ error: "گفت‌وگو مورد یافت نشد" });
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', thread.novel_id).single();
    if (!await canAccessNovel(user, novel)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });
    const { rows } = await safeDbQuery(`SELECT m.*, u.username FROM editor_thread_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.thread_id = $1 ORDER BY m.created_at ASC`, [thread.id]);
    res.json({ thread, messages: rows.map((message: any) => ({ ...message, is_editor: message.sender_id === user.id })) });
  } catch {
    res.status(400).json({ error: "بارگذاری پیام‌های گفت‌وگو ناموفق بود" });
  }
});

router.post("/novels/:id/chapters/bulk", async (req, res) => {
  try {
    await ensureOperationalTables().catch(() => {});
    const user = (req as any).user;
    const { id } = req.params;
    const chapterIds = Array.isArray(req.body.chapterIds) ? req.body.chapterIds.map((item: any) => sanitizePlainText(item, 160)).filter(Boolean) : [];
    const action = sanitizePlainText(req.body.action, 40);
    const note = sanitizePlainText(req.body.note, 2000);
    const workflowAction = action === "approve" ? "approved" : action;
    if (!chapterIds.length || ![...CHAPTER_WORKFLOW_STATUSES, "delete", "quarantine"].includes(workflowAction)) return res.status(400).json({ error: "داده‌های گروهی نامعتبر است" });
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!await canAccessNovel(user, novel)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });
    const { data: scopedChapters } = await supabase
      .from("chapters")
      .select("id")
      .eq("novel_id", id)
      .in("id", chapterIds);
    const scopedChapterIds = new Set((scopedChapters || []).map((chapter: any) => String(chapter.id)));
    if (scopedChapterIds.size !== chapterIds.length) {
      return res.status(400).json({ error: "یک یا چند فصل انتخاب‌شده به این رمان تعلق ندارند." });
    }

    if (workflowAction === "delete") {
      await supabase.from("chapters").delete().eq("novel_id", id).in("id", chapterIds);
    } else {
      const editorialStatus = workflowAction === "quarantine" ? "needs_changes" : workflowAction;
      const status = workflowAction === "quarantine" ? "Draft" : chapterVisibilityStatus(editorialStatus);
      const moderation_status = workflowAction === "quarantine" ? "quarantined" : editorialStatus === "needs_changes" ? "needs_changes" : "visible";
      const updates: any = {
        status,
        editorial_status: editorialStatus,
        moderation_status,
        editor_note: note
      };
      if (["approved", "scheduled", "published"].includes(editorialStatus)) {
        updates.approved_by = user.id;
        updates.approved_at = new Date().toISOString();
      }
      if (editorialStatus === "submitted") updates.submitted_at = new Date().toISOString();
      if (editorialStatus === "published") updates.published_at = new Date().toISOString();
      const chapterUpdates = await filterPayloadToExistingColumns("chapters", updates);
      if (Object.keys(chapterUpdates).length) await supabase.from("chapters").update(chapterUpdates).eq("novel_id", id).in("id", chapterIds);
      if (novel?.author_id && ["needs_changes", "approved", "scheduled", "published"].includes(editorialStatus)) {
        const statusTitles: Record<string, string> = {
          needs_changes: "فصل‌ها نیازمند تغییرات هستند",
          approved: "فصل‌ها تأیید شدند",
          scheduled: "فصل‌ها زمان‌بندی شدند",
          published: "فصل‌ها منتشر شدند"
        };
        await createUserNotification(
          novel.author_id,
          `editorial_chapters_${editorialStatus}`,
          statusTitles[editorialStatus],
          `${chapterIds.length} فصل در رمان «${novel.title || "رمان بدون عنوان"}» ${editorialStatus === "needs_changes" ? "نیازمند تغییرات نویسنده است" : `اکنون ${WORKFLOW_STATUS_LABELS[editorialStatus] || editorialStatus.replace("_", " ")} است`}.${note ? ` یادداشت: ${note}` : ""}`,
          `/novels/${encodeURIComponent(id)}`
        );
      }
    }
    res.json({ success: true, updated: chapterIds.length });
  } catch {
    res.status(400).json({ error: "اعمال کنش گروهی ناموفق بود" });
  }
});

router.delete("/novels/:id/chapters/:chapterId", async (req, res) => {
  try {
    const { chapterId } = req.params;
    const user = (req as any).user;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', req.params.id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });

    await supabase.from('chapters').delete().eq('id', chapterId).eq('novel_id', req.params.id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف ناموفق بود" });
  }
});

router.post("/novels/:id/chapters/:chapterId/note", async (req, res) => {
  try {
    const { chapterId } = req.params;
    const { note } = req.body;
    const user = (req as any).user;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', req.params.id).single();
    if (!await canAccessChapter(user, novel, chapterId)) return res.status(403).json({ error: "این فصل به شما واگذار نشده است." });

    await supabase.from('chapters').update({ editor_note: sanitizePlainText(note, 5000) }).eq('id', chapterId).eq('novel_id', req.params.id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ذخیره یادداشت ناموفق بود" });
  }
});

router.get("/novels/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const { data: novel } = await supabase.from('novels').select('id, author_id, approved_by').eq('id', id).single();
    if (!await canAccessNovel(user, novel)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });

    const { data: msgs } = await supabase.from('editor_messages').select('*').eq('novel_id', id).order('created_at', { ascending: true });
    
    // We also need to know if sender is editor or author to colorize
    const mapped = msgs?.map(m => ({
      ...m,
      is_editor: m.sender_id === user.id
    })) || [];

    res.json(mapped);
  } catch {
    res.status(400).json({ error: "ناموفق بود" });
  }
});

router.post("/novels/:id/messages", async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const content = sanitizePlainText(req.body.content, 10000);

    const { data: nvl } = await supabase.from('novels').select('author_id, approved_by').eq('id', id).single();
    if (!nvl) return res.status(404).json({ error: "رمان مورد یافت نشد" });
    if (!await canAccessNovel(user, nvl)) return res.status(403).json({ error: "این رمان به شما واگذار نشده است." });

    await supabase.from('editor_messages').insert({
      id: "edmsg-" + Date.now() + Math.random().toString(36).substr(2,5),
      novel_id: id,
      sender_id: user.id,
      receiver_id: nvl.author_id,
      content
    });

    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ارسال پیام ناموفق بود" });
  }
});

export default router;

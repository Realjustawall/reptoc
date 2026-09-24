import express from "express";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../postgres";
import { getActiveUser, isOwnerUser } from "../../utils/auth";
import { sanitizePlainText } from "../../utils/content";
import { normalizeStoredImageReference } from "../../utils/images";
import { filterExistingColumns } from "../../utils/dbSchema";
import { interactionLimiter } from "../limiters";
import { createUserNotification } from "../../utils/notifications";
import { logAdminAction } from "../../utils/audit";

const router = express.Router();
type ChallengeType = "continuation" | "story_naming";

function normalizeChallengeType(value: unknown): ChallengeType {
  return value === "story_naming" ? "story_naming" : "continuation";
}

/**
 * Audio references accepted for a challenge prompt.
 *
 * Only files stored by the platform's own upload endpoints are allowed: an
 * arbitrary remote URL would let an admin turn the page into a hotlink for
 * third-party media and leak every visitor's IP to that host.
 */
const LOCAL_AUDIO_REFERENCE = /^\/(?:uploads\/[a-zA-Z0-9_.-]+\.(?:mp3|m4a|ogg|wav|weba|webm|flac)|api\/(?:files|upload)\/[a-zA-Z0-9_.-]+\/content)$/i;

export function normalizeChallengeAudioReference(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!LOCAL_AUDIO_REFERENCE.test(raw)) {
    throw new Error("فایل صوتی باید از طریق بارگذاری در رپتوک انتخاب شود.");
  }
  return raw;
}

function mapChallenge(row: any, counts?: { pending: number; approved: number; rejected: number }) {
  return {
    id: row.id,
    title: row.title,
    promptText: row.prompt_text,
    imageUrl: row.image_url || "",
    audioUrl: row.audio_url || "",
    challengeType: normalizeChallengeType(row.challenge_type),
    winnersAnnouncedAt: row.winners_announced_at || null,
    status: row.status || "active",
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    counts: counts || null
  };
}

/**
 * Media columns arrive with migration 074. Reading them conditionally keeps the
 * challenge pages working on a deployment that has not migrated yet.
 */
async function challengeMediaColumns(): Promise<string[]> {
  return filterExistingColumns("daily_challenges", ["image_url", "audio_url"]);
}

async function challengeCompetitionColumns(): Promise<{ challenge: string[]; entry: string[] }> {
  const [challenge, entry] = await Promise.all([
    filterExistingColumns("daily_challenges", ["challenge_type", "winners_announced_at"]),
    filterExistingColumns("daily_challenge_entries", ["winner_rank"]),
  ]);
  return { challenge, entry };
}

function mapEntry(row: any) {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    userId: row.user_id,
    username: row.username || "خواننده",
    content: row.content,
    moderationStatus: row.moderation_status,
    winnerRank: row.winner_rank == null ? null : Number(row.winner_rank),
    createdAt: row.created_at
  };
}

async function loadOwner(req: express.Request) {
  const user = await getActiveUser(req, true);
  if (!user || !isOwnerUser(user)) return null;
  return user;
}

// ---- Public ------------------------------------------------------------

router.get("/active", async (req, res) => {
  try {
    const page = Math.max(1, Math.min(200, Number(req.query.page) || 1));
    const pageSize = Math.max(1, Math.min(50, Number(req.query.pageSize) || 20));
    // `select("*")` already includes the media columns once migration 074 has
    // run, and simply omits them beforehand; mapChallenge defaults them to "".
    const { data: challenges } = await supabase
      .from("daily_challenges")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    const challenge = challenges?.[0];
    if (!challenge) return res.json({ challenge: null, entries: [], pagination: { page, pageSize, total: 0 }, viewerEntry: null });

    const mappedChallenge = mapChallenge(challenge);
    const isNamingChallenge = mappedChallenge.challengeType === "story_naming";
    const resultsArePublic = !isNamingChallenge || !!mappedChallenge.winnersAnnouncedAt;
    let publicEntriesQuery: any = supabase
      .from("daily_challenge_entries")
      .select("*")
      .eq("challenge_id", challenge.id)
      .eq("moderation_status", "approved");
    if (isNamingChallenge) {
      publicEntriesQuery = publicEntriesQuery.not("winner_rank", "is", null).order("winner_rank", { ascending: true });
    } else {
      publicEntriesQuery = publicEntriesQuery.order("created_at", { ascending: false });
    }
    publicEntriesQuery = publicEntriesQuery.limit(pageSize).offset((page - 1) * pageSize);
    let publicCountQuery: any = supabase
      .from("daily_challenge_entries")
      .select("id", { count: "exact", head: true })
      .eq("challenge_id", challenge.id)
      .eq("moderation_status", "approved");
    if (isNamingChallenge) publicCountQuery = publicCountQuery.not("winner_rank", "is", null);

    const [entriesResult, countResult, submissionCountResult, user] = await Promise.all([
      resultsArePublic ? publicEntriesQuery : Promise.resolve({ data: [] }),
      resultsArePublic ? publicCountQuery : Promise.resolve({ count: 0 }),
      supabase
        .from("daily_challenge_entries")
        .select("id", { count: "exact", head: true })
        .eq("challenge_id", challenge.id),
      getActiveUser(req, false)
    ]);

    let viewerEntry: any = null;
    if (user) {
      const { data: own } = await supabase
        .from("daily_challenge_entries")
        .select("*")
        .eq("challenge_id", challenge.id)
        .eq("user_id", user.id)
        .limit(1);
      if (own?.[0]) {
        viewerEntry = mapEntry(own[0]);
        // A participant must not learn that they were preselected before the
        // owner intentionally publishes the result.
        if (isNamingChallenge && !mappedChallenge.winnersAnnouncedAt) viewerEntry.winnerRank = null;
      }
    }

    res.json({
      challenge: mappedChallenge,
      entries: (entriesResult.data || []).map(mapEntry),
      pagination: { page, pageSize, total: countResult.count || 0 },
      submissionCount: submissionCountResult.count || 0,
      viewerEntry
    });
  } catch {
    res.status(400).json({ error: "بارگذاری چالش روزانه ناموفق بود." });
  }
});

router.post("/active/:id/entries", interactionLimiter, async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "برای شرکت در چالش ابتدا وارد حساب شوید." });

    const { data: challenge } = await supabase
      .from("daily_challenges")
      .select("*")
      .eq("id", req.params.id)
      .eq("status", "active")
      .single();
    if (!challenge) return res.status(404).json({ error: "چالش فعال یافت نشد." });

    const challengeType = normalizeChallengeType((challenge as any).challenge_type);
    const contentLimit = challengeType === "story_naming" ? 140 : 5000;
    const content = sanitizePlainText(req.body?.content, contentLimit).trim();
    if (challengeType === "story_naming") {
      if (content.length < 2) return res.status(400).json({ error: "نام پیشنهادی باید حداقل ۲ کاراکتر باشد." });
      if (/\r|\n/.test(content)) return res.status(400).json({ error: "نام پیشنهادی باید در یک خط نوشته شود." });
    } else if (content.length < 10) {
      return res.status(400).json({ error: "ادامهٔ نوشته باید حداقل ۱۰ کاراکتر باشد." });
    }

    const { data: existing } = await supabase
      .from("daily_challenge_entries")
      .select("id")
      .eq("challenge_id", challenge.id)
      .eq("user_id", user.id)
      .limit(1);
    if (existing?.length) return res.status(400).json({ error: "شما قبلاً در این چالش شرکت کرده‌اید." });

    const entryId = `dce-${uuidv4()}`;
    const { error: insertError } = await supabase.from("daily_challenge_entries").insert({
      id: entryId,
      challenge_id: challenge.id,
      user_id: user.id,
      username: user.username || "",
      content
    });
    if (insertError) {
      if ((insertError as any)?.code === "23505") return res.status(400).json({ error: "شما قبلاً در این چالش شرکت کرده‌اید." });
      throw insertError;
    }

    res.status(201).json({
      success: true,
      message: "شرکت شما ثبت شد و پس از تأیید مدیر نمایش داده می‌شود.",
      entry: { id: entryId, challengeId: challenge.id, moderationStatus: "pending" }
    });
  } catch {
    res.status(400).json({ error: "ثبت مشارکت در چالش ناموفق بود." });
  }
});

router.get("/mine", async (req, res) => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز." });
    const { data } = await supabase
      .from("daily_challenge_entries")
      .select("*, daily_challenges(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    res.json({
      entries: (data || []).map((row: any) => {
        const parent = row.daily_challenges as any;
        const entry = mapEntry(row);
        const challengeType = normalizeChallengeType(parent?.challenge_type);
        if (challengeType === "story_naming" && !parent?.winners_announced_at) entry.winnerRank = null;
        return {
          ...entry,
          challengeTitle: parent?.title || "",
          challengeType,
          winnersAnnouncedAt: parent?.winners_announced_at || null,
        };
      })
    });
  } catch {
    res.status(400).json({ error: "بارگذاری مشارکت‌های شما ناموفق بود." });
  }
});

// ---- Admin (owner only) -------------------------------------------------

router.get("/admin/list", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const { data: challenges } = await supabase
      .from("daily_challenges")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    const challengeIds = (challenges || []).map((c: any) => c.id);
    let entriesByChallenge = new Map<string, any[]>();
    if (challengeIds.length) {
      const { data: entries } = await supabase
        .from("daily_challenge_entries")
        .select("*")
        .in("challenge_id", challengeIds)
        .order("created_at", { ascending: false })
        .limit(2000);
      for (const entry of entries || []) {
        const list = entriesByChallenge.get(entry.challenge_id) || [];
        list.push(entry);
        entriesByChallenge.set(entry.challenge_id, list);
      }
    }

    res.json({
      challenges: (challenges || []).map((row: any) => {
        const entries = entriesByChallenge.get(row.id) || [];
        return {
          ...mapChallenge(row),
          counts: {
            pending: entries.filter((e) => e.moderation_status === "pending").length,
            approved: entries.filter((e) => e.moderation_status === "approved").length,
            rejected: entries.filter((e) => e.moderation_status === "rejected").length
          },
          entries: entries.slice(0, 100).map(mapEntry)
        };
      })
    });
  } catch {
    res.status(400).json({ error: "بارگذاری مدیریت چالش‌ها ناموفق بود." });
  }
});

router.post("/admin/create", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const title = sanitizePlainText(req.body?.title, 140).trim();
    const promptText = sanitizePlainText(req.body?.promptText, 5000).trim();
    const requestedType = String(req.body?.challengeType || "continuation");
    if (requestedType !== "continuation" && requestedType !== "story_naming") {
      return res.status(400).json({ error: "نوع چالش معتبر نیست." });
    }
    const challengeType = requestedType as ChallengeType;
    if (title.length < 3) return res.status(400).json({ error: "عنوان چالش باید حداقل ۳ کاراکتر باشد." });
    // A prompt may be carried by the picture or the narration instead of text,
    // so the text minimum only applies when there is no media.
    const hasMedia = !!String(req.body?.imageUrl || "").trim() || !!String(req.body?.audioUrl || "").trim();
    if (!hasMedia && promptText.length < 20) {
      return res.status(400).json({ error: "متن آغازین چالش باید حداقل ۲۰ کاراکتر باشد (یا تصویر/صدا اضافه کنید)." });
    }
    if (hasMedia && promptText.length === 0 && title.length < 3) {
      return res.status(400).json({ error: "برای چالش رسانه‌ای، عنوان الزامی است." });
    }

    let imageUrl = "";
    let audioUrl = "";
    try {
      imageUrl = normalizeStoredImageReference(req.body?.imageUrl, { allowEmpty: true });
      audioUrl = normalizeChallengeAudioReference(req.body?.audioUrl);
    } catch (mediaError: any) {
      return res.status(400).json({ error: mediaError?.message || "نشانی رسانهٔ چالش معتبر نیست." });
    }
    if (challengeType === "story_naming" && !imageUrl) {
      return res.status(400).json({ error: "چالش نام‌گذاری داستان باید تصویر داشته باشد." });
    }

    const [mediaColumns, competitionColumns] = await Promise.all([
      challengeMediaColumns(),
      challengeCompetitionColumns(),
    ]);
    if ((imageUrl || audioUrl) && mediaColumns.length < 2) {
      return res.status(503).json({
        error: "ستون‌های رسانهٔ چالش هنوز ساخته نشده‌اند. ابتدا npm run db:migrate را اجرا کنید.",
      });
    }
    if (challengeType === "story_naming" && (competitionColumns.challenge.length < 2 || competitionColumns.entry.length < 1)) {
      return res.status(503).json({ error: "ساختار نوع و برندگان چالش هنوز آماده نیست. ابتدا npm run db:migrate را اجرا کنید." });
    }

    // A daily challenge reads best with a single active stage; archive others.
    await supabase.from("daily_challenges").update({ status: "archived", updated_at: new Date().toISOString() }).eq("status", "active");

    const id = `dc-${uuidv4()}`;
    const { error } = await supabase.from("daily_challenges").insert({
      id,
      title,
      prompt_text: promptText,
      status: "active",
      created_by: owner.id,
      ...(competitionColumns.challenge.includes("challenge_type") ? { challenge_type: challengeType } : {}),
      ...(mediaColumns.includes("image_url") ? { image_url: imageUrl || null } : {}),
      ...(mediaColumns.includes("audio_url") ? { audio_url: audioUrl || null } : {})
    });
    if (error) throw error;

    try { await logAdminAction(owner.id, null, "daily_challenge_created", { challengeId: id, title, challengeType, hasImage: !!imageUrl, hasAudio: !!audioUrl }); } catch {}
    res.status(201).json({ success: true, challenge: { id, title, status: "active", challengeType, imageUrl, audioUrl } });
  } catch (error: any) {
    console.error("[challenges] create failed", { code: error?.code, message: error?.message || String(error) });
    res.status(400).json({ error: "ساخت چالش ناموفق بود." });
  }
});

router.post("/admin/entries/:entryId/moderate", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const action = req.body?.action === "approve" ? "approve" : req.body?.action === "reject" ? "reject" : null;
    if (!action) return res.status(400).json({ error: "اقدام معتبر نیست (approve/reject)." });

    const { data: entry } = await supabase
      .from("daily_challenge_entries")
      .select("*, daily_challenges(*)")
      .eq("id", req.params.entryId)
      .single();
    if (!entry) return res.status(404).json({ error: "مشارکت یافت نشد." });

    const nextStatus = action === "approve" ? "approved" : "rejected";
    const competitionColumns = await challengeCompetitionColumns();
    const { error } = await supabase
      .from("daily_challenge_entries")
      .update({
        moderation_status: nextStatus,
        approved_at: new Date().toISOString(),
        approved_by: owner.id,
        ...(nextStatus === "rejected" && competitionColumns.entry.includes("winner_rank") ? { winner_rank: null } : {}),
      })
      .eq("id", entry.id);
    if (error) throw error;

    if (nextStatus === "approved" && entry.user_id) {
      const isNaming = normalizeChallengeType((entry.daily_challenges as any)?.challenge_type) === "story_naming";
      await createUserNotification(
        entry.user_id,
        "challenge_entry_approved",
        "مشارکت چالش تأیید شد",
        isNaming
          ? "نام پیشنهادی شما در چالش تأیید شد و وارد مرحلهٔ انتخاب برندگان شد."
          : "ادامهٔ نوشتهٔ شما در چالش روزانه تأیید و منتشر شد. آفرین!",
        "/challenges"
      );
    }

    try { await logAdminAction(owner.id, null, `daily_challenge_entry_${action}`, { entryId: entry.id }); } catch {}
    res.json({ success: true, status: nextStatus });
  } catch {
    res.status(400).json({ error: "بررسی مشارکت ناموفق بود." });
  }
});

router.delete("/admin/entries/:entryId", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    const { data: deleted } = await supabase
      .from("daily_challenge_entries")
      .delete()
      .eq("id", req.params.entryId)
      .select("id");
    if (!deleted?.length) return res.status(404).json({ error: "مشارکت یافت نشد." });
    try { await logAdminAction(owner.id, null, "daily_challenge_entry_deleted", { entryId: req.params.entryId }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف مشارکت ناموفق بود." });
  }
});

router.post("/admin/:challengeId/winners", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const columns = await challengeCompetitionColumns();
    if (!columns.challenge.includes("winners_announced_at") || !columns.entry.includes("winner_rank")) {
      return res.status(503).json({ error: "ساختار برندگان چالش هنوز آماده نیست. ابتدا npm run db:migrate را اجرا کنید." });
    }

    const rankedEntryIds = Array.isArray(req.body?.rankedEntryIds)
      ? req.body.rankedEntryIds.map((value: unknown) => String(value || "").trim()).filter(Boolean)
      : [];
    const announce = req.body?.announce === true;
    if (rankedEntryIds.length > 3 || new Set(rankedEntryIds).size !== rankedEntryIds.length) {
      return res.status(400).json({ error: "حداکثر سه مشارکت یکتا را به‌عنوان برنده انتخاب کنید." });
    }
    if (announce && rankedEntryIds.length === 0) {
      return res.status(400).json({ error: "برای اعلام نتیجه، دست‌کم یک برنده انتخاب کنید." });
    }

    const { data: challenge } = await supabase
      .from("daily_challenges")
      .select("*")
      .eq("id", req.params.challengeId)
      .single();
    if (!challenge) return res.status(404).json({ error: "چالش یافت نشد." });
    if (normalizeChallengeType(challenge.challenge_type) !== "story_naming") {
      return res.status(400).json({ error: "انتخاب سه نام برتر فقط برای چالش نام‌گذاری داستان است." });
    }

    let winners: any[] = [];
    if (rankedEntryIds.length) {
      const { data } = await supabase
        .from("daily_challenge_entries")
        .select("id, challenge_id, user_id, username, content, moderation_status")
        .eq("challenge_id", challenge.id)
        .in("id", rankedEntryIds);
      winners = data || [];
      if (winners.length !== rankedEntryIds.length || winners.some((entry) => entry.moderation_status !== "approved")) {
        return res.status(400).json({ error: "فقط مشارکت‌های تأییدشدهٔ همین چالش می‌توانند برنده شوند." });
      }
    }

    const { error: clearError } = await supabase
      .from("daily_challenge_entries")
      .update({ winner_rank: null })
      .eq("challenge_id", challenge.id);
    if (clearError) throw clearError;
    for (let index = 0; index < rankedEntryIds.length; index += 1) {
      const { error } = await supabase
        .from("daily_challenge_entries")
        .update({ winner_rank: index + 1 })
        .eq("id", rankedEntryIds[index])
        .eq("challenge_id", challenge.id);
      if (error) throw error;
    }

    const wasAnnounced = !!challenge.winners_announced_at;
    const announcedAt = announce ? new Date().toISOString() : null;
    const { error: challengeError } = await supabase
      .from("daily_challenges")
      .update({ winners_announced_at: announcedAt, updated_at: new Date().toISOString() })
      .eq("id", challenge.id);
    if (challengeError) throw challengeError;

    if (announce && !wasAnnounced) {
      for (let index = 0; index < rankedEntryIds.length; index += 1) {
        const winner = winners.find((entry) => entry.id === rankedEntryIds[index]);
        if (!winner?.user_id) continue;
        await createUserNotification(
          winner.user_id,
          "challenge_winner",
          `رتبهٔ ${index + 1} چالش نام‌گذاری`,
          `نام پیشنهادی «${winner.content}» در میان برندگان چالش «${challenge.title}» قرار گرفت.`,
          "/challenges"
        );
      }
      const { data: participants } = await supabase.from("daily_challenge_entries").select("user_id").eq("challenge_id", challenge.id).eq("moderation_status", "approved");
      const winnerIds = new Set(winners.map((entry) => String(entry.user_id || "")).filter(Boolean));
      const participantIds: string[] = [...new Set<string>((participants || []).map((entry: any) => String(entry.user_id || "")).filter(Boolean))];
      await Promise.all(participantIds.filter((userId) => !winnerIds.has(userId)).map((userId) => createUserNotification(
        userId, "challenge_result", "نتیجهٔ چالش اعلام شد", `نتیجهٔ چالش «${challenge.title}» منتشر شد. سه نام برتر را ببینید.`, "/challenges"
      )));
    }

    try {
      await logAdminAction(owner.id, null, announce ? "daily_challenge_winners_announced" : "daily_challenge_winners_saved", {
        challengeId: challenge.id,
        rankedEntryIds,
        announced: announce,
      });
    } catch {}
    res.json({ success: true, winnersAnnouncedAt: announcedAt });
  } catch (error: any) {
    console.error("[challenges] winners update failed", { code: error?.code, message: error?.message || String(error) });
    res.status(400).json({ error: "ذخیره یا اعلام برندگان ناموفق بود." });
  }
});

router.patch("/admin/:challengeId", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });

    const title = req.body?.title !== undefined ? sanitizePlainText(req.body.title, 140).trim() : undefined;
    const promptText = req.body?.promptText !== undefined ? sanitizePlainText(req.body.promptText, 5000).trim() : undefined;
    const mediaColumns = await challengeMediaColumns();
    let imageUrl: string | undefined;
    let audioUrl: string | undefined;
    try {
      // An empty string clears the media; `undefined` leaves it untouched.
      if (req.body?.imageUrl !== undefined) imageUrl = normalizeStoredImageReference(req.body.imageUrl, { allowEmpty: true });
      if (req.body?.audioUrl !== undefined) audioUrl = normalizeChallengeAudioReference(req.body.audioUrl);
    } catch (mediaError: any) {
      return res.status(400).json({ error: mediaError?.message || "نشانی رسانهٔ چالش معتبر نیست." });
    }
    if ((imageUrl !== undefined || audioUrl !== undefined) && mediaColumns.length < 2) {
      return res.status(503).json({
        error: "ستون‌های رسانهٔ چالش هنوز ساخته نشده‌اند. ابتدا npm run db:migrate را اجرا کنید.",
      });
    }

    if (title !== undefined && title.length < 3) return res.status(400).json({ error: "عنوان چالش باید حداقل ۳ کاراکتر باشد." });
    if (promptText !== undefined || imageUrl !== undefined || audioUrl !== undefined) {
      const { data: current } = await supabase
        .from("daily_challenges")
        .select("*")
        .eq("id", req.params.challengeId)
        .single();
      if (!current) return res.status(404).json({ error: "چالش یافت نشد." });
      const effectiveImage = imageUrl === undefined ? String(current.image_url || "") : imageUrl;
      const effectiveAudio = audioUrl === undefined ? String(current.audio_url || "") : audioUrl;
      const effectivePrompt = promptText === undefined ? String(current.prompt_text || "") : promptText;
      const currentType = normalizeChallengeType(current.challenge_type);
      if (currentType === "story_naming" && !effectiveImage) {
        return res.status(400).json({ error: "چالش نام‌گذاری داستان باید تصویر داشته باشد." });
      }
      if (currentType === "continuation" && effectivePrompt.length < 20 && !effectiveImage && !effectiveAudio) {
        return res.status(400).json({ error: "متن آغازین باید حداقل ۲۰ کاراکتر باشد یا همراه تصویر/صدا منتشر شود." });
      }
    }
    if (title === undefined && promptText === undefined && imageUrl === undefined && audioUrl === undefined) {
      return res.status(400).json({ error: "چیزی برای ویرایش ارسال نشده است." });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (promptText !== undefined) updates.prompt_text = promptText;
    if (imageUrl !== undefined && mediaColumns.includes("image_url")) updates.image_url = imageUrl || null;
    if (audioUrl !== undefined && mediaColumns.includes("audio_url")) updates.audio_url = audioUrl || null;

    const { data: updated, error } = await supabase
      .from("daily_challenges")
      .update(updates)
      .eq("id", req.params.challengeId)
      .select("id");
    if (error) throw error;
    if (!updated?.length) return res.status(404).json({ error: "چالش یافت نشد." });

    try { await logAdminAction(owner.id, null, "daily_challenge_updated", { challengeId: req.params.challengeId }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "ویرایش چالش ناموفق بود." });
  }
});

router.post("/admin/:challengeId/archive", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    const { error } = await supabase
      .from("daily_challenges")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", req.params.challengeId);
    if (error) throw error;
    try { await logAdminAction(owner.id, null, "daily_challenge_archived", { challengeId: req.params.challengeId }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "بایگانی چالش ناموفق بود." });
  }
});

router.delete("/admin/:challengeId", async (req, res) => {
  try {
    const owner = await loadOwner(req);
    if (!owner) return res.status(403).json({ error: "دسترسی مالک لازم است." });
    const { data: deleted } = await supabase
      .from("daily_challenges")
      .delete()
      .eq("id", req.params.challengeId)
      .select("id");
    if (!deleted?.length) return res.status(404).json({ error: "چالش یافت نشد." });
    try { await logAdminAction(owner.id, null, "daily_challenge_deleted", { challengeId: req.params.challengeId }); } catch {}
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "حذف چالش ناموفق بود." });
  }
});

export default router;

import { db, supabase } from "../postgres";
import { internalAwardXP } from "../api/routes/forums";
import { isSchemaPermissionError, reportSchemaGapOnce, runOptionalSchemaQueries } from "./dbSchema";
import { createUserNotification } from "./notifications";
import { userAchievementSettingsKey, userStatsKey } from "./usernames";
import { Mutex } from "async-mutex";
import { v4 as uuidv4 } from "uuid";

export const ACHIEVEMENTS = [
  // Secret achievements are valid award definitions, but are deliberately
  // filtered out of every public achievement catalogue response.
  { id: 'ach_secret_easter_founder', category: 'Secret', title: 'کاشف راز قهوه', description: 'قوری کوچک پنهان‌شده پشت لینک قهوه را پیدا کردید.', reward_xp: 418, icon: 'Coffee' },
  // Readers
  { id: 'ach_reader_first', category: 'Readers', title: 'اولین واژه‌ها', description: 'اولین فصل خود را در وب‌سایت بخوانید.', reward_xp: 50, icon: 'BookOpen' },
  { id: 'ach_reader_100', category: 'Readers', title: 'خواننده حرفه‌ای', description: 'در مجموع 100 فصل بخوانید.', reward_xp: 200, icon: 'BookMarked' },
  { id: 'ach_reader_1000', category: 'Readers', title: 'خواننده بی‌پایان', description: '1000 فصل بخوانید.', reward_xp: 1000, icon: 'Book' },
  { id: 'ach_reader_7days', category: 'Readers', title: 'خواننده وفادار', description: '7 روز پیاپی وارد وب‌سایت شوید.', reward_xp: 150, icon: 'Flame' },
  { id: 'ach_reader_midnight', category: 'Readers', title: 'جغد شب', description: '20 بار بعد از نیمه‌شب فصل بخوانید.', reward_xp: 200, icon: 'Moon' },
  { id: 'ach_reader_collector', category: 'Readers', title: 'کلکسیونر کتابخانه', description: '50 رمان به کتابخانه‌تان اضافه کنید.', reward_xp: 250, icon: 'Library' },
  { id: 'ach_reader_critic', category: 'Readers', title: 'منتقد', description: '25 نقد یا دیدگاه منتشر کنید.', reward_xp: 300, icon: 'MessageSquare' },
  { id: 'ach_reader_supporter', category: 'Readers', title: 'حامی', description: 'برای اولین بار به نویسنده‌ها ستاره بدهید یا از آن‌ها حمایت کنید.', reward_xp: 100, icon: 'Star' },

  // Authors
  { id: 'ach_author_first', category: 'Authors', title: 'اولین انتشار', description: 'اولین فصل خود را منتشر کنید.', reward_xp: 100, icon: 'PenTool' },
  { id: 'ach_author_100followers', category: 'Authors', title: 'نویسنده نوظهور', description: 'به 100 دنبال‌کننده برسید.', reward_xp: 500, icon: 'TrendingUp' },
  { id: 'ach_author_10kviews', category: 'Authors', title: 'نویسنده مشهور', description: 'در مجموع به 10000 بازدید برسید.', reward_xp: 800, icon: 'Eye' },
  { id: 'ach_author_trending', category: 'Authors', title: 'نویسنده پرمخاطب', description: 'وارد رتبه‌های پرطرفدار شوید.', reward_xp: 1000, icon: 'Activity' },
  { id: 'ach_author_7days', category: 'Authors', title: 'نویسنده پرتلاش', description: '7 روز متوالی فصل بارگذاری کنید.', reward_xp: 400, icon: 'Calendar' },
  { id: 'ach_author_100chapters', category: 'Authors', title: 'نویسنده ماراتنی', description: '100 فصل منتشر کنید.', reward_xp: 1500, icon: 'Award' },
  { id: 'ach_author_favorite', category: 'Authors', title: 'محبوب مخاطبان', description: 'امتیازهای بالایی از خوانندگان دریافت کنید.', reward_xp: 1000, icon: 'Heart' },
  { id: 'ach_author_1mviews', category: 'Authors', title: 'نویسنده افسانه‌ای', description: 'در مجموع به 1 میلیون بازدید برسید.', reward_xp: 5000, icon: 'Crown' },

  // Community
  { id: 'ach_comm_early', category: 'Community', title: 'حامی اولیه', description: 'در دوره آغازین راه‌اندازی وب‌سایت عضو شدید.', reward_xp: 300, icon: 'Compass' },
  { id: 'ach_comm_event', category: 'Community', title: 'قهرمان رویدادها', description: 'در رویداد رسمی وب‌سایت برنده شوید.', reward_xp: 2000, icon: 'Trophy' },
  { id: 'ach_comm_helpful', category: 'Community', title: 'عضو کارآمد', description: 'لایک‌های زیادی روی دیدگاه‌ها یا نقد دریافت کنید.', reward_xp: 500, icon: 'ThumbsUp' },
  { id: 'ach_comm_verified', category: 'Community', title: 'نویسنده تأییدشده', description: 'به‌طور رسمی توسط وب‌سایت تأیید شوید.', reward_xp: 1000, icon: 'CheckCircle' }
];

let achievementTablesReady: Promise<void> | null = null;
let achievementTablesWritable = true;
const achievementAwardMutex = new Mutex();

function isAchievementTableUnavailable(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return isSchemaPermissionError(error) || ["42P01", "42703"].includes(code) || message.includes("user_achievements");
}

export async function ensureAchievementTables() {
  if (!achievementTablesReady) {
    achievementTablesReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS achievements (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          reward_xp INTEGER DEFAULT 0,
          icon TEXT,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS user_achievements (
          id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          UNIQUE (user_id, achievement_id)
        )
      `, `CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON user_achievements(achievement_id)`]);
      achievementTablesWritable = true;
    })().catch((error) => {
      // The settings-backed fallback keeps achievements working when the role
      // cannot create the normalized tables, so this is not fatal. Keep the
      // memo so the refused DDL is not retried on every request.
      achievementTablesWritable = false;
      reportSchemaGapOnce("achievement tables", error);
    });
  }
  return achievementTablesReady;
}

// Helper to seed achievements table if empty
export async function seedAchievements() {
  try {
    await ensureAchievementTables();
    const { count } = await supabase.from('achievements').select('*', { count: 'exact', head: true });
    if (count === 0 || count === null) {
      console.log('Seeding achievements...');
      // Ensure table is created
      await supabase.from('achievements').upsert(ACHIEVEMENTS, { onConflict: 'id' });
    }
  } catch (err) {
    achievementTablesWritable = false;
    console.log("Achievements table setup unavailable; settings fallback active.");
  }
}

async function getClaimedAchievementsFromSettings(userId: string, username?: string) {
  const achKey = userAchievementSettingsKey(userId);
  const { data: existingSettings } = await supabase.from('settings').select('setting_value').eq('setting_key', achKey).single();
  let claimedList: string[] = [];
  if (existingSettings?.setting_value) {
    try {
      claimedList = typeof existingSettings.setting_value === "string"
        ? JSON.parse(existingSettings.setting_value)
        : existingSettings.setting_value;
    } catch {}
  }
  return { achKey, claimedList: Array.isArray(claimedList) ? claimedList : [] };
}

async function addClaimedAchievementToSettings(userId: string, achievementId: string, username?: string) {
  const { achKey, claimedList } = await getClaimedAchievementsFromSettings(userId, username);
  if (claimedList.includes(achievementId)) return false;
  claimedList.push(achievementId);
  await supabase.from('settings').upsert({ setting_key: achKey, setting_value: JSON.stringify(claimedList) });
  return true;
}

// Global Check logic
export async function checkAndAwardAchievement(userId: string, achievementId: string) {
  const release = await achievementAwardMutex.acquire();
  try {
    const isSecretAchievement = achievementId === "ach_secret_easter_founder";
    try {
      await ensureAchievementTables();
    } catch (schemaError) {
      achievementTablesWritable = false;
    }
    // Settings claims predate the normalized table and remain authoritative.
    // Checking both stores prevents a migration from replaying older unlocks.
    const legacyClaim = await getClaimedAchievementsFromSettings(userId);
    if (legacyClaim.claimedList.includes(achievementId)) return;

    // Has user already claimed it?
    if (achievementTablesWritable && !isSecretAchievement) {
      const { data: existingClaim, error: existingError } = await supabase
        .from('user_achievements')
        .select('id')
        .eq('user_id', userId)
        .eq('achievement_id', achievementId)
        .single();

      if (existingClaim) return; // Already has it
      if (existingError && isAchievementTableUnavailable(existingError)) achievementTablesWritable = false;
    }

    const achievementDef = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievementDef) return;

    if (!achievementTablesWritable || isSecretAchievement) {
      const inserted = await addClaimedAchievementToSettings(userId, achievementId);
      if (!inserted) return;
    } else {
      const { error: insertError } = await supabase
        .from('user_achievements')
        .insert({ id: `ua-${uuidv4()}`, user_id: userId, achievement_id: achievementId });

      if (insertError) {
        if (insertError.code === "23505") return; // Unique violation, already claims
        if (!isAchievementTableUnavailable(insertError)) throw insertError;
        achievementTablesWritable = false;
        const inserted = await addClaimedAchievementToSettings(userId, achievementId);
        if (!inserted) return;
      }
    }

    // Award XP
    await internalAwardXP(userId, achievementDef.reward_xp, `achievement:${achievementId}`);
    
    // Add a notification so they see they got it!
    await createUserNotification(
      userId,
      "achievement",
      "دستاورد باز شد: " + achievementDef.title,
      `دستاورد «${achievementDef.title}» را باز کردید و ${achievementDef.reward_xp} XP دریافت کردید!`,
      "/?notifications=open"
    );

    console.log(`[ACHIEVEMENT] User ${userId} unlocked ${achievementId}`);
  } catch (err) {
    console.error(`Error checking achievement ${achievementId} for ${userId}:`, err);
  } finally {
    release();
  }
}

// Track counters for stateful achievements like "Read 100 chapters", "Read 20 midnight"
export async function incrementUserCounter(userId: string, counterKey: string, increment: number = 1): Promise<number> {
  const achKey = `counter_${userId}_${counterKey}`;
  const { data: existingSettings } = await supabase.from('settings').select('setting_value').eq('setting_key', achKey).single();
  let val = 0;
  if (existingSettings && existingSettings.setting_value) {
    val = parseInt(existingSettings.setting_value, 10);
  }
  val += increment;
  await supabase.from('settings').upsert({ setting_key: achKey, setting_value: val.toString() });
  return val;
}

async function getSettingJson(key: string) {
  const { data } = await supabase.from("settings").select("setting_value").eq("setting_key", key).single();
  if (!data?.setting_value) return {};
  try {
    return typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
  } catch {
    return {};
  }
}

async function getCounterValue(userId: string, counterKey: string) {
  const { data } = await supabase
    .from("settings")
    .select("setting_value")
    .eq("setting_key", `counter_${userId}_${counterKey}`)
    .single();
  return Number(data?.setting_value || 0);
}

export async function evaluateAndAwardUserAchievements(user: any) {
  if (!user?.id) return;
  try {
    await ensureAchievementTables();
  } catch (schemaError) {
    achievementTablesWritable = false;
  }

  const stats: any = await getSettingJson(userStatsKey(user.id));
  const completedChapterIds = new Set<string>();
  const { data: readingSessions } = await supabase
    .from("reading_sessions")
    .select("chapter_id, scroll_percentage")
    .eq("user_id", user.id);
  (readingSessions || []).forEach((session: any) => {
    if (session.chapter_id && Number(session.scroll_percentage || 0) >= 90) completedChapterIds.add(session.chapter_id);
  });
  const chaptersLogged = Math.max(
    Number(stats.chapters_logged || 0),
    completedChapterIds.size,
    await getCounterValue(user.id, "read_chapters")
  );

  if (chaptersLogged >= 1) await checkAndAwardAchievement(user.id, "ach_reader_first");
  if (chaptersLogged >= 100) await checkAndAwardAchievement(user.id, "ach_reader_100");
  if (chaptersLogged >= 1000) await checkAndAwardAchievement(user.id, "ach_reader_1000");
  if (Number(user.streak || 0) >= 7) await checkAndAwardAchievement(user.id, "ach_reader_7days");
  if (await getCounterValue(user.id, "midnight_reads") >= 20) await checkAndAwardAchievement(user.id, "ach_reader_midnight");

  const { count: bookmarkCount } = await supabase.from("bookmarks").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((bookmarkCount || 0) >= 50) await checkAndAwardAchievement(user.id, "ach_reader_collector");

  const { count: reviewCount } = await supabase.from("reviews").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((reviewCount || 0) >= 25) await checkAndAwardAchievement(user.id, "ach_reader_critic");

  const { count: supportCount } = await supabase.from("star_transactions").select("id", { count: "exact", head: true }).eq("from_user_id", user.id);
  if ((supportCount || 0) >= 1) await checkAndAwardAchievement(user.id, "ach_reader_supporter");

  const { data: novels } = await supabase.from("novels").select("id, views_count, rating, reviews_count").eq("author_id", user.id);
  const novelIds = (novels || []).map((novel: any) => novel.id);
  if (novelIds.length > 0) {
    const { count: publishedChapterCount } = await supabase
      .from("chapters")
      .select("id", { count: "exact", head: true })
      .in("novel_id", novelIds)
      .eq("status", "Published");
    if ((publishedChapterCount || 0) >= 1) await checkAndAwardAchievement(user.id, "ach_author_first");
    if ((publishedChapterCount || 0) >= 100) await checkAndAwardAchievement(user.id, "ach_author_100chapters");
  }

  const { count: followerCount } = await supabase
    .from("follows")
    .select("id", { count: "exact", head: true })
    .eq("target_type", "user")
    .eq("target_id", user.id);
  if ((followerCount || 0) >= 100) await checkAndAwardAchievement(user.id, "ach_author_100followers");

  const totalViews = (novels || []).reduce((sum: number, novel: any) => sum + Number(novel.views_count || 0), 0);
  if (totalViews >= 10_000) await checkAndAwardAchievement(user.id, "ach_author_10kviews");
  if (totalViews >= 1_000_000) await checkAndAwardAchievement(user.id, "ach_author_1mviews");

  const authorReviewCount = (novels || []).reduce((sum: number, novel: any) => sum + Number(novel.reviews_count || 0), 0);
  const averageRating = (novels || []).reduce((sum: number, novel: any) => sum + Number(novel.rating || 0), 0) / Math.max((novels || []).length, 1);
  if (authorReviewCount >= 10 && averageRating >= 4.5) await checkAndAwardAchievement(user.id, "ach_author_favorite");

  if (user.verified_author === true || user.verified_author === 1) await checkAndAwardAchievement(user.id, "ach_comm_verified");
  if (new Date(user.created_at || 0).getTime() <= Date.UTC(2026, 7, 5)) await checkAndAwardAchievement(user.id, "ach_comm_early");
}

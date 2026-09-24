import express from "express";
import { Mutex } from 'async-mutex';
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../../postgres";
import { getActiveUser } from "../../utils/auth";
import { internalAwardXP } from "./forums";
import { ACHIEVEMENTS, evaluateAndAwardUserAchievements } from "../../utils/achievements";
import { isSchemaPermissionError } from "../../utils/dbSchema";
import { userAchievementSettingsKey, userStatsKey } from "../../utils/usernames";

const router = express.Router();
const claimMutex = new Mutex();

async function getUserStats(user: any) {
  const { data } = await supabase
    .from("settings")
    .select("setting_value")
    .eq("setting_key", userStatsKey(user.id))
    .single();
  if (!data?.setting_value) return {};
  try {
    return typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
  } catch {
    return {};
  }
}

async function getCounter(userId: string, key: string) {
  const { data } = await supabase
    .from("settings")
    .select("setting_value")
    .eq("setting_key", `counter_${userId}_${key}`)
    .single();
  return Number(data?.setting_value || 0);
}

function isAchievementClaimsUnavailable(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return isSchemaPermissionError(error) || ["42P01", "42703"].includes(code) || message.includes("user_achievements");
}

async function getSettingsClaimList(user: any) {
  const achKey = userAchievementSettingsKey(user.id);
  const { data: existingSettings } = await supabase.from('settings').select('setting_value').eq('setting_key', achKey).single();
  if (!existingSettings?.setting_value) return { achKey, list: [] as string[] };
  try {
    const list = typeof existingSettings.setting_value === "string"
      ? JSON.parse(existingSettings.setting_value)
      : existingSettings.setting_value;
    return { achKey, list: Array.isArray(list) ? list : [] };
  } catch {
    return { achKey, list: [] as string[] };
  }
}

async function canClaimAchievement(user: any, achievementId: string): Promise<boolean> {
  const stats: any = await getUserStats(user);
  const chaptersLogged = Math.max(Number(stats.chapters_logged || 0), await getCounter(user.id, "read_chapters"));

  if (achievementId === "ach_reader_first") return chaptersLogged >= 1;
  if (achievementId === "ach_reader_100") return chaptersLogged >= 100;
  if (achievementId === "ach_reader_1000") return chaptersLogged >= 1000;
  if (achievementId === "ach_reader_7days") return Number(user.streak || 0) >= 7;
  if (achievementId === "ach_reader_midnight") return await getCounter(user.id, "midnight_reads") >= 20;

  if (achievementId === "ach_reader_collector") {
    const { count } = await supabase.from("bookmarks").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    return (count || 0) >= 50;
  }

  if (achievementId === "ach_reader_critic") {
    const { count } = await supabase.from("reviews").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    return (count || 0) >= 25;
  }

  if (achievementId === "ach_reader_supporter") {
    const { count } = await supabase.from("star_transactions").select("id", { count: "exact", head: true }).eq("from_user_id", user.id);
    return (count || 0) >= 1;
  }

  if (achievementId === "ach_author_first") {
    const { data: novels } = await supabase.from("novels").select("id").eq("author_id", user.id);
    const novelIds = (novels || []).map((n: any) => n.id);
    if (novelIds.length === 0) return false;
    const { count } = await supabase.from("chapters").select("id", { count: "exact", head: true }).in("novel_id", novelIds).eq("status", "Published");
    return (count || 0) >= 1;
  }

  if (achievementId === "ach_author_100followers") {
    const { count } = await supabase.from("follows").select("id", { count: "exact", head: true }).eq("target_type", "user").eq("target_id", user.id);
    return (count || 0) >= 100;
  }

  if (achievementId === "ach_author_10kviews" || achievementId === "ach_author_1mviews") {
    const { data: novels } = await supabase.from("novels").select("views_count").eq("author_id", user.id);
    const totalViews = (novels || []).reduce((sum: number, novel: any) => sum + Number(novel.views_count || 0), 0);
    return totalViews >= (achievementId === "ach_author_1mviews" ? 1_000_000 : 10_000);
  }

  if (achievementId === "ach_author_100chapters") {
    const { data: novels } = await supabase.from("novels").select("id").eq("author_id", user.id);
    const novelIds = (novels || []).map((n: any) => n.id);
    if (novelIds.length === 0) return false;
    const { count } = await supabase.from("chapters").select("id", { count: "exact", head: true }).in("novel_id", novelIds).eq("status", "Published");
    return (count || 0) >= 100;
  }

  if (achievementId === "ach_author_favorite") {
    const { data: novels } = await supabase.from("novels").select("rating, reviews_count").eq("author_id", user.id);
    const reviewCount = (novels || []).reduce((sum: number, novel: any) => sum + Number(novel.reviews_count || 0), 0);
    const avgRating = (novels || []).reduce((sum: number, novel: any) => sum + Number(novel.rating || 0), 0) / Math.max((novels || []).length, 1);
    return reviewCount >= 10 && avgRating >= 4.5;
  }

  if (achievementId === "ach_comm_verified") return user.verified_author === true || user.verified_author === 1;
  if (achievementId === "ach_comm_early") return new Date(user.created_at || 0).getTime() <= Date.UTC(2026, 7, 5);

  return false;
}

router.get("/", async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (user) {
      await evaluateAndAwardUserAchievements(user).catch(() => {});
    }
    
    // Fetch all achievements
    let items = [];
    const { data: dbItems, error } = await supabase.from('achievements').select('id, title, description, reward_xp, icon, category');
    if (error || !dbItems || dbItems.length === 0) {
      items = ACHIEVEMENTS; // Fallback
    } else {
      items = dbItems;
    }
    
    // Fetch all claims to count
    const { data: claims, error: claimsError } = await supabase.from('user_achievements').select('achievement_id, user_id');
    
    const countMap: Record<string, number> = {};
    const userClaimedItems = new Set<string>();
    
    if (claims && !claimsError) {
      claims.forEach(c => {
        countMap[c.achievement_id] = (countMap[c.achievement_id] || 0) + 1;
        if (user && c.user_id === user.id) {
          userClaimedItems.add(c.achievement_id);
        }
      });
    } else if (claimsError && !isAchievementClaimsUnavailable(claimsError)) {
      console.warn("Achievement claims table read failed:", claimsError.message || claimsError);
    }

    // fallback: if user falls back to settings table, we also need to sum from settings
    // Since we don't have a way to count ALL settings easily without admin, we only check for the current user's claims
    if (user) {
      const { list } = await getSettingsClaimList(user);
      list.forEach(id => {
        if (!userClaimedItems.has(id)) {
          userClaimedItems.add(id);
          countMap[id] = (countMap[id] || 0) + 1;
        }
      });
    }

    // Also try to collect other users' claimed achievements from settings table (hacky but works since it's just settings table)
    try {
        const { data: allSettings } = await supabase.from('settings').select('setting_value').ilike('setting_key', 'claimed_achievements_%');
        if (allSettings) {
            allSettings.forEach(s => {
                if (s.setting_value) {
                    try {
                        const list: string[] = JSON.parse(s.setting_value);
                        list.forEach(id => {
                            // Only add if not already using the real table for this user
                            // This is a rough estimation but useful if real table is not enabled
                            countMap[id] = (countMap[id] || 0) + 1;
                        });
                    } catch(e) {}
                }
            });
        }
    } catch(e) {}

    const enhancedItems = items?.filter((item: any) => !item.hidden && item.id !== "ach_secret_easter_founder").map(item => ({
      ...item,
      claimedCount: countMap[item.id] || 0,
      claimedByUser: userClaimedItems.has(item.id)
    })) || [];
    
    res.json(enhancedItems);
  } catch (err) {
    console.error("Failed to fetch achievements", err);
    res.status(400).json({ error: "دریافت دستاوردها ناموفق بود" });
  }
});

router.post("/claim", async (req, res): Promise<any> => {
  try {
    const user = await getActiveUser(req, true);
    if (!user) return res.status(401).json({ error: "دسترسی غیرمجاز" });

    const { id } = req.body;
    
    // Check if the achievement exists
    const { data: achievement, error: achError } = await supabase
      .from("achievements")
      .select("id, reward_xp")
      .eq("id", id)
      .single();

    let reward = achievement?.reward_xp || 100;
    if (achError || !achievement) {
      if (id === 'a1') reward = 200;
      else if (id === 'a2') reward = 350;
      else if (id === 'a3') reward = 150;
      else if (id === 'a4') reward = 1000;
      else if (id === 'a5') reward = 500;
    }

    const eligible = await canClaimAchievement(user, id);
    if (!eligible) {
      return res.status(403).json({ error: "شرایط دریافت این دستاورد برآورده نشده است." });
    }

    const release = await claimMutex.acquire();
    
    try {
      const { data: existingClaim, error: existingClaimError } = await supabase
        .from('user_achievements')
        .select('id')
        .eq('user_id', user.id)
        .eq('achievement_id', id)
        .single();
      
      if (existingClaim) {
        return res.status(400).json({ error: "قبلاً دریافت شده است" });
      }

      const legacyClaim = await getSettingsClaimList(user);
      if (legacyClaim.list.includes(id)) {
        return res.status(400).json({ error: "قبلاً دریافت شده است" });
      }
      
      if (existingClaimError && isAchievementClaimsUnavailable(existingClaimError)) {
        const { achKey, list } = legacyClaim;
        if (list.includes(id)) return res.status(400).json({ error: "قبلاً دریافت شده است" });
        list.push(id);
        await supabase.from('settings').upsert({ setting_key: achKey, setting_value: JSON.stringify(list) });
      } else {
        const { error: insertError } = await supabase
          .from('user_achievements')
          .insert({ id: `ua-${uuidv4()}`, user_id: user.id, achievement_id: id });
      
        if (insertError) {
          if (insertError.code === "23505") return res.status(400).json({ error: "قبلاً دریافت شده است" });
          if (!isAchievementClaimsUnavailable(insertError)) throw insertError;
        
          const { achKey, list } = legacyClaim;
          if (list.includes(id)) return res.status(400).json({ error: "قبلاً دریافت شده است" });
          list.push(id);
          await supabase.from('settings').upsert({ setting_key: achKey, setting_value: JSON.stringify(list) });
        }
      }

      await internalAwardXP(user.id, reward, `achievement:${id}`);
      
      return res.json({ success: true, claimedAchievement: id });
    } finally {
      release();
    }

  } catch (err) {
    res.status(400).json({ error: "عملیات ناموفق بود" });
  }
});

export default router;

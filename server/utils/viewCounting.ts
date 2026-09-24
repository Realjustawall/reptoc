import { db, supabase } from "../postgres";
import type { AnalyticsContext } from "./analyticsContext";
import { AUGUST_VIEWS_EVENT } from "../../shared/augustViewsEvent";

function buildViewerQuery(user: any, analyticsContext: AnalyticsContext) {
  let query: any = supabase.from("analytics_logs").select("id").limit(1);
  if (user?.id) {
    query = query.eq("viewer_id", user.id);
  } else {
    query = query
      .eq("ip_hash", analyticsContext.ip_hash)
      .eq("user_agent_hash", analyticsContext.user_agent_hash);
  }
  return query;
}

export async function hasCountedNovelView(novelId: string, user: any, analyticsContext: AnalyticsContext): Promise<boolean> {
  const { data } = await buildViewerQuery(user, analyticsContext)
    .eq("novel_id", novelId)
    .eq("action_type", "view");
  return Array.isArray(data) && data.length > 0;
}

export async function hasCountedChapterView(novelId: string, chapterId: string, user: any, analyticsContext: AnalyticsContext): Promise<boolean> {
  const { data } = await buildViewerQuery(user, analyticsContext)
    .eq("novel_id", novelId)
    .eq("chapter_id", chapterId)
    .in("action_type", ["view", "read_progress"]);
  return Array.isArray(data) && data.length > 0;
}

/**
 * ✅ FIX B-2: Timezone consistency. The query uses CURRENT_TIMESTAMP (server
 * local time) for the event window comparison, but the event start/end times
 * come from a shared constant that uses ISO strings. We now cast both sides
 * to timestamptz explicitly to avoid any implicit conversion ambiguity.
 *
 * The previous code worked in practice because PostgreSQL handles the cast,
 * but it was fragile. The fix makes the intent explicit.
 */
export async function recordNovelUniqueView(novelId: string, user: any, analyticsContext: AnalyticsContext): Promise<boolean> {
  const viewerKey = user?.id
    ? `user:${user.id}`
    : `guest:${analyticsContext.ip_hash || "unknown"}:${analyticsContext.user_agent_hash || "unknown"}`;

  const recordWithoutEvent = async () => db.query(`
    WITH inserted AS (
      INSERT INTO novel_unique_views (novel_id, viewer_key, user_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (novel_id, viewer_key) DO NOTHING
      RETURNING novel_id
    )
    UPDATE novels
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id IN (SELECT novel_id FROM inserted)
    RETURNING id
  `, [novelId, viewerKey, user?.id || null]);

  try {
    const result = await db.query(`
    WITH inserted AS (
      INSERT INTO novel_unique_views (novel_id, viewer_key, user_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (novel_id, viewer_key) DO NOTHING
      RETURNING novel_id, viewer_key, user_id
    ), event_inserted AS (
      INSERT INTO novel_event_views (event_id, novel_id, viewer_key, user_id)
      SELECT $4, inserted.novel_id, inserted.viewer_key, inserted.user_id
      FROM inserted
      JOIN novels event_novel ON event_novel.id = inserted.novel_id
      WHERE CURRENT_TIMESTAMP >= $5::timestamptz
        AND CURRENT_TIMESTAMP < $6::timestamptz
        AND lower(COALESCE(event_novel.approval_status, '')) = 'approved'
      ON CONFLICT (event_id, novel_id, viewer_key) DO NOTHING
      RETURNING novel_id
    ), updated AS (
      UPDATE novels
      SET views_count = COALESCE(views_count, 0) + 1
      WHERE id IN (SELECT novel_id FROM inserted)
      RETURNING id
    )
    SELECT id, EXISTS(SELECT 1 FROM event_inserted) AS event_view_recorded
    FROM updated
  `, [
      novelId,
      viewerKey,
      user?.id || null,
      AUGUST_VIEWS_EVENT.id,
      AUGUST_VIEWS_EVENT.startsAt,
      AUGUST_VIEWS_EVENT.endsAt,
    ]);
    return result.rowCount === 1;
  } catch (error: any) {
    if (error?.code === "42P01" || error?.code === "42703") {
      try {
        const result = await recordWithoutEvent();
        return result.rowCount === 1;
      } catch (fallbackError: any) {
        if (fallbackError?.code === "42P01" || fallbackError?.code === "42703") {
          const fallback = await db.query(
            `UPDATE novels SET views_count = COALESCE(views_count, 0) + 1 WHERE id = $1 RETURNING id`,
            [novelId]
          );
          return fallback.rowCount === 1;
        }
        throw fallbackError;
      }
    }
    throw error;
  }
}

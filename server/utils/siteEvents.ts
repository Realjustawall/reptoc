import { db } from "../postgres";
import {
  DEFAULT_SITE_EVENT_BANNER,
  getSiteEventPhase,
  normalizeExcludedAuthorNames,
  normalizeSiteEventBannerTheme,
  normalizeSiteEventKind,
  normalizeSiteEventStatus,
  type SiteEvent,
} from "../../shared/siteEvents";

/**
 * Event rows.
 *
 * The public event page, the home-page banner and the admin panel all read
 * through here so a change to the row shape lands in one place. Every query
 * tolerates a pre-migration database (42P01/42703) by returning nothing, which
 * keeps the site up while migrations are still being applied.
 */

const EVENT_COLUMNS = `
  id, slug, title, description, kind, status, starts_at, ends_at,
  timezone_label, date_label, banner_url, banner_alt, banner_headline,
  banner_subheadline, banner_cta_label, banner_cta_href, banner_theme,
  is_featured, excluded_author_names, created_at, updated_at
`;

export function isMissingEventSchema(error: any): boolean {
  return ["42P01", "42703"].includes(String(error?.code || ""));
}

export function rowToSiteEvent(row: any, now: Date = new Date()): SiteEvent {
  const startsAt = new Date(row.starts_at).toISOString();
  const endsAt = new Date(row.ends_at).toISOString();
  const phase = getSiteEventPhase({ startsAt, endsAt }, now);
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title || ""),
    description: String(row.description || ""),
    kind: normalizeSiteEventKind(row.kind),
    status: normalizeSiteEventStatus(row.status),
    startsAt,
    endsAt,
    dateLabel: String(row.date_label || ""),
    timezoneLabel: String(row.timezone_label || "UTC"),
    banner: {
      ...DEFAULT_SITE_EVENT_BANNER,
      imageUrl: String(row.banner_url || ""),
      alt: String(row.banner_alt || ""),
      headline: String(row.banner_headline || ""),
      subheadline: String(row.banner_subheadline || ""),
      ctaLabel: String(row.banner_cta_label || ""),
      ctaHref: String(row.banner_cta_href || ""),
      theme: normalizeSiteEventBannerTheme(row.banner_theme),
    },
    isFeatured: row.is_featured === true,
    excludedAuthorNames: normalizeExcludedAuthorNames(row.excluded_author_names),
    phase,
    // Rankings stay hidden until the event opens, so an empty board is never
    // shown as if it were a result.
    leaderboardEnabled: phase !== "upcoming",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

export async function listSiteEvents(options: { publishedOnly?: boolean } = {}): Promise<SiteEvent[]> {
  try {
    const { rows } = await db.query(
      `SELECT ${EVENT_COLUMNS} FROM site_events
        ${options.publishedOnly ? `WHERE status = 'published'` : ""}
        ORDER BY is_featured DESC, starts_at DESC`,
    );
    const now = new Date();
    return rows.map((row: any) => rowToSiteEvent(row, now));
  } catch (error: any) {
    if (isMissingEventSchema(error)) return [];
    throw error;
  }
}

/** Look an event up by slug or id — public links use the slug. */
export async function findSiteEvent(identifier: string): Promise<SiteEvent | null> {
  try {
    const { rows } = await db.query(
      `SELECT ${EVENT_COLUMNS} FROM site_events WHERE slug = $1 OR id = $1 LIMIT 1`,
      [String(identifier || "")],
    );
    return rows[0] ? rowToSiteEvent(rows[0]) : null;
  } catch (error: any) {
    if (isMissingEventSchema(error)) return null;
    throw error;
  }
}

/** The event currently occupying the home-page banner slot, if any. */
export async function findFeaturedSiteEvent(): Promise<SiteEvent | null> {
  try {
    const { rows } = await db.query(
      `SELECT ${EVENT_COLUMNS} FROM site_events
        WHERE is_featured = true AND status = 'published'
        LIMIT 1`,
    );
    return rows[0] ? rowToSiteEvent(rows[0]) : null;
  } catch (error: any) {
    if (isMissingEventSchema(error)) return null;
    throw error;
  }
}

export interface PersistableSiteEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: string;
  status: string;
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  timezoneLabel: string;
  banner: {
    imageUrl: string;
    alt: string;
    headline: string;
    subheadline: string;
    ctaLabel: string;
    ctaHref: string;
    theme: string;
  };
  isFeatured: boolean;
  excludedAuthorNames: string[];
}

/**
 * Insert or update an event.
 *
 * Featuring is exclusive (a partial unique index enforces it), so the previous
 * feature is cleared inside the same transaction rather than in a second request
 * that could fail halfway and leave the home page with two banners or none.
 */
export async function saveSiteEvent(
  event: PersistableSiteEvent,
  ownerId: string,
): Promise<SiteEvent> {
  return db.withTransaction(async (client) => {
    if (event.isFeatured) {
      await client.query(
        `UPDATE site_events SET is_featured = false, updated_at = now() WHERE is_featured = true AND id <> $1`,
        [event.id],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO site_events (
         id, slug, title, description, kind, status, starts_at, ends_at,
         timezone_label, date_label, banner_url, banner_alt, banner_headline,
         banner_subheadline, banner_cta_label, banner_cta_href, banner_theme,
         is_featured, excluded_author_names, created_by, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,now(),now()
       )
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         kind = EXCLUDED.kind,
         status = EXCLUDED.status,
         starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at,
         timezone_label = EXCLUDED.timezone_label,
         date_label = EXCLUDED.date_label,
         banner_url = EXCLUDED.banner_url,
         banner_alt = EXCLUDED.banner_alt,
         banner_headline = EXCLUDED.banner_headline,
         banner_subheadline = EXCLUDED.banner_subheadline,
         banner_cta_label = EXCLUDED.banner_cta_label,
         banner_cta_href = EXCLUDED.banner_cta_href,
         banner_theme = EXCLUDED.banner_theme,
         is_featured = EXCLUDED.is_featured,
         excluded_author_names = EXCLUDED.excluded_author_names,
         updated_at = now()
       RETURNING ${EVENT_COLUMNS}`,
      [
        event.id, event.slug, event.title, event.description, event.kind, event.status,
        event.startsAt, event.endsAt, event.timezoneLabel, event.dateLabel,
        event.banner.imageUrl, event.banner.alt, event.banner.headline,
        event.banner.subheadline, event.banner.ctaLabel, event.banner.ctaHref,
        event.banner.theme, event.isFeatured,
        JSON.stringify(event.excludedAuthorNames), ownerId,
      ],
    );
    return rowToSiteEvent(rows[0]);
  });
}

/**
 * Delete an event.
 *
 * Recorded views are deleted with it: they are meaningless without the event
 * that scoped them, and leaving them would silently inflate a future event that
 * reused the same id.
 */
export async function deleteSiteEvent(eventId: string): Promise<{ removedViews: number }> {
  return db.withTransaction(async (client) => {
    const views = await client.query(`DELETE FROM novel_event_views WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM novel_event_excluded_authors WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM site_events WHERE id = $1`, [eventId]);
    return { removedViews: views.rowCount || 0 };
  });
}

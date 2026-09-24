import { v4 as uuidv4 } from "uuid";
import type { PoolClient } from "pg";
import { db } from "../postgres";
import {
  alignParagraphIdentities,
  extractParagraphBlocks,
  type ParagraphIdentity,
} from "../../shared/paragraphs";

export interface PublicParagraphIdentity {
  id: string;
  ordinal: number;
}

function rowIdentity(row: any): ParagraphIdentity {
  return {
    id: String(row.id),
    ordinal: Number(row.ordinal),
    fingerprint: String(row.fingerprint || ""),
    deleted: !!row.deleted_at,
  };
}

async function syncWithClient(
  client: PoolClient,
  chapterId: string,
  content: unknown,
): Promise<PublicParagraphIdentity[]> {
  const existing = await client.query(
    `SELECT id, ordinal, fingerprint, deleted_at
       FROM chapter_paragraphs
      WHERE chapter_id=$1
      ORDER BY ordinal, created_at
      FOR UPDATE`,
    [chapterId],
  );
  const blocks = extractParagraphBlocks(content);
  const aligned = alignParagraphIdentities(
    existing.rows.map(rowIdentity),
    blocks,
    () => `para-${uuidv4()}`,
  );
  const now = new Date().toISOString();

  for (const paragraph of aligned.active) {
    await client.query(
      `INSERT INTO chapter_paragraphs(id,chapter_id,ordinal,fingerprint,deleted_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,NULL,$5,$5)
       ON CONFLICT(id) DO UPDATE
         SET ordinal=EXCLUDED.ordinal,
             fingerprint=EXCLUDED.fingerprint,
             deleted_at=NULL,
             updated_at=EXCLUDED.updated_at`,
      [paragraph.id, chapterId, paragraph.ordinal, paragraph.fingerprint, now],
    );
  }
  const removedIds = aligned.removed.map((paragraph) => paragraph.id);
  if (removedIds.length) {
    await client.query(
      `UPDATE chapter_paragraphs
          SET deleted_at=COALESCE(deleted_at,$2), updated_at=$2
        WHERE chapter_id=$1 AND id=ANY($3::text[])`,
      [chapterId, now, removedIds],
    );
  }
  return aligned.active.map(({ id, ordinal }) => ({ id, ordinal }));
}

export async function syncChapterParagraphs(
  chapterId: string,
  content: unknown,
): Promise<PublicParagraphIdentity[]> {
  return db.withTransaction((client) => syncWithClient(client, chapterId, content));
}

export async function loadChapterParagraphs(
  chapterId: string,
  content: unknown,
): Promise<PublicParagraphIdentity[]> {
  const blocks = extractParagraphBlocks(content);
  const current = await db.query(
    `SELECT id, ordinal, fingerprint
       FROM chapter_paragraphs
      WHERE chapter_id=$1 AND deleted_at IS NULL
      ORDER BY ordinal`,
    [chapterId],
  );
  const matches = current.rows.length === blocks.length
    && current.rows.every((row: any, index: number) =>
      Number(row.ordinal) === index && String(row.fingerprint || "") === blocks[index]?.fingerprint
    );
  if (matches) return current.rows.map((row: any) => ({ id: String(row.id), ordinal: Number(row.ordinal) }));
  return syncChapterParagraphs(chapterId, content);
}

export async function loadParagraphsForChapters(
  chapters: Array<{ id: string; content?: unknown }>,
): Promise<Map<string, PublicParagraphIdentity[]>> {
  const result = new Map<string, PublicParagraphIdentity[]>();
  if (!chapters.length) return result;
  const current = await db.query(
    `SELECT id,chapter_id,ordinal,fingerprint
       FROM chapter_paragraphs
      WHERE chapter_id=ANY($1::text[]) AND deleted_at IS NULL
      ORDER BY chapter_id,ordinal`,
    [chapters.map((chapter) => chapter.id)],
  );
  const rowsByChapter = new Map<string, any[]>();
  for (const row of current.rows) {
    const rows = rowsByChapter.get(String(row.chapter_id)) || [];
    rows.push(row);
    rowsByChapter.set(String(row.chapter_id), rows);
  }
  for (const chapter of chapters) {
    const blocks = extractParagraphBlocks(chapter.content);
    const rows = rowsByChapter.get(chapter.id) || [];
    const matches = rows.length === blocks.length
      && rows.every((row: any, index: number) =>
        Number(row.ordinal) === index && String(row.fingerprint || "") === blocks[index]?.fingerprint
      );
    result.set(
      chapter.id,
      matches
        ? rows.map((row: any) => ({ id: String(row.id), ordinal: Number(row.ordinal) }))
        : await syncChapterParagraphs(chapter.id, chapter.content),
    );
  }
  return result;
}

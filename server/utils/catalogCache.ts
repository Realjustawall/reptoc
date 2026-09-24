import { cache } from "./cache";

const CATALOG_PREFIX = "catalog:v5:";
const NOVEL_PREFIX = "novel:v4:";

export function catalogCacheKey(user: any, variant = "full"): string {
  const role = String(user?.role || "public").toLowerCase().trim();
  return `${CATALOG_PREFIX}${variant}:${user?.id || "public"}:${role}`;
}

export function novelCacheKey(novelId: string, user: any): string {
  const role = String(user?.role || "public").toLowerCase().trim();
  return `${NOVEL_PREFIX}${novelId}:${user?.id || "public"}:${role}`;
}

export async function invalidateNovelCaches(novelId?: string): Promise<void> {
  await Promise.all([
    cache.clearPrefix(CATALOG_PREFIX),
    novelId ? cache.clearPrefix(`${NOVEL_PREFIX}${novelId}:`) : cache.clearPrefix(NOVEL_PREFIX),
    cache.clearPrefix("recommend:")
  ]);
}

export { cache as sharedCache };

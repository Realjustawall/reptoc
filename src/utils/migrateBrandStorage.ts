const LEGACY_PREFIX = "novellek-";
const CURRENT_PREFIX = "reptoc-";

function migrateStore(store: Storage) {
  const legacyKeys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }
  for (const legacyKey of legacyKeys) {
    const nextKey = `${CURRENT_PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`;
    try {
      if (store.getItem(nextKey) === null) {
        const value = store.getItem(legacyKey);
        if (value !== null) store.setItem(nextKey, value);
      }
      store.removeItem(legacyKey);
    } catch {
      // storage full or blocked; keep legacy entry untouched
    }
  }
}

export function migrateBrandStorage() {
  try {
    migrateStore(window.localStorage);
  } catch {
    // localStorage unavailable (privacy mode); nothing to migrate
  }
  try {
    migrateStore(window.sessionStorage);
  } catch {
    // sessionStorage unavailable; nothing to migrate
  }
}

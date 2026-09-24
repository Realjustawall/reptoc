# Username identity and change deployment

Accounts are permanently identified by `users.id`. A username is a mutable,
case-insensitive public identifier. Novel ownership remains `novels.author_id`;
`novels.author` remains the author's public pen-name snapshot.

## Audited identity dependencies

- Direct ID relationships: sessions, novels, chapters, chapter/post comments,
  reviews, bookmarks, likes, follows, author posts, achievements, reports,
  support, premium, analytics, worldbuilding, editorial assignments, and
  account settings.
- Legacy relationship columns migrated additively: message sender/recipient,
  blocks, reading progress, social rows, forum rows, notification recipients,
  review owners, and bookmark owners.
- Denormalized display snapshots synchronized transactionally: reviews,
  bookmarks, notifications, messages, reading progress, blocks, forums, and
  social rows.
- Username-keyed settings copied without deletion to `*_user_<user_id>` keys:
  stats, preferences, claimed achievements, and chapter notes. Profile bios are
  stored on `users.profile_bio`.
- Public dependencies: `/authors/:username`, legacy `/author/:username`,
  author posts/links/bookmarks, direct messages, search, sitemap entries, SEO
  canonical URLs, notifications, and WebSocket delivery.
- Cache dependencies: catalog, individual novels, recommendations, candidate
  lists, and full-profile entries. They are invalidated after commit.

Unmappable system/deleted-account historical messages, notifications, and forum
snapshots are retained. They are never attached by guesswork and are never
deleted by migration 037.

## Deployment order

1. Back up PostgreSQL and test migration 037 against a recent production copy.
2. As the PostgreSQL table owner, apply
   `migrations/037_username_identity_and_history.sql`.
3. Deploy server and client together. Old application instances remain
   compatible because legacy columns are retained and synchronized.
4. Restart workers so WebSocket rooms use `user_id_<id>`.
5. Apply `migrations/038_remove_username_relationship_constraints.sql` to
   remove obsolete bookmark/block uniqueness keyed by username. Snapshot
   columns remain available for compatibility and exports.
6. Run:

   ```bash
   npm run test:username-migration
   npm run test:username
   TEST_BASE_URL=http://127.0.0.1:5174 npm run test:username-api
   npm run lint
   npm run build
   ```

7. Verify an old `/authors/<old-name>` link returns HTTP 308 to the current
   profile, a current session remains valid, and new-username login succeeds.

`username_history` permanently reserves former and deleted-account usernames.
The database trigger and case-insensitive unique index serialize registration
and rename claims. The application transaction updates the account,
username-history entry, ID-keyed settings, and compatibility snapshots as one
atomic operation; any failure rolls everything back.

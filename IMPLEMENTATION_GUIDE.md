# Implementation Guide

## Database

The backend uses PostgreSQL through `server/postgres.ts`. Configure `.env` with either:

- `DATABASE_URL`
- or `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`

Run these schemas against the PostgreSQL database:

```sql
\i postgres_schema.sql
\i postgres_suggestion_schema.sql
```

## Runtime

Set `HOST` and `PORT` in `.env`. The current local default is:

```env
HOST=127.0.0.1
PORT=5174
```

## Upload Scanning

For real malware scanning, run ClamAV `clamd` and set:

```env
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
```

If ClamAV is not configured, uploads still pass through MIME validation, magic-byte checks, dangerous extension blocking, active-content heuristics, image dimension validation, and metadata stripping.

## Verification

```bash
npm run lint
npm run build
npm start
```

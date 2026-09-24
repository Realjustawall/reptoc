# Reptoc Webnovel Platform

Reptoc is a full-stack Persian/RTL webnovel and manga platform built with
React, Express, Socket.IO, and PostgreSQL. It includes reading and writing
workspaces, moderation, forums, recommendations, analytics, premium features,
worldbuilding tools, events, manga pages, media uploads, and administration.

## One-command server installation

Supported systems:

- Ubuntu 22.04, 24.04, or newer
- Debian 12 or newer
- A fresh server with root or `sudo` access
- At least 2 GB RAM; 4 GB is recommended during the build
- A domain pointed to the server for automatic HTTPS, or the public server IP
  for an HTTP-only installation

Clone the repository and run the installer:

```bash
git clone https://github.com/Realjustawall/reptoc.git
cd reptoc
sudo ./install.sh
```

The interactive installer asks for the public domain/IP and owner account. It
then installs Node.js and PostgreSQL, creates a database, applies all migrations,
generates secrets, builds the application, installs a systemd service, configures
Nginx, optionally obtains a Let's Encrypt certificate, and checks the live
health endpoint.

For an unattended HTTPS installation:

```bash
sudo ./install.sh --non-interactive \
  --domain novels.example.com \
  --admin-user admin \
  --admin-email owner@example.com \
  --ssl \
  --certbot-email owner@example.com
```

When `--admin-password` is omitted, the installer generates a strong password
and prints it once. Avoid placing passwords directly in shell history.

To use an existing PostgreSQL service:

```bash
sudo DATABASE_URL='postgresql://user:password@db.example.com/reptoc?sslmode=require' \
  ./install.sh --non-interactive --domain novels.example.com
```

The default application directory is `/opt/reptoc`. This is a fresh-server
installer and will refuse to overwrite an existing `/opt/reptoc/.env`.

See [INSTALL.md](INSTALL.md) for configuration, operations, optional services,
and backup guidance.

## Development

```bash
cp .env.example .env
npm ci
npm run dev
```

A PostgreSQL database is required. Initialize it with:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres_suggestion_schema.sql
npm run db:migrate
```

Verification commands:

```bash
npm run lint
ENCRYPTION_KEY="$(openssl rand -hex 32)" npm run test:worldbuilding
npm run build
```

GitHub Actions runs these checks against a clean PostgreSQL database and also
performs an end-to-end installation on a fresh Ubuntu runner.

## Security and private data

This repository intentionally contains no production `.env`, credentials,
database dump, user upload, runtime log, or server backup. Never commit those
files. Back up both PostgreSQL and `/opt/reptoc/uploads` separately.

## License and permission

This project is source-available, not open source. Legal fair-use rights are
preserved, but deploying, distributing, selling, or using this code to create
or operate a webnovel/manga platform requires prior written permission from the
copyright holder. See [LICENSE](LICENSE) for the complete terms.

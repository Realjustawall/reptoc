# Reptoc server installation

This package contains the Reptoc source code and public assets, but no live
`.env`, database dump, uploaded user files, logs, build output, or installed
dependencies.

## Supported server

- A fresh Debian 12 or Ubuntu 22.04/24.04 server
- Root or `sudo` access
- At least 2 GB RAM (4 GB is recommended while building)
- A domain pointed at the server if HTTPS is wanted

The installer sets up Node.js 20+, PostgreSQL, the database schema and all
migrations, a protected environment file, the production build, a systemd
service, Nginx, and optionally a Let's Encrypt certificate.

This is deliberately a fresh-server installer. It refuses to overwrite an
existing `/opt/reptoc/.env`, preventing accidental rotation of encryption and
database secrets during an upgrade.

## Interactive installation

Copy/extract this directory on the new server, then run:

```bash
cd Reptoc-WebnovelPlatform
sudo ./installer.sh
```

The site is installed in `/opt/reptoc`. Enter either a domain pointed at the
server or the server's public IP. IP-based installs use HTTP; domain installs
can enable HTTPS during setup.

## One-command, non-interactive installation

```bash
sudo ./installer.sh --non-interactive \
  --domain novels.example.com \
  --admin-user admin \
  --admin-email owner@example.com \
  --ssl --certbot-email owner@example.com
```

If `--admin-password` is omitted, a strong password is generated and printed
once at the end. Supplying secrets on a shell command line can expose them in
shell history; using the interactive prompt or an environment variable is
safer.

To use a managed/existing PostgreSQL database:

```bash
sudo DATABASE_URL='postgresql://user:password@db.example.com/reptoc?sslmode=require' \
  ./installer.sh --non-interactive --domain novels.example.com
```

See every option with `./installer.sh --help`.

## After installation

```bash
systemctl status reptoc
journalctl -u reptoc -f
curl http://127.0.0.1:3000/api/health
```

Optional integrations (email, Google login, Gemini, Discord, S3/R2, Redis,
web push, and payments) are configured in `/opt/reptoc/.env`. Restart after a
change:

```bash
sudo systemctl restart reptoc
```

Back up both PostgreSQL and `/opt/reptoc/uploads`. Database content and uploads
are intentionally not part of this source distribution.

# Package contents

Included: application source, database bootstrap schemas, ordered migrations,
public assets, tests, lockfiles, project documentation, and the production
installer.

Intentionally excluded:

- `.env` and `.new-secrets.env`
- database dumps and `storage/backups/*`
- uploaded user media in `uploads/*`
- audit/runtime logs
- `node_modules`, `build`, and `dist`
- old security-patch backups and server-specific installer artifacts

Empty `uploads`, `logs/admin_audit`, and `storage/backups` directories are
created by the installer with permissions for the service account.

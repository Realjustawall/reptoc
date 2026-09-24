import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const LOG_DIR = path.resolve(process.cwd(), 'logs', 'admin_audit');

function ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}
}

function sanitizeDetails(details: any) {
  // remove obvious sensitive fields
  if (!details) return {};
  const copy = typeof details === 'string' ? { message: details } : JSON.parse(JSON.stringify(details));
  const sensitive = ['password', 'pass', 'token', 'auth', 'email', 'ssn', 'card', 'creditcard'];
  function scrub(obj: any) {
    if (!obj || typeof obj !== 'object') return obj;
    for (const k of Object.keys(obj)) {
      if (sensitive.includes(k.toLowerCase())) obj[k] = '[REDACTED]';
      else if (typeof obj[k] === 'object') scrub(obj[k]);
      else if (typeof obj[k] === 'string') {
        // redact emails
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj[k])) obj[k] = '[REDACTED]';
      }
    }
    return obj;
  }
  return scrub(copy);
}

export async function logAdminActionFile(actorId: string | null, targetUserId: string | null, action: string, details: any = {}) {
  try {
    ensureDir();
    const date = new Date().toISOString().slice(0,10);
    const fname = path.join(LOG_DIR, `${date}.jsonl`);
    const entry = {
      id: `f_audit_${Date.now()}_${uuidv4().substring(0,6)}`,
      actor_id: actorId || null,
      target_user_id: targetUserId || null,
      action,
      details: sanitizeDetails(details),
      created_at: new Date().toISOString()
    };
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(fname, line, { encoding: 'utf8' });
  } catch (e) {
    console.warn('Failed to write file audit log', e);
  }
}

export async function listAuditFiles() {
  try {
    ensureDir();
    const files = await fs.promises.readdir(LOG_DIR);
    const out: any[] = [];
    for (const f of files) {
      if (!/^[0-9\-]+\.jsonl$/.test(f)) continue;
      const stat = await fs.promises.stat(path.join(LOG_DIR, f));
      out.push({ name: f, size: stat.size, mtime: stat.mtime.toISOString() });
    }
    out.sort((a,b) => b.mtime.localeCompare(a.mtime));
    return out;
  } catch (e) { return []; }
}

export async function readAuditFile(name: string, maxBytes = 1024*1024) {
  try {
    if (!/^[0-9\-]+\.jsonl$/.test(name)) throw new Error('Invalid filename');
    const p = path.join(LOG_DIR, name);
    const stat = await fs.promises.stat(p);
    const size = Math.min(stat.size, maxBytes);
    const fd = await fs.promises.open(p, 'r');
    const buf = Buffer.alloc(size);
    await fd.read(buf, 0, size, Math.max(0, stat.size - size));
    await fd.close();
    return buf.toString('utf8');
  } catch (e) {
    return null;
  }
}

export async function deleteAuditFile(name: string) {
  try {
    if (!/^[0-9\-]+\.jsonl$/.test(name)) throw new Error('Invalid filename');
    const p = path.join(LOG_DIR, name);
    await fs.promises.unlink(p);
    return true;
  } catch (e) {
    return false;
  }
}

export default { logAdminActionFile, listAuditFiles, readAuditFile, deleteAuditFile };

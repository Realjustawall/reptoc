import { supabase } from "../postgres";
import { v4 as uuidv4 } from "uuid";
import { logAdminActionFile } from "./fileAudit";

export async function logAdminAction(actorId: string | null, targetUserId: string | null, action: string, details: any = {}) {
  // write to PostgreSQL table (best-effort)
  try {
    await supabase.from('admin_audit').insert({
      id: `audit_${Date.now()}_${uuidv4().substring(0,6)}`,
      actor_id: actorId,
      target_user_id: targetUserId,
      action,
      details: typeof details === 'string' ? details : JSON.stringify(details),
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('Failed to write admin audit to database:', e);
  }

  // also write to local file logs (sanitized)
  try {
    await logAdminActionFile(actorId, targetUserId, action, details);
  } catch (e) {
    console.warn('Failed to write admin audit to file:', e);
  }
}

export default { logAdminAction };

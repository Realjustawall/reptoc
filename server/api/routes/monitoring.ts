import express from 'express';
import { getActiveUser, isOwnerUser } from '../../utils/auth';
import { supabase } from '../../postgres';

const router = express.Router();

// Lightweight monitoring endpoints for admin dashboard
router.get('/metrics', async (req, res) => {
  try {
    const user = await getActiveUser(req, false);
    if (!isOwnerUser(user)) return res.status(403).json({ error: 'دسترسی غیرمجاز' });

    // Basic metrics: users count, active sessions, novels count, pending approvals
    const usersRes = await supabase.from('users').select('id', { count: 'exact' });
    const sessionsRes = await supabase.from('sessions').select('id', { count: 'exact' });
    const novelsRes = await supabase.from('novels').select('id', { count: 'exact' });
    const pendingRes = await supabase.from('novels').select('id', { count: 'exact' }).eq('approval_status', 'pending_approval');
    const usersCount = (usersRes as any).count || 0;
    const sessionsCount = (sessionsRes as any).count || 0;
    const novelsCount = (novelsRes as any).count || 0;
    const pendingCount = (pendingRes as any).count || 0;

    // simple recent activity: last 24h new users
    const since = new Date(Date.now() - 24*60*60*1000).toISOString();
    const { data: newUsers } = await supabase.from('users').select('id').gt('created_at', since);

    res.json({
      usersTotal: usersCount || 0,
      sessionsTotal: sessionsCount || 0,
      novelsTotal: novelsCount || 0,
      pendingApprovals: pendingCount || 0,
      newUsersLast24h: Array.isArray(newUsers) ? newUsers.length : 0,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(400).json({ error: 'دریافت آمار ناموفق بود' });
  }
});

export default router;

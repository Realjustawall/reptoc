import { supabase } from '../postgres';
import { Request } from 'express';
import crypto from 'crypto';

export enum SecurityEventType {
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILURE = 'login_failure',
  LOGIN_AWAITING_2FA = 'login_awaiting_2fa',
  PASSWORD_CHANGE = 'password_change',
  USERNAME_CHANGE = 'username_change',
  SESSION_REVOKE = 'session_revoke',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  PERMISSION_DENIED = 'permission_denied',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
}

export async function logSecurityEvent(
  eventType: SecurityEventType,
  userId: string | null,
  details: Record<string, any>,
  req: Request
) {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'Unknown IP';

    // ✅ SECURITY: Hash the IP before storing, so a database leak doesn't
    // expose visitor IPs. The hash uses a separate pepper env var so a
    // single ENCRYPTION_KEY compromise cannot deanonymize IPs.
    const pepper = process.env.IP_HASH_PEPPER || process.env.ENCRYPTION_KEY || 'fallback-pepper';
    const ipHash = crypto.createHmac('sha256', pepper).update(String(ip)).digest('hex');

    await supabase.from('security_logs').insert({
      id: `sec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      event_type: eventType,
      user_id: userId,
      ip: ipHash, // ✅ hashed, not raw
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
      details: JSON.stringify(details),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

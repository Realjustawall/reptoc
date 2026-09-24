import { useState } from "react";
import { api } from "../utils/api";

type BulkAction = "grant" | "extend" | "revoke";

export default function PremiumBulkManagement({ userIds, onComplete }: { userIds: string[]; onComplete: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [action, setAction] = useState<BulkAction>("grant");
  const [reader, setReader] = useState(true);
  const [writer, setWriter] = useState(false);
  const [days, setDays] = useState(30);
  const [expiresAt, setExpiresAt] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [source, setSource] = useState("admin_grant");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const types = [reader && "reader", writer && "writer"].filter(Boolean);
  const request = async (path: string, body: any) => {
    const token = api.getToken();
    const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "عملیات گروهی پریمیوم ناموفق بود");
    return data;
  };
  const showPreview = async () => {
    setBusy(true); setError("");
    try { setPreview(await request("/api/admin/premium/bulk/preview", { userIds, action, premiumTypes: types })); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setError("");
    try {
      await request("/api/admin/premium/bulk", { userIds, premiumTypes: types, action, confirm: true, options: { durationSeconds: action === "revoke" || permanent || expiresAt ? undefined : days * 86400, expiresAt: permanent ? undefined : expiresAt || undefined, permanent, extensionMode: "add", source, reason } });
      setOpen(false); setPreview(null); onComplete();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" disabled={!userIds.length} onClick={() => setOpen(true)} className="px-2 py-1 bg-violet-600 disabled:opacity-40 text-white rounded text-xs">پریمیوم گروهی</button>
    {open && <div className="fixed inset-0 z-[100] bg-black/75 p-4 flex items-center justify-center" onKeyDown={e => e.key === "Escape" && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-premium-title" className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-950 p-5 space-y-4">
        <div className="flex justify-between"><h2 id="bulk-premium-title" className="font-black">عملیات گروهی پریمیوم</h2><button aria-label="بستن" onClick={() => setOpen(false)}>×</button></div>
        <p className="text-xs">کاربران انتخاب‌شده: {userIds.length}. برای هر دسترسی متأثر، یک رکورد حسابرسی تغییرناپذیر جداگانه ثبت می‌شود.</p>
        <div className="grid sm:grid-cols-2 gap-3"><label>عملیات<select autoFocus value={action} onChange={e => { setAction(e.target.value as BulkAction); setPreview(null); }} className="w-full bg-slate-900 border border-slate-600 rounded p-2"><option value="grant">اعطا</option><option value="extend">تمدید</option><option value="revoke">لغو</option></select></label><label>منبع<select value={source} onChange={e=>setSource(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2"><option value="admin_grant">اعطای مدیر</option><option value="promotion">پروموشن</option><option value="trial">دوره آزمایشی</option><option value="gift">هدیه</option><option value="support_compensation">جبران‌سازی پشتیبانی</option><option value="other">سایر</option></select></label><label>مدت (روز)<input disabled={action === "revoke"||permanent||!!expiresAt} type="number" min="1" max="3650" value={days} onChange={e => setDays(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-2" /></label><label>انقضای تبلیغاتی<input disabled={action==='revoke'||permanent} type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2"/></label><label className="flex gap-2"><input disabled={action==='revoke'} type="checkbox" checked={permanent} onChange={e=>setPermanent(e.target.checked)}/> دسترسی دائمی</label></div>
        <fieldset className="flex gap-4"><legend className="sr-only">نوع پریمیوم</legend><label><input type="checkbox" checked={reader} onChange={e => { setReader(e.target.checked); setPreview(null); }} /> خواننده</label><label><input type="checkbox" checked={writer} onChange={e => { setWriter(e.target.checked); setPreview(null); }} /> نویسنده</label></fieldset>
        <label className="block">دلیل داخلی<input value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2" required /></label>
        {error && <p role="alert" className="text-rose-400 text-xs">{error}</p>}
        {preview && <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3"><strong>پیش‌نمایش تأیید</strong><p>{preview.count} کاربر × {types.length} نوع دسترسی تحت تأثیر «{action === 'grant' ? 'اعطا' : action === 'extend' ? 'تمدید' : 'لغو'}» قرار می‌گیرند.</p><ul className="max-h-32 overflow-auto text-xs">{preview.users.map((u: any) => <li key={u.id}>{u.username} ({u.email})</li>)}</ul></div>}
        <div className="flex gap-2 justify-end"><button onClick={() => setOpen(false)} className="px-3 py-2 border border-slate-600 rounded">انصراف</button>{!preview ? <button disabled={busy || !types.length || !reason.trim()} onClick={() => void showPreview()} className="px-3 py-2 bg-violet-600 rounded disabled:opacity-40">پیش‌نمایش</button> : <button disabled={busy} onClick={() => void apply()} className="px-3 py-2 bg-rose-700 rounded">تأیید {action === 'grant' ? 'اعطا' : action === 'extend' ? 'تمدید' : 'لغو'}</button>}</div>
      </div>
    </div>}
  </>;
}

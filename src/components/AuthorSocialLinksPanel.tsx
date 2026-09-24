import React, { useEffect, useState } from "react";
import { AtSign, ExternalLink, HandCoins, Heart, Instagram, Music2, Pencil, Plus, Trash2, Youtube } from "lucide-react";
import { api } from "../utils/api";

type AuthorLink = { id: string; platform: string; label: string; url: string };

const platforms = [
  // Financial support first: it is the entry authors care most about.
  { value: "donate", label: "حمایت مالی", icon: HandCoins },
  { value: "patreon", label: "Patreon", icon: Heart },
  { value: "youtube", label: "YouTube", icon: Youtube },
  { value: "tiktok", label: "TikTok", icon: Music2 },
  { value: "x", label: "X", icon: AtSign },
  { value: "instagram", label: "Instagram", icon: Instagram }
] as const;

export default function AuthorSocialLinksPanel({ username, theme, compact = false }: { username: string; theme: "light" | "dark"; compact?: boolean }) {
  const [links, setLinks] = useState<AuthorLink[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ platform: "donate", label: "حمایت مالی", url: "" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dark = theme === "dark";

  const refresh = async () => setLinks(await api.getAuthorLinks(username));
  useEffect(() => { refresh(); }, [username]);

  const reset = () => {
    setEditingId(null);
    setForm({ platform: "donate", label: "حمایت مالی", url: "" });
    setFeedback("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    const result = editingId ? await api.updateAuthorLink(editingId, form) : await api.createAuthorLink(form);
    if (result?.success) {
      await refresh();
      reset();
      setFeedback("پیوندهای اجتماعی به‌روزرسانی شدند.");
    } else setFeedback(result?.error || "ذخیره پیوند ممکن نشد.");
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const result = await api.deleteAuthorLink(id);
    if (result?.success) {
      setLinks((current) => current.filter((link) => link.id !== id));
      if (editingId === id) reset();
      setFeedback("پیوند حذف شد.");
    } else setFeedback(result?.error || "حذف پیوند ممکن نشد.");
    setBusy(false);
  };

  return (
    <section className={`rounded-3xl border ${compact ? "p-4" : "p-5"} ${dark ? "bg-[#05060f] border-violet-900/20" : "bg-white border-stone-200"}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-black">حمایت مالی و شبکه‌های اجتماعی</h3>
          <p className="text-[11px] text-slate-500 mt-1">این پیوندها برای همه کسانی که نمایه نویسنده شما را باز می‌کنند دیده می‌شوند.</p>
        </div>
        <span className="text-[10px] font-mono font-bold text-violet-500">{links.length}/5</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mb-4">
        {platforms.map((platform) => {
          const link = links.find((item) => item.platform === platform.value);
          const Icon = platform.icon;
          return (
            <div key={platform.value} className={`rounded-xl border p-3 ${link ? "border-violet-500/25 bg-violet-500/5" : dark ? "border-slate-800 bg-black/20" : "border-stone-200 bg-stone-50"}`}>
              <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-violet-500" /><span className="text-xs font-bold">{platform.label}</span></div>
              {link ? (
                <div className="flex items-center gap-1 mt-2">
                  <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate text-[10px] text-violet-500 hover:underline">{link.label}</a>
                  <ExternalLink className="w-3 h-3 text-slate-500" />
                  <button type="button" title={`ویرایش ${platform.label}`} onClick={() => { setEditingId(link.id); setForm({ platform: link.platform, label: link.label, url: link.url }); setFeedback(""); }}><Pencil className="w-3.5 h-3.5 text-slate-500 hover:text-violet-500" /></button>
                  <button type="button" title={`حذف ${platform.label}`} disabled={busy} onClick={() => remove(link.id)}><Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-rose-500" /></button>
                </div>
              ) : <p className="text-[10px] text-slate-500 mt-2">افزوده نشده</p>}
            </div>
          );
        })}
      </div>

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-[160px_180px_1fr_auto] gap-2">
        <select value={form.platform} onChange={(event) => { const selected = platforms.find((item) => item.value === event.target.value); setForm({ platform: event.target.value, label: selected?.label || "", url: "" }); }} className={`rounded-xl border px-3 py-2 text-xs ${dark ? "bg-black/30 border-slate-800" : "bg-white border-stone-200"}`}>
          {platforms.map((platform) => <option key={platform.value} value={platform.value} disabled={links.some((link) => link.platform === platform.value && link.id !== editingId)}>{platform.label}{links.some((link) => link.platform === platform.value && link.id !== editingId) ? " (افزوده‌شده)" : ""}</option>)}
        </select>
        <input required maxLength={80} value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="نام نمایشی" className={`rounded-xl border px-3 py-2 text-xs ${dark ? "bg-black/30 border-slate-800" : "bg-white border-stone-200"}`} />
        <input required type="url" maxLength={2048} value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder={form.platform === "donate" ? "https://… نشانی صفحهٔ حمایت" : "https://..."} className={`rounded-xl border px-3 py-2 text-xs ${dark ? "bg-black/30 border-slate-800" : "bg-white border-stone-200"}`} />
        <div className="flex gap-2">
          <button disabled={busy || (!editingId && links.length >= 5)} className="inline-flex items-center justify-center gap-1 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Plus className="w-3.5 h-3.5" />{busy ? "در حال ذخیره" : editingId ? "به‌روزرسانی" : "افزودن"}</button>
          {editingId && <button type="button" onClick={reset} className="rounded-xl border border-slate-500/20 px-3 py-2 text-xs font-bold">لغو</button>}
        </div>
      </form>
      {feedback && <p className={`mt-2 text-[11px] ${feedback === "پیوندهای اجتماعی به‌روزرسانی شدند." || feedback === "پیوند حذف شد." ? "text-emerald-500" : "text-rose-500"}`}>{feedback}</p>}
    </section>
  );
}

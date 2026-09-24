import React, { useState } from "react";
import { Flag, X } from "lucide-react";
import { api } from "../utils/api";

const TARGET_TYPE_LABELS: Record<string, string> = {
  user: "کاربر",
  message: "پیام",
  novel: "رمان",
  chapter: "فصل"
};

interface ReportButtonProps {
  targetType: "user" | "message" | "novel" | "chapter";
  targetId: string;
  label?: string;
  className?: string;
}

export default function ReportButton({ targetType, targetId, label = "گزارش", className = "" }: ReportButtonProps) {
  const targetLabel = TARGET_TYPE_LABELS[targetType] ?? targetType;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Harassment or abuse");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = api.getToken();
    if (!token) {
      setFeedback("پیش از ثبت گزارش وارد حساب شوید.");
      return;
    }
    setSaving(true);
    setFeedback("");
    const result = await api.submitReport(token, { targetType, targetId, reason, details });
    setSaving(false);
    if (!result?.success) {
      setFeedback(result?.error || "گزارش ارسال نشد.");
      return;
    }
    setFeedback(`گزارش ارسال شد. ${result.remainingToday} گزارش دیگر برای امروز باقی مانده است.`);
    setDetails("");
    window.setTimeout(() => setOpen(false), 1500);
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setFeedback(""); }} className={`inline-flex items-center gap-1.5 ${className}`} title={`گزارش ${targetLabel}`}>
        <Flag className="w-3.5 h-3.5" /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !saving && setOpen(false)}>
          <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#090b16] text-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div><h3 className="font-black text-sm">گزارش {targetLabel}</h3><p className="text-[10px] text-slate-500">تیم مدیریت محتوای دقیق گزارش‌شده و هر دو حساب کاربری را خواهد دید.</p></div>
              <button type="button" onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-slate-400 font-bold">دلیل</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl bg-slate-950 border border-slate-700 p-2.5">
                <option value="Harassment or abuse">آزار و اذیت یا توهین</option><option value="Spam or scam">هرزنامه یا کلاهبرداری</option><option value="Hate or threatening content">محتوای نفرت‌پراکن یا تهدیدآمیز</option><option value="Sexual or unsafe content">محتوای جنسی یا ناامن</option><option value="Copyright infringement">نقض حقوق مؤلف</option><option value="Other violation">سایر تخلف‌ها</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-slate-400 font-bold">توضیحات</span>
              <textarea required minLength={5} maxLength={5000} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} className="w-full rounded-xl bg-slate-950 border border-slate-700 p-2.5 resize-none" placeholder="توضیح دهید چه اتفاقی افتاده است..." />
            </label>
            {feedback && <p className={`text-xs ${feedback.startsWith("گزارش ارسال شد") ? "text-emerald-400" : "text-rose-400"}`}>{feedback}</p>}
            <button disabled={saving || details.trim().length < 5} className="w-full rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 py-2.5 text-xs font-black">{saving ? "در حال ارسال..." : "ارسال گزارش"}</button>
          </form>
        </div>
      )}
    </>
  );
}

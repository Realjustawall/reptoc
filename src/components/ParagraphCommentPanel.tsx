import React, { useEffect, useRef, useState } from "react";
import { Heart, MessageSquare, Pencil, Reply, Trash2, X } from "lucide-react";
import { api } from "../utils/api";
import ReportButton from "./ReportButton";
import SafeImage from "./SafeImage";

interface ParagraphCommentPanelProps {
  novelId: string;
  chapterId: string;
  paragraphId: string;
  paragraphNumber: number;
  currentUser?: any;
  onClose: () => void;
  onCountChange: (paragraphId: string, count: number) => void;
}

export const PARAGRAPH_COMMENT_FOCUS_OPTIONS: FocusOptions = { preventScroll: true };

export default function ParagraphCommentPanel({
  novelId, chapterId, paragraphId, paragraphNumber, currentUser, onClose, onCountChange,
}: ParagraphCommentPanelProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const load = async (cursor?: string) => {
    setError("");
    const result = await api.getParagraphComments(novelId, chapterId, paragraphId, cursor);
    if (result.error) setError(result.error);
    const incoming = result.comments || [];
    setComments((current) => cursor ? [...current, ...incoming] : incoming);
    setNextCursor(result.nextCursor || null);
    setLoading(false);
  };

  useEffect(() => {
    setComments([]);
    setNextCursor(null);
    setDraft("");
    setReplyTo(null);
    setEditing(null);
    setLikeBusyIds(new Set());
    setLoading(true);
    void load();
  }, [novelId, chapterId, paragraphId]);

  useEffect(() => {
    draftRef.current?.focus(PARAGRAPH_COMMENT_FOCUS_OPTIONS);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [paragraphId, onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    const token = api.getToken();
    if (!token) return setError("برای ثبت دیدگاه روی این پاراگراف وارد شوید.");
    setBusy(true);
    const result = editing
      ? await api.editChapterComment(token, novelId, chapterId, editing.id, draft)
      : await api.addParagraphComment(token, novelId, chapterId, paragraphId, draft, replyTo?.id);
    if (result?.success) {
      if (editing) {
        setComments((current) => result.moderationStatus && result.moderationStatus !== "visible"
          ? current.filter((comment) => comment.id !== editing.id)
          : current.map((comment) => comment.id === editing.id ? { ...comment, content: draft, updated_at: result.updatedAt } : comment));
      } else if (result.comment) {
        setComments((current) => {
          const next = [...current, result.comment];
          onCountChange(paragraphId, next.filter((comment) => !comment.deleted_at).length);
          return next;
        });
      }
      setDraft("");
      setReplyTo(null);
      setEditing(null);
      setError(result.moderationStatus && result.moderationStatus !== "visible" ? (result.message || "دیدگاه برای بررسی ارسال شد.") : "");
    } else {
      setError(result?.error || "ذخیره دیدگاه ممکن نشد.");
    }
    setBusy(false);
  };

  const remove = async (comment: any) => {
    const token = api.getToken();
    if (!token || busy || !window.confirm("این دیدگاه حذف شود؟")) return;
    setBusy(true);
    const result = await api.deleteChapterComment(token, novelId, chapterId, comment.id);
    if (result?.success) {
      setComments((current) => current.map((item) => item.id === comment.id ? { ...item, content: "این دیدگاه حذف شده است.", deleted_at: new Date().toISOString() } : item));
      onCountChange(paragraphId, Math.max(0, comments.filter((item) => !item.deleted_at).length - 1));
    } else setError(result?.error || "حذف دیدگاه ممکن نشد.");
    setBusy(false);
  };

  const setLike = async (comment: any) => {
    const token = api.getToken();
    if (!token) return setError("برای لایک کردن دیدگاه وارد شوید.");
    if (likeBusyIds.has(comment.id)) return;
    const liked = !comment.likedByCurrentUser;
    setLikeBusyIds((current) => new Set(current).add(comment.id));
    setError("");
    const result = await api.setChapterCommentLike(token, novelId, chapterId, comment.id, liked);
    if (result?.success) {
      setComments((current) => current.map((item) => item.id === comment.id ? {
        ...item,
        likedByCurrentUser: result.liked,
        likesCount: Number(result.likesCount || 0),
      } : item));
    } else {
      setError(result?.error || "به‌روزرسانی لایک دیدگاه ممکن نشد.");
    }
    setLikeBusyIds((current) => {
      const next = new Set(current);
      next.delete(comment.id);
      return next;
    });
  };

  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="paragraph-comments-title" className="relative z-10 mt-3 flex max-h-[min(70vh,36rem)] w-full select-text flex-col overflow-hidden rounded-2xl border border-slate-700/30 bg-white font-sans text-slate-900 shadow-xl dark:bg-[#0b0716] dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-700/15 p-4">
        <div>
          <h2 id="paragraph-comments-title" className="flex items-center gap-2 text-sm font-black"><MessageSquare className="h-4 w-4 text-emerald-500" />پاراگراف {paragraphNumber}</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">گفتگو با ویرایش فصل، به همین پاراگراف متصل می‌ماند.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="بستن دیدگاه‌های پاراگراف" className="rounded-lg p-2 hover:bg-slate-500/10"><X className="h-4 w-4" /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? <p className="text-xs text-slate-500">در حال بارگذاری دیدگاه‌ها…</p> : comments.length === 0 ? <p className="text-xs text-slate-500">هنوز دیدگاهی روی این پاراگراف ثبت نشده است.</p> : comments.map((comment) => (
          <article key={comment.id} className={`rounded-xl border border-slate-700/15 p-3 ${comment.parent_id ? "ml-5" : ""}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <SafeImage src={comment.avatar} alt="" className="h-7 w-7 rounded-lg object-cover" />
                <div><strong className="block truncate text-[11px]">{comment.displayName || comment.username || "خواننده"}</strong><span className="block text-[9px] text-slate-500">{new Date(comment.created_at).toLocaleString("fa-IR-u-nu-latn")}</span></div>
              </div>
              {!comment.deleted_at && <div className="flex items-center">
                <button type="button" onClick={() => void setLike(comment)} disabled={likeBusyIds.has(comment.id)} aria-label={comment.likedByCurrentUser ? "برداشتن لایک دیدگاه" : "لایک کردن دیدگاه"} aria-pressed={!!comment.likedByCurrentUser} className={`flex items-center gap-1 p-1.5 disabled:opacity-50 ${comment.likedByCurrentUser ? "text-rose-500" : "text-slate-500 hover:text-rose-500"}`}><Heart className={`h-3.5 w-3.5 ${comment.likedByCurrentUser ? "fill-current" : ""}`} /><span className="text-[9px] tabular-nums">{Number(comment.likesCount || 0)}</span></button>
                <button type="button" onClick={() => { setReplyTo(comment); setEditing(null); setDraft(""); }} aria-label="پاسخ به دیدگاه" className="p-1.5 text-slate-500 hover:text-violet-500"><Reply className="h-3.5 w-3.5" /></button>
                {currentUser?.id === comment.user_id ? <>
                  <button type="button" onClick={() => { setEditing(comment); setReplyTo(null); setDraft(comment.content); }} aria-label="ویرایش دیدگاه" className="p-1.5 text-slate-500 hover:text-violet-500"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => void remove(comment)} aria-label="حذف دیدگاه" className="p-1.5 text-slate-500 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </> : currentUser && <ReportButton targetType="message" targetId={comment.id} label="" className="p-1.5 text-rose-400/70" />}
              </div>}
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed">{comment.content}</p>
            {comment.updated_at && !comment.deleted_at && <span className="text-[9px] text-slate-500">ویرایش‌شده</span>}
          </article>
        ))}
        {nextCursor && <button type="button" onClick={() => void load(nextCursor)} className="w-full rounded-lg border border-slate-500/20 py-2 text-xs font-bold">بارگذاری بیشتر</button>}
      </div>
      <form onSubmit={submit} className="space-y-2 border-t border-slate-700/15 p-4">
        {(replyTo || editing) && <div className="flex items-center justify-between rounded-lg bg-violet-500/10 px-2 py-1 text-[10px]"><span>{editing ? "در حال ویرایش دیدگاه شما" : `در حال پاسخ به ${replyTo.displayName || replyTo.username || "خواننده"}`}</span><button type="button" onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); }}>لغو</button></div>}
        <label className="sr-only" htmlFor="paragraph-comment-draft">دیدگاه پاراگراف</label>
        <textarea ref={draftRef} id="paragraph-comment-draft" rows={3} maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={currentUser ? "دیدگاه خود را بنویسید…" : "برای ثبت دیدگاه وارد شوید"} disabled={!currentUser || busy} className="w-full resize-none rounded-xl border border-slate-700/20 bg-transparent p-3 text-xs" />
        {error && <p role="alert" className="text-[10px] font-bold text-rose-500">{error}</p>}
        <div className="flex items-center justify-between"><span className="text-[9px] text-slate-500">{draft.length}/5000</span><button type="submit" disabled={!currentUser || !draft.trim() || busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? "در حال ذخیره…" : editing ? "ذخیره ویرایش" : "ارسال دیدگاه"}</button></div>
      </form>
    </aside>
  );
}

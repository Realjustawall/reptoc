import React, { useState, useEffect } from "react";
import { ArrowLeft, BookOpen, Trash2 } from "lucide-react";
import { Novel } from "../types";
import { getSocket } from "../utils/socket";
import { api as apiClient } from "../utils/api";

function getForumContent(source: any) {
  return String(
    source?.content ??
    source?.body ??
    source?.description ??
    source?.message ??
    source?.text ??
    source?.post_content ??
    source?.initial_post ??
    ""
  ).trim();
}

export default function ThreadView({ thread, theme, onBack, onDeleted, currentUser, novels = [], onNavigateToNovel }: any) {
  const [replies, setReplies] = useState<any[]>([]);
  const [loadedThread, setLoadedThread] = useState<any>(thread);
  const [newReply, setNewReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const loadThread = React.useCallback(async () => {
    setThreadError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/forums/threads/${encodeURIComponent(thread.id)}`, {
        credentials: "same-origin"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "بارگیری موضوع ناموفق بود");
      if (data.thread) {
        setLoadedThread((current: any) => ({
          ...thread,
          ...current,
          ...data.thread,
          content: getForumContent(data.thread) || getForumContent(current) || getForumContent(thread)
        }));
      }
      if (Array.isArray(data.posts)) setReplies(data.posts);
      return data;
    } catch (error: any) {
      setThreadError(error?.message || "موضوع بارگیری نشد.");
      throw error;
    } finally {
      setLoading(false);
    }
  }, [thread]);

  useEffect(() => {
    setLoadedThread(thread);
    setReplies([]);
    setReplyError(null);
    setThreadError(null);
    setLoading(true);
  }, [thread]);

  useEffect(() => {
    loadThread().catch(() => {});

    const socket = getSocket();
    if (socket) {
      const joinThread = () => socket.emit("join_thread", thread.id);
      const handleForumPostAdded = (post: any) => {
        const postThreadId = post?.thread_id || post?.threadId;
        if (postThreadId && postThreadId !== thread.id) return;
        loadThread().catch(() => {});
      };
      joinThread();
      socket.on("connect", joinThread);
      socket.on("forum_post_added", handleForumPostAdded);
      return () => {
        socket.emit("leave_thread", thread.id);
        socket.off("connect", joinThread);
        socket.off("forum_post_added", handleForumPostAdded);
      };
    }
  }, [thread.id, loadThread]);

  const handlePostReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReply.trim()) return;
    if (posting) return;
    setReplyError(null);
    setPosting(true);
    try {
      const token = apiClient.getToken();
      const res = await fetch(`/api/forums/threads/${encodeURIComponent(thread.id)}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
        credentials: "same-origin",
        body: JSON.stringify({ content: newReply })
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok || created?.success === false) {
        setReplyError(created?.error || "پاسخ ارسال نشد.");
        return;
      }
      setNewReply("");
      if (created?.post) {
        setReplies((current) => [...current, created.post]);
      }
      await loadThread().catch(() => {});
      const socket = getSocket();
      if (socket && created?.id) socket.emit("new_forum_post", { threadId: thread.id, post: { id: created.id } });
    } catch {
      setReplyError("خطای شبکه هنگام ارسال پاسخ.");
    } finally {
      setPosting(false);
    }
  };

  const handlePin = async (id: string, type: string) => {
    const token = apiClient.getToken();
    const res = await fetch(`/api/forums/${type}/${encodeURIComponent(id)}/pin`, {
      method: "POST",
      headers: token ? { "X-CSRF-Token": token } : {},
      credentials: "same-origin"
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setThreadError(body?.error || "عملیات سنجاق ناموفق بود.");
      return;
    }
    await loadThread().catch(() => {});
  };

  const handleDeleteReply = async (replyId: string) => {
    setThreadError(null);
    const token = apiClient.getToken();
    const res = await fetch(`/api/forums/posts/${encodeURIComponent(replyId)}`, {
      method: "DELETE",
      headers: token ? { "X-CSRF-Token": token } : {},
      credentials: "same-origin"
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setThreadError(body?.error || "پاسخ حذف نشد.");
      return;
    }
    await loadThread().catch(() => {});
  };

  const normalizedRole = String(currentUser?.role || "").toLowerCase().trim();
  const isAdmin = normalizedRole === "owner" || normalizedRole === "publisher" || normalizedRole === "editor";
  const displayThread = loadedThread?.id === thread.id ? loadedThread : thread;
  const threadAuthor = displayThread.author_username || displayThread.author || thread.author;
  const threadRole = displayThread.author_role || displayThread.authorRole || thread.authorRole;
  const threadCategory = displayThread.category || displayThread.forum_id || thread.category;
  const threadContent = getForumContent(displayThread) || getForumContent(thread);
  const canDeleteThread = isAdmin ||
    String(currentUser?.id || "") === String(displayThread.user_id || displayThread.author_id || "");

  const renderSignature = (username: unknown, userId?: unknown) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;
    const authoredNovels = (novels as Novel[]).filter((novel) =>
      String(novel.author_id || "") === normalizedUserId &&
      novel.approvalStatus !== "rejected" &&
      novel.approvalStatus !== "pending_approval"
    );
    if (!authoredNovels.length) return null;

    return (
      <div className={`mt-4 border-t pt-3 ${theme === "dark" ? "border-violet-900/20" : "border-stone-200"}`}>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
          <BookOpen className="h-3.5 w-3.5" />
          امضا
        </div>
        <div className="flex flex-wrap gap-2">
          {authoredNovels.map((novel) => (
            <button
              key={novel.id}
              type="button"
              onClick={() => onNavigateToNovel?.(novel.id)}
              className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                theme === "dark"
                  ? "border-violet-900/30 bg-violet-500/5 hover:bg-violet-500/15"
                  : "border-stone-200 bg-white hover:bg-stone-100"
              }`}
            >
              {(novel.coverUrl || novel.cover) && <img src={novel.coverUrl || novel.cover} alt="" className="h-8 w-6 rounded object-cover" />}
              <span className="max-w-48 truncate text-xs font-bold">{novel.title}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const handleDeleteThread = async () => {
    if (!canDeleteThread) return;
    setDeleting(true);
    setThreadError(null);
    const ok = await apiClient.deleteThread(thread.id);
    setDeleting(false);
    if (ok) {
      if (typeof onDeleted === "function") onDeleted(thread.id);
      else onBack();
      return;
    }
    setThreadError("موضوع حذف نشد.");
  };

  const renderReply = (reply: any, depth = 0): React.ReactNode => {
    const replyContent = getForumContent(reply);
    const replyAuthor = reply.author_username || reply.author || "کاربر";
    const canDeleteReply = isAdmin ||
      String(currentUser?.id || "") === String(reply.user_id || reply.author_id || "");
    return (
      <div
        key={reply.id}
        className={`p-4 rounded-xl border ${depth > 0 ? "ml-4 md:ml-8" : ""} ${
          theme === "dark"
            ? "bg-[#0e0a1c] border-violet-900/20 text-slate-300"
            : "bg-stone-50 border-stone-100 text-stone-700"
        }`}
      >
        <div className="text-[10px] font-bold text-slate-500 mb-2 flex justify-between gap-3">
          <span>{replyAuthor} ({reply.author_role || "نویسنده"}) {reply.is_pinned === 1 && "سنجاق‌شده"}</span>
          <span className="flex shrink-0 gap-2">
            {isAdmin && <button onClick={() => handlePin(reply.id, "posts")} className="underline">سنجاق / برداشتن سنجاق</button>}
            {canDeleteReply && <button onClick={() => handleDeleteReply(reply.id)} className="text-rose-400 underline">حذف</button>}
          </span>
        </div>
        <p className="text-sm whitespace-pre-wrap">{replyContent}</p>
        {renderSignature(reply.author_username || reply.author, reply.author_id || reply.user_id)}
        {Array.isArray(reply.replies) && reply.replies.length > 0 && (
          <div className="mt-3 space-y-3">
            {reply.replies.map((child: any) => renderReply(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-violet-500 hover:text-violet-400 font-bold mb-4 flex items-center gap-1 text-sm">
        <ArrowLeft className="w-4 h-4" /> بازگشت
      </button>
      {threadError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {threadError}
        </div>
      )}
      <div className={`p-6 rounded-2xl border ${theme === "dark" ? "bg-[#0b0716] border-violet-900/40 text-white" : "bg-white border-stone-200 text-stone-900"}`}>
        <h2 className="text-2xl font-extrabold mb-2">{displayThread.title || thread.title} {displayThread.isPinned && "سنجاق‌شده"}</h2>
        <div className="flex flex-wrap gap-2 text-xs mb-4 text-slate-400">توسط {threadAuthor} - {threadRole} - {threadCategory} - {displayThread.votes || thread.votes || 0} رأی</div>
        <div className={`mb-5 rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap ${
          theme === "dark" ? "bg-black/25 border-violet-950/30 text-slate-200" : "bg-stone-50 border-stone-100 text-stone-700"
        }`}>
          {threadContent || (loading ? "در حال بارگیری محتوای موضوع..." : "محتوایی برای این موضوع ذخیره نشده است.")}
          {renderSignature(threadAuthor, displayThread.author_id || displayThread.user_id)}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <button onClick={() => handlePin(thread.id, "threads")} className="px-3 py-1 bg-stone-700 text-white rounded text-xs">سنجاق / برداشتن سنجاق موضوع</button>}
          {canDeleteThread && (
            <button disabled={deleting} onClick={handleDeleteThread} className="px-3 py-1 bg-rose-600 text-white rounded text-xs inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
              <Trash2 className="w-3 h-3" />
              {deleting ? "در حال حذف..." : "حذف موضوع"}
            </button>
          )}
        </div>
      </div>

      <h3 className="font-bold text-lg mt-6 mb-2">پاسخ‌ها</h3>
      <div className="space-y-3">
        {loading && replies.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">در حال بارگیری پاسخ‌ها...</div>
        ) : replies.length > 0 ? replies.map((reply) => renderReply(reply)) : (
          <div className="p-4 rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">هنوز پاسخی نیست.</div>
        )}
      </div>

      {currentUser && (
        <form onSubmit={handlePostReply} className="mt-6 flex flex-col gap-2">
          <textarea
            value={newReply}
            onChange={e => setNewReply(e.target.value)}
            className={`w-full p-4 text-sm rounded border ${theme === "dark" ? "bg-black text-white outline-none" : "bg-white outline-none focus:border-violet-500"}`}
            placeholder="پاسخ خود را بنویسید..."
            disabled={posting}
          />
          {replyError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {replyError}
            </div>
          )}
          <button disabled={posting || !newReply.trim()} className="self-end px-5 py-2 bg-violet-600 text-white font-bold rounded-xl text-sm hover:bg-violet-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            {posting ? "در حال ارسال..." : "ارسال پاسخ"}
          </button>
        </form>
      )}
    </div>
  );
}

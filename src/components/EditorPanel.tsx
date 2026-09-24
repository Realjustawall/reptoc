import React, { useState, useEffect } from "react";
import { CONTRAST_THEMES } from "../data";
import { CheckCircle2, ShieldAlert, PenTool, MessageSquare, Trash2, Edit, LifeBuoy } from "lucide-react";
import { api } from "../utils/api";
import { isSafeUrl } from "../utils/safeUrl";
import { isNovelPendingEditorialReview } from "../utils/novelVisibility";
import SafeImage from "./SafeImage";
import MangaReader from "./MangaReader";
import { normalizeContentKind, normalizeReadingDirection, type MangaPage } from "../../shared/manga";

interface EditorPanelProps {
  theme: "light" | "dark";
  userRole: "writer" | "editor" | "publisher" | "owner";
}

function sanitizeEditorHtml(html: string) {
  if (typeof window === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html || "";

  const blockedTags = new Set(["script", "iframe", "object", "embed", "link", "meta", "style", "svg", "video", "audio", "source", "track", "form", "input", "button"]);
  const safeTags = new Set(["div", "span", "p", "a", "img", "br", "strong", "em", "u", "s", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr"]);

  const sanitizeNode = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      if (blockedTags.has(tagName)) { element.remove(); return; }
      if (!safeTags.has(tagName)) {
        while (element.firstChild) element.parentNode?.insertBefore(element.firstChild, element);
        element.remove();
        return;
      }

      const safeAttrs: Record<string, string> = {};
      if (tagName === "a") {
        const href = element.getAttribute("href") || "";
        if (href && isSafeUrl(href)) {
          safeAttrs.href = href;
          safeAttrs.target = "_blank";
          safeAttrs.rel = "noopener noreferrer";
        }
      } else if (tagName === "img") {
        const src = element.getAttribute("src") || "";
        if (src.toLowerCase().startsWith("https:")) {
          safeAttrs.src = src;
          safeAttrs.alt = element.getAttribute("alt") || "تصویر";
        }
      }

      Array.from(element.attributes).forEach((attr) => element.removeAttribute(attr.name));
      Object.entries(safeAttrs).forEach(([key, value]) => element.setAttribute(key, value));
      Array.from(element.childNodes).forEach(sanitizeNode);
    } else if (node.nodeType !== Node.TEXT_NODE) {
      node.parentNode?.removeChild(node);
    }
  };

  Array.from(template.content.childNodes).forEach(sanitizeNode);
  return template.innerHTML;
}

export default function EditorPanel({ theme, userRole }: EditorPanelProps) {
  const activeTheme = CONTRAST_THEMES[theme];
  const isDark = theme === "dark";

  const [activeSegment, setActiveSegment] = useState<"pending_review" | "rejected_changes" | "approved_by_me" | "overdue" | "assigned" | "tickets">("pending_review");
  const [novels, setNovels] = useState<any[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [selectedNovel, setSelectedNovel] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [selectedReviewChapter, setSelectedReviewChapter] = useState<any | null>(null);
  const [reviewTools, setReviewTools] = useState<any | null>(null);
  const [inlineAnchor, setInlineAnchor] = useState("");
  const [inlineComment, setInlineComment] = useState("");
  const [threadSubject, setThreadSubject] = useState("");
  const [threadContent, setThreadContent] = useState("");
  const [selectedThread, setSelectedThread] = useState<any | null>(null);
  const [threadMessages, setThreadMessages] = useState<any[]>([]);
  const [threadReply, setThreadReply] = useState("");
  const [editorStaff, setEditorStaff] = useState<any[]>([]);
  const [assignEditorId, setAssignEditorId] = useState("");
  const [assignDueAt, setAssignDueAt] = useState("");
  const [tickets, setTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const [ticketReply, setTicketReply] = useState("");
  const checklistLabels = [
    ["grammar", "نگارش"],
    ["taxonomy", "دسته‌بندی"],
    ["warnings", "هشدارها"],
    ["ageRating", "رده‌بندی سنی"],
    ["continuity", "انسجام روایت"],
    ["plagiarism", "سرقت ادبی"],
    ["aiRisk", "ریسک هوش مصنوعی"]
  ];

  useEffect(() => {
    loadNovels();
    loadEditorStaff();
  }, []);

  useEffect(() => {
    if (activeSegment === "tickets") {
      loadTickets();
    }
  }, [activeSegment]);

  const loadNovels = async () => {
    const token = api.getToken();
    if (token) {
      const res = await api.getNovelsForEditor(token);
      setNovels(res);
    }
  };

  const loadEditorStaff = async () => {
    const token = api.getToken();
    if (!token) return;
    const staff = await api.getEditorStaff(token);
    setEditorStaff(staff);
    if (staff[0]?.id) setAssignEditorId(staff[0].id);
  };

  const loadTickets = async () => {
    const token = api.getToken();
    if (!token) return;
    const result = await api.getTickets(token, "all").catch((err: any) => { alert(err?.message || "بارگیری تیکت‌ها ناموفق بود."); return []; });
    setTickets(result);
    if (selectedTicket) {
      const updated = result.find((ticket: any) => ticket.id === selectedTicket.id);
      if (updated) setSelectedTicket(updated);
    }
  };

  const loadTicketMessages = async (ticketId: string) => {
    const token = api.getToken();
    if (!token) return;
    const messages = await api.getTicketMessages(token, ticketId).catch((err: any) => { alert(err?.message || "بارگیری پیام‌های تیکت ناموفق بود."); return []; });
    setTicketMessages(messages);
  };

  const selectTicket = (ticket: any) => {
    setSelectedTicket(ticket);
    loadTicketMessages(ticket.id);
  };

  const sendTicketReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !ticketReply.trim()) return;
    const token = api.getToken();
    if (!token) return;
    const ok = await api.sendTicketMessage(token, selectedTicket.id, ticketReply).catch((err: any) => { alert(err?.message || "ارسال پاسخ تیکت ناموفق بود."); return false; });
    if (!ok) return alert("ارسال پاسخ تیکت ناموفق بود.");
    setTicketReply("");
    await loadTicketMessages(selectedTicket.id);
    await loadTickets();
  };

  const changeTicketStatus = async (status: string) => {
    if (!selectedTicket) return;
    const token = api.getToken();
    if (!token) return;
    const ok = await api.updateTicketStatus(token, selectedTicket.id, status).catch((err: any) => { alert(err?.message || "به‌روزرسانی وضعیت تیکت ناموفق بود."); return false; });
    if (!ok) return alert("به‌روزرسانی وضعیت تیکت ناموفق بود.");
    setSelectedTicket({ ...selectedTicket, status });
    await loadTickets();
  };

  const loadAssignedNovelDetails = async (novel: any) => {
    setSelectedNovel(novel);
    setSelectedReviewChapter(null);
    setReviewTools(null);
    setSelectedChapterIds([]);
    const token = api.getToken();
    if (token) {
      const chaps = await api.getDetailedChaptersEditor(token, novel.id);
      setChapters(chaps);
      const msgs = await api.getEditorMessages(token, novel.id);
      setMessages(msgs);
    }
  };

  const handleApprove = async () => {
    if (!approvingId) return;
    const token = api.getToken();
    if (token) {
      const success = await api.moderateNovel(token, approvingId, "approved", rejectReason);
      if (!success) {
        alert("تأیید رمان ناموفق بود؛ ممکن است این رمان به شما واگذار نشده باشد.");
        return;
      }
      await loadNovels();
    }
    setApprovingId(null);
    setRejectReason("");
  };

  const handleReject = async () => {
    if (!rejectingId) return;
    const token = api.getToken();
    if (token) {
      const success = await api.moderateNovel(token, rejectingId, "rejected", rejectReason);
      if (!success) {
        alert("رد رمان ناموفق بود؛ ممکن است این رمان به شما واگذار نشده باشد.");
        return;
      }
      await loadNovels();
    }
    setRejectingId(null);
    setRejectReason("");
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedNovel) return;
    const token = api.getToken();
    if (token) {
      const success = await api.sendEditorMessage(token, selectedNovel.id, newMessage);
      if (!success) {
        alert("ارسال پیام ویراستار ناموفق بود.");
        return;
      }
      setNewMessage("");
      const msgs = await api.getEditorMessages(token, selectedNovel.id);
      setMessages(msgs);
    }
  };

  const deleteChapter = async (chapterId: string) => {
    if (!window.confirm("آیا از حذف این فصل مطمئن هستید؟")) return;
    const token = api.getToken();
    if (token && selectedNovel) {
      const success = await api.editorDeleteChapter(token, selectedNovel.id, chapterId);
      if (!success) {
        alert("حذف فصل ناموفق بود.");
        return;
      }
      const chaps = await api.getDetailedChaptersEditor(token, selectedNovel.id);
      setChapters(chaps);
    }
  };

  const saveChapterNote = async (chapterId: string, note: string) => {
    const token = api.getToken();
    if (token && selectedNovel) {
      const success = await api.editorSaveChapterNote(token, selectedNovel.id, chapterId, note);
      if (!success) alert("ذخیره یادداشت فصل ناموفق بود.");
    }
  };

  const openReviewTools = async (chapter: any) => {
    if (!selectedNovel) return;
    setSelectedReviewChapter(chapter);
    const token = api.getToken();
    if (!token) return;
    const tools = await api.getEditorReviewTools(token, selectedNovel.id, chapter.id);
    setReviewTools(tools);
  };

  /**
   * Pages of the chapter under review, when it belongs to a manga.
   *
   * `null` means "this is prose", which is what selects the HTML review pane
   * below; an empty array means a manga chapter that genuinely has no pages yet.
   */
  const reviewMangaPages: MangaPage[] | null =
    normalizeContentKind(reviewTools?.contentKind) === "manga"
      ? (Array.isArray(reviewTools?.pages) ? reviewTools.pages : [])
      : null;

  const toggleChecklist = async (key: string, checked: boolean) => {
    if (!selectedNovel || !selectedReviewChapter) return;
    const token = api.getToken();
    if (!token) return;
    const nextChecklist = { ...(reviewTools?.checklist?.checklist || {}), [key]: checked };
    const ok = await api.saveEditorChecklist(token, selectedNovel.id, selectedReviewChapter.id, nextChecklist, "in_review");
    if (ok) await openReviewTools(selectedReviewChapter);
  };

  const addInlineComment = async () => {
    if (!selectedNovel || !selectedReviewChapter || !inlineComment.trim()) return;
    const token = api.getToken();
    if (!token) return;
    const result = await api.saveEditorInlineComment(token, selectedNovel.id, selectedReviewChapter.id, {
      anchorText: inlineAnchor,
      comment: inlineComment,
      startOffset: 0,
      endOffset: 0
    });
    if (result?.success) {
      setInlineAnchor("");
      setInlineComment("");
      await openReviewTools(selectedReviewChapter);
    }
  };

  const useSelectedTextAsAnchor = () => {
    const selected = window.getSelection()?.toString().trim() || "";
    if (selected) setInlineAnchor(selected.slice(0, 500));
  };

  const scanSelectedChapter = async () => {
    if (!selectedNovel || !selectedReviewChapter) return;
    const token = api.getToken();
    if (!token) return;
    await api.scanEditorChapter(token, selectedNovel.id, selectedReviewChapter.id);
    await openReviewTools(selectedReviewChapter);
  };

  const createThread = async () => {
    if (!selectedNovel || !threadSubject.trim() || !threadContent.trim()) return;
    const token = api.getToken();
    if (!token) return;
    const result = await api.createEditorThread(token, selectedNovel.id, {
      chapterId: selectedReviewChapter?.id,
      subject: threadSubject,
      content: threadContent
    });
    if (result?.success) {
      setThreadSubject("");
      setThreadContent("");
      if (selectedReviewChapter) await openReviewTools(selectedReviewChapter);
    }
  };

  const loadThread = async (thread: any) => {
    const token = api.getToken();
    if (!token) return;
    setSelectedThread(thread);
    const data = await api.getEditorThreadMessages(token, thread.id);
    setThreadMessages(data?.messages || []);
  };

  const sendThreadReply = async () => {
    if (!selectedThread || !threadReply.trim()) return;
    const token = api.getToken();
    if (!token) return;
    const ok = await api.sendEditorThreadMessage(token, selectedThread.id, threadReply);
    if (ok) {
      setThreadReply("");
      await loadThread(selectedThread);
    }
  };

  const applyBulkAction = async (action: string) => {
    if (!selectedNovel || selectedChapterIds.length === 0) return alert("ابتدا فصل‌ها را انتخاب کنید.");
    const token = api.getToken();
    if (!token) return;
    const note = action === "delete" ? "" : window.prompt("یادداشت گروهی ویرایشی", action === "needs_changes" ? "نیازمند بازنگری است." : "") || "";
    if (action === "delete" && !confirm("فصل‌های انتخاب‌شده حذف شوند؟")) return;
    const result = await api.bulkEditorChapters(token, selectedNovel.id, selectedChapterIds, action, note);
    if (!result?.success) return alert("عملیات گروهی ناموفق بود.");
    const chaps = await api.getDetailedChaptersEditor(token, selectedNovel.id);
    setChapters(chaps);
    setSelectedChapterIds([]);
    setSelectedReviewChapter(null);
    setReviewTools(null);
  };

  const assignNovel = async (novel: any) => {
    const token = api.getToken();
    if (!token || !assignEditorId) return alert("ابتدا یک ویراستار انتخاب کنید.");
    const ok = await api.assignEditorTarget(token, {
      targetType: "novel",
      novelId: novel.id,
      editorId: assignEditorId,
      dueAt: assignDueAt || null
    });
    if (!ok) return alert("واگذاری ناموفق بود.");
    await loadNovels();
  };

  const assignSelectedChapters = async () => {
    if (!selectedNovel || selectedChapterIds.length === 0 || !assignEditorId) return alert("ابتدا فصل‌ها و یک ویراستار انتخاب کنید.");
    const token = api.getToken();
    if (!token) return;
    for (const chapterId of selectedChapterIds) {
      await api.assignEditorTarget(token, {
        targetType: "chapter",
        novelId: selectedNovel.id,
        chapterId,
        editorId: assignEditorId,
        dueAt: assignDueAt || null
      });
    }
    const chaps = await api.getDetailedChaptersEditor(token, selectedNovel.id);
    setChapters(chaps);
    await loadNovels();
  };

  const setChapterStatus = async (chapter: any, status: string) => {
    if (!selectedNovel) return;
    const token = api.getToken();
    if (!token) return;
    const note = ["needs_changes", "approved", "published"].includes(status) ? (window.prompt("یادداشت ویرایشی", chapter.editor_note || "") || "") : "";
    const scheduledAt = status === "scheduled" ? window.prompt("تاریخ و ساعت زمان‌بندی‌شده (قالب ISO)", chapter.scheduled_at || "") || "" : undefined;
    const ok = await api.updateEditorChapterStatus(token, selectedNovel.id, chapter.id, status, note, scheduledAt);
    if (!ok) return alert("به‌روزرسانی وضعیت فصل ناموفق بود.");
    const chaps = await api.getDetailedChaptersEditor(token, selectedNovel.id);
    setChapters(chaps);
    const updated = chaps.find((item: any) => item.id === chapter.id);
    if (updated && selectedReviewChapter?.id === chapter.id) await openReviewTools(updated);
  };

  const hasNeedsChanges = (novel: any) => novel.approval_status === "rejected" || Number(novel.editorial_counts?.needs_changes || 0) > 0;
  const isOverdue = (novel: any) => Number(novel.editorial_counts?.overdue || 0) > 0 || (novel.review_due_at && new Date(novel.review_due_at).getTime() < Date.now());
  const pendingReviewNovels = novels.filter(isNovelPendingEditorialReview);
  const rejectedAwaitingChanges = novels.filter(hasNeedsChanges);
  const approvedByMeNovels = novels.filter(n => n.approved_by_me || Number(n.editorial_counts?.approved || 0) > 0 || Number(n.editorial_counts?.published || 0) > 0);
  const overdueNovels = novels.filter(isOverdue);
  const assignedNovels = novels.filter(n => n.assigned_to_me || n.approved_by_me);
  const openTickets = tickets.filter((ticket) => !["CLOSED", "RESOLVED"].includes(String(ticket.status || "").toUpperCase())).length;
  const visibleNovels =
    activeSegment === "pending_review" ? pendingReviewNovels :
    activeSegment === "rejected_changes" ? rejectedAwaitingChanges :
    activeSegment === "approved_by_me" ? approvedByMeNovels :
    activeSegment === "overdue" ? overdueNovels :
    activeSegment === "tickets" ? [] :
    assignedNovels;

  return (
    <div className="space-y-6 pb-16">
      <div className={`p-4 md:p-6 rounded-3xl border ${activeTheme.border} ${activeTheme.card} flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${activeTheme.shadow}`}>
        <div className="flex items-center gap-3 text-left">
          <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-400">
            <PenTool className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold font-sans">پیشخوان ویراستار</h1>
            <p className="text-xs text-slate-500 font-medium">پیش‌نویس‌های در انتظار بررسی را مرور کنید و مجموعه‌های واگذارشده را مدیریت کنید.</p>
          </div>
        </div>

        <div className={`w-full xl:w-auto p-1 rounded-xl border ${isDark ? "bg-[#0e0a1c]/60 border-violet-950/25" : "bg-stone-100 border-stone-200"} flex flex-wrap items-center gap-1 select-none shrink-0 font-mono text-[11px]`}>
          {[
            ["pending_review", "در انتظار بررسی", pendingReviewNovels.length, "bg-orange-600"],
            ["rejected_changes", "ردشده؛ در انتظار اصلاح", rejectedAwaitingChanges.length, "bg-rose-600"],
            ["approved_by_me", "تأییدشده توسط من", approvedByMeNovels.length, "bg-emerald-600"],
            ["overdue", "بررسی‌های عقب‌افتاده", overdueNovels.length, "bg-amber-700"],
            ["assigned", "واگذارشده به من", assignedNovels.length, "bg-purple-600"],
            ["tickets", "تیکت‌های پشتیبانی", openTickets, "bg-fuchsia-700"]
          ].map(([id, label, count, color]: any) => (
            <button
              key={id}
              onClick={() => { setActiveSegment(id); setSelectedNovel(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                activeSegment === id ? `${color} text-white shadow-sm` : "text-slate-450 hover:text-slate-100"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{label} ({count})</span>
            </button>
          ))}
        </div>
      </div>

      {activeSegment !== "assigned" && activeSegment !== "tickets" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleNovels.map((novel) => (
            <div key={novel.id} className={`p-5 rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex flex-col justify-between gap-4 text-left ${activeTheme.shadow}`}>
              <div className="flex gap-4">
                <SafeImage src={novel.cover_url} alt={novel.title} className="w-16 h-24 rounded-lg object-cover bg-slate-900 shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase ${novel.approval_status === 'rejected' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                    {novel.approval_status === "pending" ? "در انتظار تأیید" : novel.approval_status === "approved" ? "تأییدشده" : novel.approval_status === "rejected" ? "ردشده" : novel.approval_status}
                  </span>
                  <h3 className="font-extrabold text-base truncate pt-1">{novel.title}</h3>
                  <p className="text-xs text-slate-500">نویسنده: {novel.author}</p>
                  <p className="text-[10px] text-slate-500">
                    فصل‌ها: ارسال‌شده {novel.editorial_counts?.submitted || 0} | نیازمند اصلاح {novel.editorial_counts?.needs_changes || 0} | تأییدشده {novel.editorial_counts?.approved || 0}
                  </p>
                  {novel.review_due_at && <p className="text-[10px] text-amber-500">مهلت بررسی: {new Date(novel.review_due_at).toLocaleString("fa-IR")}</p>}
                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed pt-1">{novel.description}</p>
                </div>
              </div>
              <div className="flex gap-3 pt-3 border-t border-slate-700/10 dark:border-violet-950/15">
                <button
                  onClick={() => { setApprovingId(novel.id); setRejectReason("عالی بود؛ برای نمایش عمومی تأیید شد!"); }}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white rounded-xl text-xs font-black font-mono uppercase tracking-wider transition-all"
                >
                  تأیید
                </button>
                <button
                  onClick={() => { setRejectingId(novel.id); setRejectReason(novel.editor_note || "لطفاً خلاصه داستان را بهبود دهید."); }}
                  className="px-4 py-2 border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-450 rounded-xl text-xs font-black font-mono uppercase tracking-wider transition-all"
                >
                  رد با یادداشت
                </button>
                {editorStaff.length > 0 && (userRole === "owner" || userRole === "publisher") && (
                  <button
                    onClick={() => assignNovel(novel)}
                    className="px-4 py-2 border border-purple-500/20 bg-purple-500/10 text-purple-300 rounded-xl text-xs font-black font-mono uppercase tracking-wider transition-all"
                  >
                    واگذاری
                  </button>
                )}
              </div>
            </div>
          ))}
          {visibleNovels.length === 0 && (
            <div className="col-span-2 text-center p-12 bg-slate-500/5 border border-dashed rounded-2xl">
              <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto opacity-40 mb-3" />
              <h3 className="font-bold text-sm">موردی برای بررسی وجود ندارد</h3>
            </div>
          )}
        </div>
      )}

      {activeSegment === "tickets" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 xl:gap-6 items-start min-h-[520px]">
          <div className={`lg:col-span-4 p-4 rounded-2xl border flex flex-col min-h-[320px] ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                <LifeBuoy className="w-4 h-4 text-fuchsia-400" />
                <span>تیکت‌های پشتیبانی</span>
              </h2>
              <button onClick={loadTickets} className="px-2 py-1 rounded bg-slate-800 text-white text-[10px] font-bold">به‌روزرسانی</button>
            </div>
            <div className="flex-grow overflow-y-auto space-y-2 pr-1">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => selectTicket(ticket)}
                  className={`w-full p-3 text-left rounded-xl border cursor-pointer transition-all ${
                    selectedTicket?.id === ticket.id
                      ? "bg-fuchsia-500/10 border-fuchsia-500"
                      : isDark ? "bg-black/40 border-slate-800 hover:border-fuchsia-500" : "bg-stone-50 border-stone-200 hover:border-fuchsia-500"
                  }`}
                >
                  <h4 className="font-bold text-[11px] line-clamp-1">{ticket.title}</h4>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-[9px] text-slate-500">{ticket.created_at ? new Date(ticket.created_at).toLocaleDateString("fa-IR") : "بدون تاریخ"}</p>
                    <span className={`px-1.5 py-[1px] rounded text-[8px] font-bold font-mono ${
                      ticket.status === "OPEN" ? "bg-amber-500/20 text-amber-500 border border-amber-500/30" :
                      ticket.status === "CLOSED" ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30" :
                      "bg-violet-500/20 text-violet-500 border border-violet-500/30"
                    }`}>
                        {ticket.status === "OPEN" ? "باز" : ticket.status === "PENDING" ? "در انتظار" : ticket.status === "CLOSED" ? "بسته" : ticket.status || "OPEN"}
                    </span>
                  </div>
                </button>
              ))}
              {tickets.length === 0 && <p className="text-xs text-slate-500 text-center py-8">هنوز تیکتی ثبت نشده است.</p>}
            </div>
          </div>

          <div className={`lg:col-span-8 p-4 rounded-2xl border flex flex-col min-h-[420px] ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
            {selectedTicket ? (
              <>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 pb-3 border-b border-slate-800/10 dark:border-violet-950/20 mb-3 text-left">
                  <div>
                    <h3 className="font-bold text-sm">{selectedTicket.title}</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">شناسه تیکت: {selectedTicket.id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    {["OPEN", "PENDING", "CLOSED"].map((status) => (
                      <button key={status} onClick={() => changeTicketStatus(status)} className="px-2 py-1 rounded bg-slate-800 text-white hover:bg-fuchsia-700 transition">
                        {status === "OPEN" ? "باز" : status === "PENDING" ? "در انتظار" : "بسته"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-grow overflow-y-auto space-y-4 pr-2 mb-3">
                  {ticketMessages.map((message) => (
                    <div key={message.id} className={`flex ${message.is_admin ? "justify-end" : "justify-start"}`}>
                      <div className={`p-3 max-w-[80%] rounded-2xl text-xs text-left shadow-xs ${
                        message.is_admin
                          ? "bg-fuchsia-700 text-white rounded-tr-none"
                          : isDark
                            ? "bg-[#0e0a1c] border border-violet-950 text-slate-300 rounded-tl-none"
                            : "bg-stone-50 border border-stone-200 text-stone-800 rounded-tl-none"
                      }`}>
                        <div className="font-bold mb-1 opacity-75 text-[9px] uppercase tracking-wider font-mono">
                          {message.is_admin ? message.sender || "کارمند" : message.sender || "کاربر"}
                        </div>
                        <div className="leading-relaxed whitespace-pre-wrap">{message.content}</div>
                      </div>
                    </div>
                  ))}
                  {ticketMessages.length === 0 && <p className="text-xs text-slate-500 text-center py-10">برای نمایش پیام‌ها، یک تیکت را انتخاب کنید.</p>}
                </div>

                <form onSubmit={sendTicketReply} className="flex gap-2 shrink-0">
                  <textarea
                    rows={2}
                    placeholder="پاسخی به این تیکت پشتیبانی بنویسید..."
                    value={ticketReply}
                    onChange={(e) => setTicketReply(e.target.value)}
                    className={`flex-grow px-3 py-2 text-xs rounded-xl focus:outline-none border resize-none ${
                      isDark ? "bg-black border-slate-800 text-white focus:border-fuchsia-500" : "bg-stone-50 border-stone-200 focus:border-fuchsia-500"
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={!ticketReply.trim()}
                    className="px-4 bg-fuchsia-700 hover:bg-fuchsia-600 text-white rounded-xl cursor-pointer shrink-0 font-bold text-[10px] uppercase font-mono transition-all disabled:opacity-50"
                  >
                    پاسخ
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
                <LifeBuoy className="w-8 h-8 opacity-40" />
                <p className="text-xs">برای مشاهده گفتگو، یک تیکت انتخاب کنید.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeSegment === "assigned" && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="lg:w-1/3 space-y-3">
            <h2 className="text-sm font-bold tracking-tight px-1">رمان‌های واگذارشده</h2>
            {(userRole === "owner" || userRole === "publisher") && editorStaff.length > 0 && (
              <div className={`p-3 rounded-xl border text-left space-y-2 ${activeTheme.border} ${activeTheme.card}`}>
                <div className="text-[10px] font-bold uppercase text-slate-500">ابزارهای واگذاری</div>
                <select value={assignEditorId} onChange={(e) => setAssignEditorId(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs">
                  {editorStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.nickname || staff.username} ({staff.role === "writer" ? "نویسنده" : staff.role === "editor" ? "ویراستار" : staff.role === "publisher" ? "ناشر" : staff.role === "owner" ? "مالک" : staff.role})</option>)}
                </select>
                <input value={assignDueAt} onChange={(e) => setAssignDueAt(e.target.value)} type="datetime-local" className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs" />
                <button onClick={assignSelectedChapters} className="w-full px-3 py-2 rounded bg-purple-600 text-white text-[10px] font-bold">واگذاری فصل‌های انتخاب‌شده</button>
              </div>
            )}
            {assignedNovels.map(novel => (
              <div 
                key={novel.id} 
                onClick={() => loadAssignedNovelDetails(novel)}
                className={`p-3 text-left rounded-xl border cursor-pointer transition-all flex gap-3 ${
                  selectedNovel?.id === novel.id ? "bg-purple-500/10 border-purple-500" : (isDark ? "bg-black/40 border-slate-800" : "bg-stone-50 border-stone-200")
                }`}
              >
                <SafeImage src={novel.cover_url} alt={novel.title} className="w-10 h-14 rounded object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-xs line-clamp-1">{novel.title}</h4>
                  <p className="text-[10px] text-slate-500">نویسنده: {novel.author}</p>
                </div>
              </div>
            ))}
            {assignedNovels.length === 0 && <p className="text-xs text-slate-500">هنوز رمانی واگذار نشده است.</p>}
          </div>

          <div className="lg:w-2/3">
            {selectedNovel ? (
              <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
                <h3 className="font-bold text-lg text-left mb-4">{selectedNovel.title} <span className="text-xs text-slate-500 font-mono">- بازبینی فصل‌ها</span></h3>
                
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    ["approve", "تأیید"],
                    ["needs_changes", "نیازمند اصلاح"],
                    ["quarantine", "قرنطینه"],
                    ["delete", "حذف"]
                  ].map(([action, label]) => (
                    <button key={action} onClick={() => applyBulkAction(action)} className="px-3 py-1.5 rounded bg-slate-800 text-white text-[10px] font-bold">
                      {label} موارد انتخاب‌شده
                    </button>
                  ))}
                </div>

                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 mb-4">
                  {chapters.map(chap => (
                    <div key={chap.id} className="p-3 bg-black/10 border border-slate-800/10 dark:border-slate-800 rounded-xl text-left flex gap-3 flex-col">
                      <div className="flex justify-between items-center">
                        <label className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedChapterIds.includes(chap.id)}
                            onChange={(e) => setSelectedChapterIds(e.target.checked ? [...selectedChapterIds, chap.id] : selectedChapterIds.filter(id => id !== chap.id))}
                          />
                          {/* Manga chapters are measured in pages, prose in words. */}
                          <span className="font-bold text-xs truncate">
                            {chap.title} ({Number(chap.page_count || 0) > 0
                              ? `${Number(chap.page_count).toLocaleString("fa-IR")} صفحه`
                              : `${chap.word_count} واژه`})
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px] font-bold uppercase">
                            {(() => { const st = chap.editorial_status || chap.editorialStatus || chap.status || "draft"; return st === "draft" ? "پیش‌نویس" : st === "submitted" ? "ارسال‌شده" : st === "needs_changes" ? "نیازمند اصلاح" : st === "approved" ? "تأییدشده" : st === "scheduled" ? "زمان‌بندی‌شده" : st === "published" ? "منتشرشده" : st; })()}
                          </span>
                          {chap.review_due_at && <span className="text-[9px] text-amber-400">مهلت: {new Date(chap.review_due_at).toLocaleString("fa-IR")}</span>}
                        </label>
                        <div className="flex items-center gap-2">
                           <button onClick={() => openReviewTools(chap)} className="p-1 text-purple-400 hover:bg-purple-500/10 rounded" title="باز کردن ابزارهای بررسی"><Edit className="w-4 h-4" /></button>
                           <button onClick={() => deleteChapter(chap.id)} className="p-1 text-rose-500 hover:bg-rose-500/10 rounded"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <textarea
                        className="w-full bg-black/20 border border-slate-800/30 rounded p-2 text-[10px] text-slate-300 focus:outline-none focus:border-purple-500"
                        placeholder="یادداشتی ویراستاری برای این فصل بنویسید..."
                        defaultValue={chap.editor_note}
                        onBlur={(e) => saveChapterNote(chap.id, e.target.value)}
                      />
                      <div className="flex flex-wrap gap-1">
                        {[
                          ["draft", "پیش‌نویس"],
                          ["submitted", "ارسال‌شده"],
                          ["needs_changes", "نیازمند اصلاح"],
                          ["approved", "تأییدشده"],
                          ["scheduled", "زمان‌بندی‌شده"],
                          ["published", "منتشرشده"]
                        ].map(([status, label]) => (
                          <button
                            key={status}
                            onClick={() => setChapterStatus(chap, status)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-purple-700 text-white text-[9px] font-bold"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {chapters.length === 0 && <p className="text-xs text-slate-500 text-center py-4">در حال حاضر فصلی برای بررسی موجود نیست.</p>}
                </div>

                {selectedReviewChapter && (
                  <div className="border-t border-slate-800/30 pt-4 mt-4 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm">ابزارهای بررسی: {selectedReviewChapter.title}</h4>
                        <p className="text-[10px] text-slate-500">دیدگاه‌های درون‌متنی، مقایسه نسخه‌ها، چک‌لیست، بررسی گفتگویی و اسکن هوش مصنوعی/سرقت ادبی.</p>
                      </div>
                      <button onClick={scanSelectedChapter} className="px-3 py-2 rounded bg-amber-600 text-white text-[10px] font-bold">بررسی هوش مصنوعی / سرقت ادبی</button>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl border border-slate-800/30 space-y-2">
                        <div className="text-xs font-bold">چک‌لیست محتوا</div>
                        {checklistLabels.map(([key, label]) => (
                          <label key={key} className="flex items-center justify-between gap-2 text-xs">
                            <span>{label}</span>
                            <input
                              type="checkbox"
                              checked={!!reviewTools?.checklist?.checklist?.[key]}
                              onChange={(e) => toggleChecklist(key, e.target.checked)}
                            />
                          </label>
                        ))}
                      </div>

                      <div className="p-3 rounded-xl border border-slate-800/30 space-y-2">
                        <div className="text-xs font-bold">مقایسه نسخه‌ها</div>
                        {reviewTools?.latestDiff ? (
                          <>
                            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                              <div><b>{reviewTools.latestDiff.beforeWords}</b><br />قبل</div>
                              <div><b>{reviewTools.latestDiff.afterWords}</b><br />بعد</div>
                              <div><b>{reviewTools.latestDiff.deltaWords}</b><br />اختلاف</div>
                            </div>
                            <div className="text-[10px] text-emerald-400 line-clamp-3">افزوده‌شده: {(reviewTools.latestDiff.added || []).slice(0, 20).join(" ")}</div>
                            <div className="text-[10px] text-rose-400 line-clamp-3">حذف‌شده: {(reviewTools.latestDiff.removed || []).slice(0, 20).join(" ")}</div>
                          </>
                        ) : <div className="text-xs text-slate-500">نسخه قبلی یافت نشد.</div>}
                      </div>

                      <div className="p-3 rounded-xl border border-slate-800/30 space-y-2">
                        <div className="text-xs font-bold">آخرین اسکن‌ها</div>
                        {(reviewTools?.scans || []).slice(0, 4).map((scan: any) => (
                          <div key={scan.id} className="text-[10px] p-2 rounded bg-black/20">
                            <div className="font-bold">ریسک {scan.risk_score}% | هوش مصنوعی {scan.ai_score}% | تکراری‌بودن {scan.plagiarism_score}%</div>
                            <div>الفاظ رکیک {scan.profanity_score || 0}% | ناهماهنگی هشدارها {scan.warning_mismatch_score || 0}% | کیفیت {scan.quality_score ?? 100}%</div>
                            <div className="text-slate-500">{(scan.flags || []).join(", ") || "بدون نشان"}</div>
                          </div>
                        ))}
                        {(!reviewTools?.scans || reviewTools.scans.length === 0) && <div className="text-xs text-slate-500">هنوز اسکنی انجام نشده است.</div>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl border border-slate-800/30 space-y-2">
                        <div className="text-xs font-bold">دیدگاه‌های درون‌متنی</div>
                        {/* A manga chapter has no prose to anchor a comment in, so
                            moderators review its pages in the same viewer readers
                            get; the anchor is then written by hand (for example
                            "صفحهٔ ۴"). */}
                        {reviewMangaPages ? (
                          <div className="overflow-hidden rounded border border-slate-800/30">
                            <MangaReader
                              pages={reviewMangaPages}
                              chapterTitle={selectedReviewChapter.title || "فصل"}
                              chapterNumber={Number(selectedReviewChapter.chapter_number || selectedReviewChapter.chapterNumber || 1)}
                              novelTitle={selectedNovel?.title || ""}
                              readingDirection={normalizeReadingDirection(reviewTools?.readingDirection)}
                              theme={theme}
                            />
                          </div>
                        ) : (
                          <div
                            onMouseUp={useSelectedTextAsAnchor}
                            className="max-h-40 overflow-y-auto rounded bg-black/20 border border-slate-800/30 p-3 text-[11px] leading-relaxed text-slate-300 prose prose-invert prose-sm"
                            dangerouslySetInnerHTML={{ __html: sanitizeEditorHtml(selectedReviewChapter.content || reviewTools?.chapter?.content || "") }}
                          />
                        )}
                        {!reviewMangaPages && (
                          <button onClick={useSelectedTextAsAnchor} className="px-2 py-1 rounded bg-slate-800 text-white text-[10px]">استفاده از متن انتخاب‌شده</button>
                        )}
                        <input value={inlineAnchor} onChange={(e) => setInlineAnchor(e.target.value)} className="w-full bg-black/20 border border-slate-800/30 rounded p-2 text-xs" placeholder="متن لنگر از فصل..." />
                        <textarea value={inlineComment} onChange={(e) => setInlineComment(e.target.value)} className="w-full bg-black/20 border border-slate-800/30 rounded p-2 text-xs" placeholder="دیدگاهی درباره این قطعه بنویسید..." />
                        <button onClick={addInlineComment} className="px-3 py-2 rounded bg-purple-600 text-white text-[10px] font-bold">افزودن دیدگاه درون‌متنی</button>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {(reviewTools?.inlineComments || []).map((comment: any) => (
                            <div key={comment.id} className="p-2 rounded bg-black/20 text-[11px]">
                              <div className="font-bold">{comment.anchor_text || "یادداشت کلی"} <span className="text-slate-500">({comment.status})</span></div>
                              <div>{comment.comment}</div>
                              {comment.status !== "resolved" && (
                                <button onClick={async () => { const token = api.getToken(); if (!token) return; await api.updateEditorInlineComment(token, comment.id, "resolved"); openReviewTools(selectedReviewChapter); }} className="mt-1 text-[10px] text-emerald-400">حل شد</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl border border-slate-800/30 space-y-2">
                        <div className="text-xs font-bold">گفتگوی موضوعی</div>
                        <input value={threadSubject} onChange={(e) => setThreadSubject(e.target.value)} className="w-full bg-black/20 border border-slate-800/30 rounded p-2 text-xs" placeholder="موضوع گفتگو..." />
                        <textarea value={threadContent} onChange={(e) => setThreadContent(e.target.value)} className="w-full bg-black/20 border border-slate-800/30 rounded p-2 text-xs" placeholder="پیام نخست..." />
                        <button onClick={createThread} className="px-3 py-2 rounded bg-violet-600 text-white text-[10px] font-bold">ایجاد گفتگو</button>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {(reviewTools?.threads || []).map((thread: any) => (
                              <button key={thread.id} onClick={() => loadThread(thread)} className={`w-full text-left p-2 rounded text-[11px] ${selectedThread?.id === thread.id ? "bg-violet-600/30" : "bg-black/20"}`}>{thread.subject}</button>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <div className="max-h-32 overflow-y-auto space-y-1">
                              {threadMessages.map((message: any) => (
                                <div key={message.id} className="p-2 rounded bg-black/20 text-[10px]">{message.username || "ویراستار"}: {message.content}</div>
                              ))}
                            </div>
                            {selectedThread && (
                              <div className="flex gap-1">
                                <input value={threadReply} onChange={(e) => setThreadReply(e.target.value)} className="flex-1 bg-black/20 border border-slate-800/30 rounded p-2 text-xs" placeholder="پاسخ..." />
                                <button onClick={sendThreadReply} className="px-2 rounded bg-violet-600 text-white text-[10px]">ارسال</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-800/30 pt-4 mt-6">
                  <h4 className="font-bold text-sm tracking-tight mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4"/> ارتباط مستقیم با نویسنده</h4>
                  <div className="space-y-2 mb-3 max-h-[200px] overflow-y-auto px-1 text-left">
                    {messages.map(msg => (
                      <div key={msg.id} className={`p-2 rounded-lg text-xs w-max max-w-[80%] ${msg.is_editor ? 'bg-purple-600/20 text-purple-200 ml-auto' : 'bg-slate-800'} whitespace-pre-wrap`}>
                         <div className="font-bold text-[9px] mb-0.5 opacity-70">{msg.is_editor ? "شما (ویراستار)" : selectedNovel.author}</div>
                         {msg.content}
                      </div>
                    ))}
                  </div>
                  <form onSubmit={sendMessage} className="flex gap-2">
                    <input 
                      type="text" 
                      value={newMessage} 
                      onChange={e => setNewMessage(e.target.value)} 
                      placeholder="یادداشت خصوصی یا درخواست ویرایشی برای نویسنده بفرستید..." 
                      className={`flex-1 p-2 rounded-xl border text-xs focus:outline-none ${isDark ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                    />
                    <button type="submit" className="px-4 bg-purple-600 hover:bg-purple-500 rounded-xl text-white font-bold text-xs transition">ارسال</button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center opacity-40"><PenTool className="w-12 h-12" /></div>
            )}
          </div>
        </div>
      )}

      {/* Editor Modal for Approve/Reject reason */}
      {(approvingId || rejectingId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0b0716] border border-violet-950 text-white rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl relative z-10 text-left">
            <h3 className="text-base font-bold font-sans flex items-center gap-2">
              <span>{approvingId ? "تأیید رمان" : "رد رمان"}</span>
            </h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full p-3 h-24 text-xs bg-black border border-violet-900/40 rounded-xl text-white focus:outline-none font-mono"
              placeholder="یادداشتی برای نویسنده بنویسید..."
            />
            <div className="flex gap-2 justify-end pt-2 text-[11px] font-mono">
              <button
                onClick={() => { setApprovingId(null); setRejectingId(null); }}
                className="px-4 py-2 border border-slate-700/30 text-slate-450 hover:text-white rounded-xl transition"
              >
                انصراف
              </button>
              <button
                onClick={approvingId ? handleApprove : handleReject}
                className={`px-4 py-2 text-white font-bold rounded-xl transition ${approvingId ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"}`}
              >
                تأیید
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { HelpCircle, ChevronDown, ChevronUp, Send, CheckCircle, ShieldAlert, BookOpen, Clock, AlertCircle } from "lucide-react";
import { api } from "../utils/api";
import { SupportTicket, SupportMessage } from "../types";

interface SupportProps {
  theme: "light" | "dark";
  currentUser?: any;
  systemSettings?: any;
  /** Pre-selects the ticket category, e.g. the VIP purchase flow. */
  initialIssue?: string;
}

export default function Support({ theme, currentUser, systemSettings, initialIssue }: SupportProps) {
  // ✅ NEW: Support ticket form with all fields
  const [ticketState, setTicketState] = useState({ 
    name: currentUser?.nickname || currentUser?.username || "", 
    email: currentUser?.email || "", 
    phone: currentUser?.phone || "",
    issue: initialIssue || "General Feedback", 
    priority: initialIssue ? "high" : "normal",
    body: "" 
  });
  const [ticketSubmitted, setTicketSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState("");
  
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [closingTicket, setClosingTicket] = useState(false);

  useEffect(() => {
    if (currentUser) {
      loadTickets();
    }
  }, [currentUser]);

  useEffect(() => {
    if (selectedTicketId) {
      loadMessages(selectedTicketId);
    }
  }, [selectedTicketId]);

  const loadTickets = async () => {
    const token = api.getToken();
    if (token) {
      try {
        setTickets(await api.getTickets(token));
      } catch (err: any) {
        setTicketError(err?.message || "خطا در بارگذاری تیکت‌ها.");
      }
    }
  };

  const loadMessages = async (id: string) => {
    const token = api.getToken();
    if (token) {
      try {
        setMessages(await api.getTicketMessages(token, id));
        setReplyError("");
      } catch (err: any) {
        setReplyError(err?.message || "خطا در بارگذاری پیام‌های تیکت.");
      }
    }
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setTicketError("");
    const token = api.getToken();
    if (token) {
      try {
      const title = `[${ticketState.issue}] ${ticketState.body.substring(0, 30)}...`;
      // ✅ NEW: Pass all fields to API
      await api.createTicket(token, title, ticketState.body, ticketState.issue, {
        name: ticketState.name,
        email: ticketState.email,
        phone: ticketState.phone,
        priority: ticketState.priority
      });
      setTicketSubmitted(true);
      setTicketState({ 
        name: currentUser?.nickname || currentUser?.username || "", 
        email: currentUser?.email || "", 
        phone: currentUser?.phone || "",
        issue: "General Feedback", 
        priority: "normal",
        body: "" 
      });
      await loadTickets();
      setTimeout(() => {
        setTicketSubmitted(false);
      }, 4000);
      } catch (err: any) {
        setTicketError(err?.message || "تیکت ایجاد نشد. لطفاً دوباره تلاش کنید.");
      } finally {
        setSubmitting(false);
      }
    } else {
      setTicketError("لطفاً پیش از ثبت تیکت پشتیبانی، وارد حساب خود شوید.");
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedTicketId) return;
    
    const token = api.getToken();
    if (token) {
      try {
        await api.sendTicketMessage(token, selectedTicketId, replyText);
        setReplyText("");
        await loadMessages(selectedTicketId);
        await loadTickets();
      } catch (err: any) {
        setReplyError(err?.message || "خطا در ارسال پاسخ تیکت.");
      }
    }
  };

  const handleCloseTicket = async () => {
    if (!selectedTicketId || closingTicket || !confirm("این تیکت پشتیبانی بسته شود؟")) return;
    const token = api.getToken();
    if (!token) return;
    setClosingTicket(true);
    setReplyError("");
    try {
      await api.updateTicketStatus(token, selectedTicketId, "CLOSED");
      setTickets((items) => items.map((ticket) => ticket.id === selectedTicketId ? { ...ticket, status: "CLOSED" } : ticket));
    } catch (err: any) {
      setReplyError(err?.message || "تیکت بسته نشد.");
    } finally {
      setClosingTicket(false);
    }
  };

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);

  return (
    <div className="space-y-8 pb-16">
      {/* Hero Header */}
      <section className={`p-8 md:p-10 rounded-3xl border ${
        theme === "dark" 
          ? "bg-gradient-to-br from-black via-[#04081c] to-purple-950/20 border-violet-900/40 shadow-[0_0_15px_rgba(139,92,246,0.1)]" 
          : "bg-gradient-to-br from-purple-50/30 to-white border-[#E7DEC8] shadow-sm"
      }`}>
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border border-violet-500/20 bg-violet-500/10 text-violet-400">
            <HelpCircle className="w-3.5 h-3.5 text-violet-400" />
            <span>سامانه پشتیبانی</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">اقامتگاه پشتیبانی</h1>
          <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-2xl">
            اگر به کمک نیاز دارید، تیم پشتیبانی ما آماده پاسخگویی به شماست.
          </p>
        </div>
      </section>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Left Hand: Support Form */}
        <div className="space-y-6">
          {/* Ticket Request form */}
          <div className={`p-6 rounded-2xl border ${
            theme === "dark" ? "bg-[#0b0716] border-violet-950/40" : "bg-white border-[#E7DEC8]"
          } space-y-4`}>
            <h3 className="font-extrabold text-sm flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <span>ثبت تیکت پشتیبانی</span>
            </h3>

            {ticketSubmitted ? (
              <div className="p-6 text-center space-y-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
                <CheckCircle className="w-8 h-8 mx-auto text-emerald-500" />
                <h4 className="font-bold">تیکت شما با موفقیت ثبت شد</h4>
                <p className="text-xs">درخواست شما در صف بررسی قرار گرفت. می‌توانید آن را در فهرست تیکت‌های فعال ببینید.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitTicket} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase text-slate-500 font-bold">نام شما</label>
                    <input
                      required
                      type="text"
                      className={`w-full p-2 rounded-lg border focus:outline-none ${theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                      value={ticketState.name}
                      onChange={e => setTicketState({...ticketState, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase text-slate-500 font-bold">نشانی ایمیل</label>
                    <input
                      required
                      type="email"
                      className={`w-full p-2 rounded-lg border focus:outline-none ${theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                      value={ticketState.email}
                      onChange={e => setTicketState({...ticketState, email: e.target.value})}
                    />
                  </div>
                </div>

                {/* ✅ NEW: Phone field */}
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase text-slate-500 font-bold">شماره تماس (اختیاری)</label>
                  <input
                    type="tel"
                    className={`w-full p-2 rounded-lg border focus:outline-none ${theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                    value={ticketState.phone}
                    onChange={e => setTicketState({...ticketState, phone: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase text-slate-500 font-bold">دسته‌بندی</label>
                    <select
                      className={`w-full p-2 rounded-lg border focus:outline-none ${theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                      value={ticketState.issue}
                      onChange={e => setTicketState({...ticketState, issue: e.target.value})}
                    >
                      <option value="General Feedback">بازخورد عمومی</option>
                      <option value="Subscription Error">خطای اشتراک و سکه‌ها</option>
                      <option value="Author Tools Failure">خرابی ابزار نویسندگان</option>
                      <option value="Typography Rendering Bug">ایراد نمایش تایپوگرافی</option>
                      <option value="VIP Purchase">خرید VIP</option>
                    </select>
                  </div>
                  {/* ✅ NEW: Priority field */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono uppercase text-slate-500 font-bold">اولویت</label>
                    <select
                      className={`w-full p-2 rounded-lg border focus:outline-none ${theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                      value={ticketState.priority}
                      onChange={e => setTicketState({...ticketState, priority: e.target.value})}
                    >
                      <option value="low">کم</option>
                      <option value="normal">معمولی</option>
                      <option value="high">بالا</option>
                      <option value="urgent">فوری</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase text-slate-500 font-bold">شرح مشکل</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="جزئیاتی که به بررسی مشکل کمک می‌کند را بنویسید..."
                    className={`w-full p-2 rounded-lg border focus:outline-none ${theme === "dark" ? "bg-black border-slate-800 text-white" : "bg-stone-50 border-stone-200"}`}
                    value={ticketState.body}
                    onChange={e => setTicketState({...ticketState, body: e.target.value})}
                  />
                </div>

                {ticketError && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{ticketError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2 rounded-lg bg-violet-500 hover:bg-violet-600 font-bold font-mono uppercase text-[10px] tracking-wider text-white disabled:opacity-50"
                >
                  {submitting ? "در حال ارسال..." : "ثبت تیکت"}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Right Hand: Active Tickets */}
        <div className={`p-6 rounded-2xl border flex flex-col h-[650px] ${
          theme === "dark" ? "bg-[#0b0716] border-violet-900/30" : "bg-white border-[#E7DEC8]"
        }`}>
          <div className="space-y-2 pb-4 border-b border-slate-850">
            <h3 className="font-extrabold text-sm flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-400" />
                <span>تیکت‌های فعال شما</span>
              </div>
              {selectedTicketId && (
                <button 
                  onClick={() => setSelectedTicketId(null)}
                  className="text-[10px] text-violet-500 hover:underline"
                >
                  بازگشت به فهرست
                </button>
              )}
            </h3>
          </div>

          <div className="flex-grow my-4 overflow-y-auto space-y-3 pr-2 border-slate-850">
            {!selectedTicketId ? (
              tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
                  <CheckCircle className="w-8 h-8 opacity-50" />
                  <p className="text-xs font-medium">هیچ تیکت پشتیبانی فعالی ندارید.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tickets.map(ticket => (
                    <div 
                      key={ticket.id} 
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        theme === "dark" ? "bg-black/40 border-slate-800 hover:border-violet-500" : "bg-stone-50 border-stone-200 hover:border-violet-500"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 flex-1">
                          <h4 className="font-bold text-xs line-clamp-1">{ticket.title}</h4>
                          <p className="text-[10px] text-slate-500">شناسه: {ticket.id} • {new Date(ticket.created_at).toLocaleDateString('fa-IR')}</p>
                        </div>
                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono flex-shrink-0 ${
                          ticket.status === 'OPEN' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 
                          ticket.status === 'CLOSED' ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30' :
                          'bg-violet-500/20 text-violet-500 border border-violet-500/30'
                        }`}>
                          {ticket.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="flex flex-col h-full">
                <div className="mb-4">
                  <h4 className="font-bold text-sm">{selectedTicket?.title}</h4>
                  <div className={`mt-2 px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-block ${
                    selectedTicket?.status === 'OPEN' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 
                    selectedTicket?.status === 'CLOSED' ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30' :
                    'bg-violet-500/20 text-violet-500 border border-violet-500/30'
                  }`}>
                    {selectedTicket?.status}
                  </div>
                  {selectedTicket?.status !== 'CLOSED' && (
                    <button type="button" onClick={handleCloseTicket} disabled={closingTicket} className="ml-2 px-3 py-1 rounded-lg border border-rose-500/30 text-[10px] font-bold text-rose-500 hover:bg-rose-500 hover:text-white disabled:opacity-50">
                      {closingTicket ? "در حال بستن..." : "بستن تیکت"}
                    </button>
                  )}
                </div>

                <div className="flex-grow overflow-y-auto space-y-4 pr-2 mb-4">
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.is_admin ? "justify-start" : "justify-end"}`}>
                      <div className={`p-3 max-w-[85%] rounded-2xl text-xs shadow-xs ${
                        msg.is_admin 
                          ? theme === "dark" 
                            ? "bg-[#0c102c] border border-purple-950/50 text-slate-200 rounded-tl-none" 
                            : "bg-white border border-stone-200 text-stone-800 rounded-tl-none"
                          : "bg-violet-600 text-white rounded-tr-none"
                      }`}>
                        <div className="font-bold mb-1 opacity-75 text-[10px]">
                          {msg.is_admin ? "پشتیبانی" : "شما"} • {new Date(msg.created_at).toLocaleDateString('fa-IR')}
                        </div>
                        <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {replyError && <p className="mb-2 text-[11px] text-rose-500">{replyError}</p>}
                {selectedTicket?.status !== 'CLOSED' ? (
                  <form onSubmit={handleSendReply} className="flex gap-2 shrink-0">
                    <input
                      type="text"
                      placeholder="پاسخ خود را بنویسید..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      className={`flex-grow px-3 py-2 text-xs rounded-xl focus:outline-none border ${
                        theme === "dark" ? "bg-black border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 focus:border-amber-500"
                      }`}
                    />
                    <button
                      type="submit"
                      disabled={!replyText.trim()}
                      className="p-2 bg-violet-500 hover:bg-violet-600 text-white rounded-xl cursor-pointer shrink-0 transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                ) : (
                  <div className="text-center p-3 text-xs text-slate-500 bg-slate-100 dark:bg-slate-800/40 rounded-xl">
                    <AlertCircle className="w-4 h-4 mx-auto mb-1 opacity-60" />
                    این تیکت بسته شده است.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { Novel, Review } from "../types";
import { CONTRAST_THEMES } from "../data";
import { X, Users, BookOpen, Star, Sparkles, Eye, Award, MessageSquare, CheckCircle, ExternalLink, Youtube, Instagram, Music2, Heart, AtSign, Pencil } from "lucide-react";
import { motion } from "motion/react";
import { api } from "../utils/api";
import { getSocket } from "../utils/socket";
import ReportButton from "./ReportButton";
import SafeImage from "./SafeImage";

interface AuthorProfileProps {
  authorName: string;
  novels: Novel[];
  onBack: () => void;
  onSelectNovel: (novel: Novel) => void;
  followersList: any[];
  onToggleFollow: (id: string, state: boolean, username?: string) => Promise<any> | void;
  theme: "light" | "dark";
  currentUser?: { id: string; username: string } | null;
}

type AuthorLink = { id: string; platform: string; label: string; url: string; position?: number };

const AUTHOR_LINK_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  patreon: { icon: Heart, color: "border-orange-500/30 bg-orange-500/10 text-orange-500 dark:text-orange-300" },
  youtube: { icon: Youtube, color: "border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-300" },
  tiktok: { icon: Music2, color: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300" },
  x: { icon: AtSign, color: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-200" },
  instagram: { icon: Instagram, color: "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-300" }
};

function getSafeAvatarUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("<") || /<\/?[a-z][\s\S]*>/i.test(raw)) return null;
  if (raw.startsWith("/uploads/avatars/") || raw.startsWith("/api/upload/avatar/")) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(parsed.pathname + parsed.search)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export default function AuthorProfile({
  authorName,
  novels,
  onBack,
  onSelectNovel,
  followersList,
  onToggleFollow,
  theme,
  currentUser
}: AuthorProfileProps) {
  const activeTheme = CONTRAST_THEMES[theme];
  const [authorPosts, setAuthorPosts] = useState<any[]>([]);
  const [publicBookmarkIds, setPublicBookmarkIds] = useState<string[]>([]);
  const [authorInfo, setAuthorInfo] = useState<{ id?: string; verified_author?: boolean; verified_role?: boolean; has_reader_premium?: boolean; has_writer_premium?: boolean; bio?: string; displayName?: string; avatar?: string; username?: string } | null>(null);
  const [authorLinks, setAuthorLinks] = useState<AuthorLink[]>([]);
  
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [editBioValue, setEditBioValue] = useState("");
  const [isSavingBio, setIsSavingBio] = useState(false);

  const [showDMModal, setShowDMModal] = useState(false);
  const [dmSubject, setDmSubject] = useState("");
  const [dmContent, setDmContent] = useState("");
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportAmount, setSupportAmount] = useState(10);
  const [supportMessage, setSupportMessage] = useState("");
  const [supportStatus, setSupportStatus] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState("");

  const handleSendDM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmContent.trim() || !dmSubject.trim()) return;
    const token = api.getToken();
    if (token) {
      await fetch("/api/auth/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        credentials: "same-origin",
        body: JSON.stringify({ to: authorInfo?.username || authorName, subject: dmSubject, snippet: dmContent })
      });
    }
    
    const socket = getSocket();
    if (socket) {
      socket.emit("send_direct_message", {
        to: authorInfo?.username || authorName,
        subject: dmSubject,
        snippet: dmContent,
        id: `dm-${Date.now()}`,
        created_at: "Just now"
      });
    }
    setShowDMModal(false);
    setDmSubject("");
    setDmContent("");
  };

  useEffect(() => {
    const fetchPosts = async () => {
      setAuthorLinks(await api.getAuthorLinks(authorName));
      const publicBookmarks = await api.getPublicBookmarks(authorName);
      setPublicBookmarkIds(publicBookmarks.map((item: any) => String(item.novel_id || "")).filter(Boolean));
      const res = await fetch(`/api/posts/author/${encodeURIComponent(authorName)}`, {
        headers: {},
        credentials: "same-origin"
      });
      if (res.ok) {
        const data = await res.json();
        setAuthorPosts(data.posts || []);
      }

      // Fetch author basic info for verifications
      try {
        const publicRes = await fetch(`/api/forums/user/${encodeURIComponent(authorName)}/verified`);
        if (publicRes.ok) {
          const vData = await publicRes.json();
          setAuthorInfo({
            id: vData.id,
            verified_author: vData.verified_author,
            verified_role: vData.verified_role,
            has_reader_premium: vData.has_reader_premium,
            has_writer_premium: vData.has_writer_premium,
            bio: vData.bio,
            displayName: vData.displayName || vData.nickname || vData.username || authorName,
            avatar: vData.avatar || "",
            username: vData.username || authorName
          });
        }
      } catch (e) {}
    };
    fetchPosts();
  }, [authorName, novels]);

  // Filter novels written by this author
  const authorNovels = novels.filter(
    (novel) => !!authorInfo?.id && String(novel.author_id || "") === String(authorInfo.id)
  );
  const publicBookmarkedNovels = novels.filter((novel) => publicBookmarkIds.includes(novel.id));

  // Calculate statistics
  const totalViews = authorNovels.reduce((sum, n) => sum + (n.viewsCount || 0), 0);
  const totalChapters = authorNovels.reduce((sum, n) => sum + (n.chapters?.length || 0), 0);
  const totalBookmarks = authorNovels.reduce((sum, n) => sum + (n.bookmarksCount || 0), 0);
  
  // Average rating
  const avgRating = authorNovels.length > 0 
    ? (authorNovels.reduce((sum, n) => sum + (n.rating || 0), 0) / authorNovels.length).toFixed(1)
    : "0.0";

  // Check if we are following this author or simulating it
  // Let's check from the followersList or if we have a match, or default
  const isFollowing = followersList.some((profile) =>
    (authorInfo?.id ? String(profile.id || "") === String(authorInfo.id) : false) && profile.followed
  );

  const handleFollowClick = async () => {
    if (!currentUser) {
      setFollowError("Login is required to subscribe.");
      return;
    }
    if (isCurrentUserAuthor || followBusy) return;
    const followerItem = followersList.find((profile) => String(profile.id || "") === String(authorInfo?.id || ""));
    setFollowBusy(true);
    setFollowError("");
    try {
      await onToggleFollow(authorInfo?.id || followerItem?.id || "", !isFollowing, authorInfo?.username || authorName);
    } catch {
      setFollowError("Subscribe action failed. Please try again.");
    } finally {
      setFollowBusy(false);
    }
  };

  const handleSupportAuthor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupportStatus("");
    const result = await api.supportAuthor(authorInfo?.username || authorName, {
      amount: supportAmount,
      message: supportMessage,
      novelId: authorNovels[0]?.id
    });
    if (result?.success) {
      setSupportStatus(`Sent ${supportAmount} stars successfully.`);
      setSupportMessage("");
      setTimeout(() => setShowSupportModal(false), 900);
    } else {
      setSupportStatus(result?.error || "Support could not be completed.");
    }
  };

  const getBio = () => {
    if (authorInfo?.bio) {
      return authorInfo.bio;
    }
    return "This author has not published a profile bio yet.";
  };

  const isCurrentUserAuthor = !!currentUser?.id && String(currentUser.id) === String(authorInfo?.id || "");
  const isVerifiedScribe = !!authorInfo?.verified_author || !!authorInfo?.verified_role;
  const profileDisplayName = authorInfo?.displayName || authorName;
  const profileAvatarUrl = getSafeAvatarUrl(authorInfo?.avatar);

  const handleSaveBio = async () => {
    setIsSavingBio(true);
    const res = await api.updateBio(editBioValue);
    if (res?.success) {
      setAuthorInfo(prev => ({ ...prev, bio: res.bio ?? editBioValue }));
      setIsEditingBio(false);
    } else {
      alert("Failed to update bio");
    }
    setIsSavingBio(false);
  };

  // Comments/Reviews received on their novels
  const commentsReceived = authorNovels.flatMap(n => 
    (n.reviews || []).map(r => ({ ...r, novelTitle: n.title, novelId: n.id }))
  ).sort((a,b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6 pb-16">
      {/* Back Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border ${activeTheme.border} ${activeTheme.card} hover:text-violet-500 cursor-pointer transition-colors ${activeTheme.shadow}`}
        >
          <X className="w-4 h-4" />
          <span>بستن پروفایل نویسنده</span>
        </button>

        <span className="text-[10px] font-mono font-black text-slate-500 tracking-wider">
          CHRONICLER DOSSIER
        </span>
      </div>

      {/* Profile Header Block */}
      <div className={`relative overflow-hidden rounded-3xl border ${activeTheme.border} ${activeTheme.card} p-6 md:p-8 ${activeTheme.shadow}`}>
        {theme === "dark" && (
          <div className="absolute -right-16 -top-16 w-60 h-60 rounded-full bg-violet-500/10 blur-[80px] pointer-events-none" />
        )}

        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6">
          {/* Public profile avatar */}
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-purple-600 font-mono font-black text-white text-3xl flex items-center justify-center shadow-lg border border-white/10 shrink-0 overflow-hidden">
            {profileAvatarUrl ? (
              <SafeImage
                src={profileAvatarUrl}
                alt={profileDisplayName}
                className="w-full h-full object-cover"
              />
            ) : (
              profileDisplayName.slice(0, 2).toUpperCase()
            )}
          </div>

            <div className="flex-1 text-center md:text-left space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-center md:justify-start gap-2.5">
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center justify-center gap-2">
                  {profileDisplayName}
                  {authorInfo?.verified_author && (
                    <span title="نویسنده تأییدشده (رسمی)">
                      <CheckCircle className="w-6 h-6 text-violet-500" fill="currentColor" opacity={0.9} />
                    </span>
                  )}
                  {authorInfo?.verified_role && (
                    <span title="نقش تأییدشده">
                      <CheckCircle className="w-6 h-6 text-emerald-500" fill="currentColor" opacity={0.9} />
                    </span>
                  )}
                </h1>
                {profileDisplayName !== (authorInfo?.username || authorName) && (
                  <span className="text-[10px] font-mono text-slate-500">@{authorInfo?.username || authorName}</span>
                )}
                {isVerifiedScribe && (
                  <div className="flex items-center gap-1 justify-center">
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 uppercase font-mono">
                      VERIFIED SCRIBE
                    </span>
                  </div>
                )}
                {(authorInfo?.has_reader_premium || authorInfo?.has_writer_premium) && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-yellow-400 text-yellow-950 border border-yellow-300 shadow-sm uppercase font-mono">پریمیوم</span>}
                {authorInfo?.has_reader_premium && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-600 dark:text-yellow-300 border border-yellow-400/50 uppercase font-mono">پریمیوم خواننده</span>}
                {authorInfo?.has_writer_premium && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-600 dark:text-yellow-300 border border-yellow-400/50 uppercase font-mono">پریمیوم نویسنده</span>}
              </div>

              {isEditingBio ? (
                <div className="max-w-xl mx-auto md:mx-0 space-y-2">
                  <textarea
                    value={editBioValue}
                    onChange={(e) => setEditBioValue(e.target.value)}
                    placeholder="کمی درباره خودتان بنویسید..."
                    className={`w-full h-24 p-3 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-violet-500 ${activeTheme.border} ${activeTheme.card}`}
                    maxLength={1000}
                  />
                  <div className="flex items-center gap-2 justify-center md:justify-start">
                    <button
                      onClick={handleSaveBio}
                      disabled={isSavingBio}
                      className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingBio ? "Saving..." : "Save Bio"}
                    </button>
                    <button
                      onClick={() => setIsEditingBio(false)}
                      className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex max-w-xl items-start justify-center gap-1.5 mx-auto md:mx-0 md:justify-start">
                  <p className="text-xs text-slate-600 dark:text-violet-200/80 leading-relaxed">
                    {getBio()}
                  </p>
                  {isCurrentUserAuthor && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditBioValue(authorInfo?.bio || "");
                        setIsEditingBio(true);
                      }}
                      className="mt-[-2px] shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-violet-500/10 hover:text-violet-500 cursor-pointer"
                      title="ویرایش بیوگرافی"
                      aria-label="ویرایش بیوگرافی"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}

              {(authorLinks.length > 0 || isCurrentUserAuthor) && (
                <div className="max-w-xl mx-auto md:mx-0 space-y-3 pt-1">
                  {authorLinks.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {authorLinks.map((link) => {
                        const linkStyle = AUTHOR_LINK_STYLES[link.platform] || AUTHOR_LINK_STYLES.x;
                        const LinkIcon = linkStyle.icon;
                        return (
                        <div key={link.id} className={`flex items-center gap-1 rounded-xl border p-1 ${linkStyle.color}`}>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-bold transition-colors hover:bg-white/10"
                          >
                            <LinkIcon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{link.label}</span>
                            <ExternalLink className="w-3 h-3 ml-auto shrink-0" />
                          </a>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Stats Grid */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs font-mono pt-1 text-slate-500">
              <span className="flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-violet-500" />
                <span className="font-bold text-slate-800 dark:text-slate-200">{authorNovels.length}</span> Novels Authored
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Eye className="w-3.5 h-3.5 text-fuchsia-400" />
                <span className="font-bold text-slate-800 dark:text-slate-200">{totalViews.toLocaleString()}</span> Reads
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-bold text-slate-800 dark:text-slate-200">{avgRating}</span> Avg Rating
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex justify-center md:justify-start gap-3 pt-2">
              <button
                onClick={handleFollowClick}
                disabled={followBusy || isCurrentUserAuthor}
                className={`px-4 py-2 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all duration-300 pointer-events-auto cursor-pointer ${
                  isFollowing
                    ? "bg-slate-800 text-slate-450 border border-slate-700 hover:bg-rose-650 hover:text-white"
                    : "bg-violet-600 text-white border border-violet-500 hover:bg-violet-500"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {followBusy ? "Saving..." : isCurrentUserAuthor ? "Your Profile" : isFollowing ? "Subscribed" : "Subscribe / Follow Scribe"}
              </button>
              
              {!isCurrentUserAuthor && (
                <button
                  onClick={() => setShowDMModal(true)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all duration-300 pointer-events-auto cursor-pointer bg-purple-600 text-white border border-purple-500 hover:bg-purple-500 flex items-center gap-2`}
                >
                  <MessageSquare className="w-4 h-4" />
                  Direct Message
                </button>
              )}
              {!isCurrentUserAuthor && (
                <button
                  onClick={() => setShowSupportModal(true)}
                  className="px-4 py-2 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all pointer-events-auto cursor-pointer bg-amber-500 text-white border border-amber-400 hover:bg-amber-400 flex items-center gap-2"
                >
                  <Star className="w-4 h-4" />
                  ارسال ستاره
                </button>
              )}
              {!isCurrentUserAuthor && currentUser && (
                <ReportButton targetType="user" targetId={authorInfo?.id || authorName} className="px-4 py-2 rounded-xl text-xs font-bold font-mono uppercase border border-rose-500/30 text-rose-400 hover:bg-rose-500/10" />
              )}
            </div>
            {followError && (
              <p className="text-xs text-rose-400 font-semibold pt-1">{followError}</p>
            )}
          </div>
        </div>
      </div>

      {showDMModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pt-[10vh] px-4">
          <div onClick={() => setShowDMModal(false)} className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-300" />
          <div className={`w-full max-w-lg p-6 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716] text-white shadow-[0_0_50px_rgba(79,70,229,0.2)]" : "bg-white text-stone-900 shadow-2xl"} z-10 relative`}>
            <button onClick={() => setShowDMModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold tracking-tight mb-4 text-purple-400">گفتگوی زندهٔ خصوصی</h3>
            <form onSubmit={handleSendDM} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5">موضوع</label>
                <input required type="text" value={dmSubject} onChange={(e) => setDmSubject(e.target.value)} className={`w-full p-3 rounded-xl border focus:outline-none focus:border-purple-500 ${theme === 'dark' ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`} placeholder="موضوع پیام..." />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5">متن پیام</label>
                <textarea required rows={4} value={dmContent} onChange={(e) => setDmContent(e.target.value)} className={`w-full p-3 rounded-xl border focus:outline-none focus:border-purple-500 ${theme === 'dark' ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'} custom-scrollbar`} placeholder="پیام خود را اینجا بنویسید... بلافاصله ارسال می‌شود." />
              </div>
              <button type="submit" className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(79,70,229,0.4)] cursor-pointer">
                Send Live Message
              </button>
            </form>
          </div>
        </div>
      )}

      {showSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pt-[10vh] px-4">
          <div onClick={() => setShowSupportModal(false)} className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          <div className={`w-full max-w-md p-6 rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716] text-white" : "bg-white text-stone-900"} z-10 relative`}>
            <button onClick={() => setShowSupportModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold tracking-tight mb-4 text-amber-400">Support {authorName}</h3>
            <form onSubmit={handleSupportAuthor} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-mono font-bold opacity-60 mb-1.5">ستاره‌ها</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={supportAmount}
                  onChange={(e) => setSupportAmount(Math.max(1, parseInt(e.target.value) || 1))}
                  className={`w-full p-3 rounded-xl border focus:outline-none focus:border-amber-500 ${theme === 'dark' ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>
              <textarea
                rows={3}
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                className={`w-full p-3 rounded-xl border focus:outline-none focus:border-amber-500 ${theme === 'dark' ? 'bg-black/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                placeholder="پیام تشویقی اختیاری..."
              />
              {supportStatus && <p className="text-xs text-amber-400">{supportStatus}</p>}
              <button type="submit" className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-bold transition-all cursor-pointer">
                Send Support
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Grid: Books and Reviews Received */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Side: Authored Books list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-bold tracking-tight">Novels Authored by {authorName}</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {authorNovels.map((novel) => (
              <div
                key={novel.id}
                className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex gap-4 hover:border-violet-500/40 transition-all duration-200 group cursor-pointer ${activeTheme.shadow}`}
                onClick={() => onSelectNovel(novel)}
              >
                <SafeImage
                  src={novel.cover}
                  alt={novel.title}
                  referrerPolicy="no-referrer"
                  className="w-16 h-24 rounded-lg object-cover bg-slate-900 border border-black/10 shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1 text-left">
                  <span className="text-[9px] font-mono font-bold bg-violet-500/15 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full uppercase leading-none">
                    {novel.genre}
                  </span>
                  <h3 className="font-bold text-sm truncate group-hover:text-violet-400 transition-colors pt-1">
                    {novel.title}
                  </h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                    <span className="flex items-center gap-0.5">
                      <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      {novel.rating}
                    </span>
                    <span>•</span>
                    <span>{novel.chapters?.length || 0} Chs</span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                    {novel.description}
                  </p>
                </div>
              </div>
            ))}
            {authorNovels.length === 0 && (
              <div className="col-span-2 text-center p-8 bg-slate-500/5 rounded-2xl text-xs text-slate-500 italic">
                No published works available for this scribe yet.
              </div>
            )}
          </div>

          {publicBookmarkedNovels.length > 0 && (
            <section className="space-y-3 pt-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold tracking-tight">نشانک‌های عمومی</h2>
                <span className="text-[10px] text-slate-500">Shared by {profileDisplayName}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {publicBookmarkedNovels.map((novel) => (
                  <button
                    type="button"
                    key={novel.id}
                    onClick={() => onSelectNovel(novel)}
                    className={`p-3 rounded-xl border ${activeTheme.border} ${activeTheme.card} flex gap-3 text-left hover:border-emerald-500/40 transition-colors`}
                  >
                    <SafeImage src={novel.coverUrl || novel.cover} alt={novel.title} className="w-10 h-14 rounded object-cover bg-slate-900" />
                    <span className="min-w-0">
                      <strong className="block text-xs truncate">{novel.title}</strong>
                      <span className="block text-[10px] text-slate-500 truncate mt-1">{novel.author}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Side: Chronological reviews left for their works */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-bold tracking-tight">دفتر نقد و بررسی‌ها</h2>
          </div>

          <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-4 ${activeTheme.shadow}`}>
            <span className="text-[9px] font-mono font-extrabold uppercase text-slate-500 tracking-wider block">آخرین نقدهای خوانندگان</span>
            <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
              {commentsReceived.map((r) => (
                <div key={r.id} className="p-3 bg-black/10 dark:bg-black/25 rounded-xl border border-slate-700/5 dark:border-slate-900/40 space-y-1.5 text-left">
                  <div className="flex justify-between items-center">
                    <span className="font-black text-violet-400 font-mono text-xs">{r.username}</span>
                    <span className="text-[9px] text-slate-500 font-mono">{r.createdAt}</span>
                  </div>
                  <span className="text-[8px] font-mono bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded leading-none block w-fit">
                    on {r.novelTitle}
                  </span>
                  <div className="flex items-center text-[10px] text-amber-500 leading-none">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className={i < r.rating ? "text-amber-500" : "text-slate-700"}>★</span>
                    ))}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 italic text-[11px] leading-relaxed">
                    "{r.comment}"
                  </p>
                </div>
              ))}
              {commentsReceived.length === 0 && (
                <div className="text-center py-10 text-slate-500 italic text-xs">
                  No commentary written for this author yet.
                </div>
              )}
            </div>
            
            <span className="text-[9px] font-mono font-extrabold uppercase text-slate-500 tracking-wider block mt-4 pt-4 border-t border-slate-700/30">دفترچه و نوشته‌های نویسنده</span>
            <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
              {authorPosts.map((post) => (
                <div key={post.id} className="p-3 bg-violet-500/5 dark:bg-violet-900/10 rounded-xl border border-violet-500/20 space-y-1.5 text-left">
                  <div className="flex justify-between items-center">
                    <span className="font-extrabold text-violet-500 text-xs">{post.title}</span>
                    <span className="text-[9px] text-slate-500 font-mono">{new Date(post.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed whitespace-pre-wrap">
                    {post.content}
                  </p>
                </div>
              ))}
              {authorPosts.length === 0 && (
                <div className="text-center py-6 text-slate-500 italic text-xs">
                  No announcements or posts from this author.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

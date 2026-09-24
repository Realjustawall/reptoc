import React, { useState, useEffect, lazy, Suspense } from "react";
import { Novel } from "../types";
import { CONTRAST_THEMES, MAIN_CATEGORIES, SUB_CATEGORIES, CONTENT_WARNINGS, GENRES } from "../data";
import { ShieldCheck, UserCheck, Settings2, Trash2, Ban, Unlock, CheckCircle2, ShieldAlert, Edit, Bell, Eye, Sparkles, Tags, BookOpen, Database, Download, Upload, Target, Trophy, Mail, ImagePlus, Loader2, Music, X } from "lucide-react";
import { api } from "../utils/api";
import { uploadImageBlob } from "../utils/imageUpload";
import { getNovelApprovalStatus } from "../utils/novelVisibility";
import TiptapEditor from "./TiptapEditor";
const PremiumManagementCards = lazy(() => import("./PremiumManagementCards"));
const PremiumBulkManagement = lazy(() => import("./PremiumBulkManagement"));
// The event manager is a large form; it only loads when an owner opens the tab.
const EventManager = lazy(() => import("./admin/EventManager"));
const OwnerLibraryBoard = lazy(() => import("./admin/OwnerLibraryBoard"));

const DEFAULT_FROM_EMAIL = "noreply@reptoc.xyz";
const DEFAULT_FROM_NAME = "رپتوک";
type EmailProvider = "smtp" | "mailjet" | "resend";

function TestSendRow({ busy, onSend }: { busy: boolean; onSend: (to: string) => void }) {
  const [to, setTo] = React.useState("");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        type="email"
        placeholder="آدرس ایمیل مقصد برای دریافت پیام آزمایشی..."
        className={`p-3 rounded-xl border text-xs bg-white border-stone-200 text-stone-900 placeholder:text-stone-400 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-600`}
      />
      <button
        onClick={() => to.trim() && onSend(to.trim())}
        disabled={busy || !to.trim()}
        className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
      >
        ارسال ایمیل آزمایشی
      </button>
    </div>
  );
}

const getInitialEmailProvider = (emailVerification: any): EmailProvider => {
  const provider = String(emailVerification?.provider || "").toLowerCase();
  if (provider === "smtp" || provider === "mailjet" || provider === "resend") return provider;
  if (emailVerification?.mailjet) return "mailjet";
  if (emailVerification?.smtp) return "smtp";
  return "resend";
};

const PERMISSION_GROUPS = [
  {
    title: "کنترل سیستم",
    description: "بالاترین سطح دسترسی برای مدیریت پلتفرم.",
    permissions: ["admin:*", "analytics:read_all"]
  },
  {
    title: "مدیریت محتوا",
    description: "اقدامات صف‌های انجمن و ایمنی.",
    permissions: ["moderate:*", "report:moderate", "report:punish", "forum:pin", "forum:delete", "forum:edit", "forum:moderate", "forum:announce"]
  },
  {
    title: "عملیات رمان",
    description: "بازبینی، تأیید، ویرایش و حذف محتوای داستانی.",
    permissions: ["novel:approve", "novel:delete", "novel:edit_all"]
  },
  {
    title: "کاربران",
    description: "تغییرات حساب، ارتقا و محدودیت‌ها.",
    permissions: ["user:ban", "user:delete", "user:promote"]
  },
  {
    title: "Support",
    description: "کنترل نمایان بودن تیکت‌ها و گردش کار پشتیبانی.",
    permissions: ["ticket:read_all", "ticket:update", "ticket:close"]
  }
];

interface AuthorityCenterProps {
  theme: "light" | "dark";
  novels: Novel[];
  onApproveNovel: (id: string, note?: string) => void;
  onRejectNovel: (id: string, reason: string) => void;
  onDeleteNovel: (id: string) => void | Promise<void>;
  blockedUsers: string[];
  onToggleBlockUser: (username: string, block: boolean) => void;
  systemSettings: any;
  onSaveSettings: (settings: any) => Promise<void>;
  userRole: "writer" | "editor" | "publisher" | "owner";
}

function getAccessLabel(role: AuthorityCenterProps["userRole"]) {
  if (role === "owner") return "دسترسی مالک";
  if (role === "publisher") return "دسترسی مدیر";
  if (role === "editor") return "دسترسی ویراستار";
  return "دسترسی نویسنده";
}

const CategoryManager = ({ 
  title, 
  itemsJson, 
  onChange,
  isDark
}: { 
  title: string, 
  itemsJson: string, 
  onChange: (newJson: string) => void,
  isDark: boolean
}) => {
  const [items, setItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");

  useEffect(() => {
    try {
      setItems(JSON.parse(itemsJson));
    } catch {
      setItems([]);
    }
  }, [itemsJson]);

  const handleAdd = () => {
    if (!newItem.trim()) return;
    if (items.includes(newItem.trim())) return;
    const newArray = [...items, newItem.trim()];
    setItems(newArray);
    onChange(JSON.stringify(newArray, null, 2));
    setNewItem("");
  };

  const handleRemove = (itemToRemove: string) => {
    const newArray = items.filter(i => i !== itemToRemove);
    setItems(newArray);
    onChange(JSON.stringify(newArray, null, 2));
  };

  return (
    <div className={`space-y-3 p-4 rounded-xl border ${isDark ? "border-violet-950/20 bg-[#0e0a1c]/40" : "border-stone-200 bg-stone-50"}`}>
      <label className="text-[10px] font-mono font-bold text-slate-500 uppercase">{title}</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input 
          type="text" 
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          placeholder="دسته‌بندی جدید..."
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
          className={`flex-1 min-w-0 p-2 text-xs rounded border focus:outline-none transition-colors ${
            isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"
          }`}
        />
        <button type="button" onClick={handleAdd} className="px-3 py-2 bg-violet-600 text-white rounded font-bold text-xs hover:bg-violet-500 cursor-pointer whitespace-nowrap">
          افزودن
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {items.map(item => (
          <span key={item} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${isDark ? "bg-slate-900 border-slate-800 text-slate-300" : "bg-white border-slate-200 text-slate-700"}`}>
            {item}
            <button type="button" onClick={() => handleRemove(item)} className="text-rose-500 hover:text-rose-600 ml-1 cursor-pointer">
              &times;
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[10px] text-slate-500">بدون دسته‌بندی</span>}
      </div>
    </div>
  );
}

export default function AuthorityCenter({
  theme,
  novels,
  onApproveNovel,
  onRejectNovel,
  onDeleteNovel,
  blockedUsers,
  onToggleBlockUser,
  systemSettings,
  onSaveSettings,
  userRole,
}: AuthorityCenterProps) {
  const activeTheme = CONTRAST_THEMES[theme];
  const isDark = theme === "dark";
  const adminControlClass = isDark
    ? "bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-600"
    : "bg-white border-stone-200 text-stone-900 placeholder:text-stone-400";
  const adminSelectStyle = {
    backgroundColor: isDark ? "#080512" : "#ffffff",
    color: isDark ? "#f8fafc" : "#1c1917"
  };

  const [activeSegment, setActiveSegment] = useState<"publisher" | "owner" | "users" | "operations" | "backup" | "settings" | "rules" | "categories" | "tickets" | "audit" | "monitor" | "ai" | "challenges" | "events" | "email">(
    userRole === "owner" ? "owner" : "publisher"
  );
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [auditFiles, setAuditFiles] = useState<any[]>([]);
  const [selectedAuditFile, setSelectedAuditFile] = useState<string | null>(null);
  const [selectedAuditContent, setSelectedAuditContent] = useState<string | null>(null);
  const [databaseBackupPassword, setDatabaseBackupPassword] = useState("");
  const [databaseBackupFile, setDatabaseBackupFile] = useState<File | null>(null);
  const [databaseBackupBusy, setDatabaseBackupBusy] = useState(false);
  const [databaseBackupStatus, setDatabaseBackupStatus] = useState("");

  // States for Owner Settings Form
  const [announcement, setAnnouncement] = useState(systemSettings.announcement);
  const [maintenanceMode, setMaintenanceMode] = useState(systemSettings.maintenanceMode);
  const [allowRegistration, setAllowRegistration] = useState(systemSettings.allowRegistration);
  const [rulesText, setRulesText] = useState(systemSettings.rulesText || "با احترام رفتار کنید، راهنمای جامعه را رعایت کنید و محتوایی که حق انتشار آن را ندارید بارگذاری نکنید.");
  const [mainBannerImage, setMainBannerImage] = useState(systemSettings.mainBannerImage || "");
  const [mainBannerTitle, setMainBannerTitle] = useState(systemSettings.mainBannerTitle || "رمان‌های شگفت‌انگیز را کشف کنید");
  const [mainBannerSubtitle, setMainBannerSubtitle] = useState(systemSettings.mainBannerSubtitle || "هر روز");
  const [mainBannerDescription, setMainBannerDescription] = useState(systemSettings.mainBannerDescription || "به جمعی از خوانندگان و نویسندگان بپیوندید.");
  const [faqsJson, setFaqsJson] = useState(JSON.stringify(systemSettings.faqs || [], null, 2));
  const [contestJson, setContestJson] = useState(JSON.stringify(systemSettings.activeContest || {}, null, 2));
  const [tagsJson, setTagsJson] = useState(JSON.stringify(systemSettings.leaderboardTags || [], null, 2));
  const [forumCategoriesJson, setForumCategoriesJson] = useState(JSON.stringify(systemSettings.forumCategories || ["همه دسته‌ها", "اطلاعیه‌ها", "هنر نوشتن", "گفت‌وگو درباره درون‌مایه‌ها", "پیشنهادها", "گفت‌وگوی آزاد"], null, 2));
  const [mainCategoriesJson, setMainCategoriesJson] = useState(JSON.stringify(systemSettings.mainCategories || MAIN_CATEGORIES, null, 2));
  const [subCategoriesJson, setSubCategoriesJson] = useState(JSON.stringify(systemSettings.subCategories || SUB_CATEGORIES, null, 2));
  const [contentWarningsJson, setContentWarningsJson] = useState(JSON.stringify(systemSettings.contentWarnings || CONTENT_WARNINGS, null, 2));
  const [genresJson, setGenresJson] = useState(JSON.stringify(systemSettings.genres || GENRES, null, 2));
  const [forumCooldownConfig, setForumCooldownConfig] = useState(systemSettings.forumCooldown || 0);
  const [activeContestsCount, setActiveContestsCount] = useState(systemSettings.activeContestsCount || 0);
  const [emailVerificationEnabled, setEmailVerificationEnabled] = useState(!!systemSettings.emailVerification?.enabled);
  const [emailProvider, setEmailProvider] = useState<EmailProvider>(getInitialEmailProvider(systemSettings.emailVerification));
  const [smtpHost, setSmtpHost] = useState(systemSettings.emailVerification?.smtp?.host || "");
  const [smtpPort, setSmtpPort] = useState(systemSettings.emailVerification?.smtp?.port || 587);
  const [smtpUser, setSmtpUser] = useState(systemSettings.emailVerification?.smtp?.user || "");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState(systemSettings.emailVerification?.smtp?.from || DEFAULT_FROM_EMAIL);
  const [smtpSecure, setSmtpSecure] = useState(!!systemSettings.emailVerification?.smtp?.secure);
  const [mailjetApiKey, setMailjetApiKey] = useState("");
  const [mailjetSecretKey, setMailjetSecretKey] = useState("");
  const [mailjetFrom, setMailjetFrom] = useState(systemSettings.emailVerification?.mailjet?.from || DEFAULT_FROM_EMAIL);
  const [mailjetFromName, setMailjetFromName] = useState(systemSettings.emailVerification?.mailjet?.fromName || DEFAULT_FROM_NAME);
  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFrom, setResendFrom] = useState(systemSettings.emailVerification?.resend?.from || DEFAULT_FROM_EMAIL);
  const [resendFromName, setResendFromName] = useState(systemSettings.emailVerification?.resend?.fromName || DEFAULT_FROM_NAME);
  const [testEmailTo, setTestEmailTo] = useState(systemSettings.emailVerification?.resend?.from || systemSettings.emailVerification?.mailjet?.from || systemSettings.emailVerification?.smtp?.from || DEFAULT_FROM_EMAIL);
  const [testEmailStatus, setTestEmailStatus] = useState("");
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  
  // Dashboard Sections Toggles
  const [section_suggestion_enabled, setSection_suggestion_enabled] = useState(systemSettings.section_suggestion_enabled !== false);
  const [section_must_read_enabled, setSection_must_read_enabled] = useState(systemSettings.section_must_read_enabled !== false);
  const [section_new_releases_enabled, setSection_new_releases_enabled] = useState(systemSettings.section_new_releases_enabled !== false);
  const [section_recently_updated_enabled, setSection_recently_updated_enabled] = useState(systemSettings.section_recently_updated_enabled !== false);

  // ✅ NEW: AI Settings States
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiButtonVisible, setAiButtonVisible] = useState(true);
  const [aiDailyQuotaPerUser, setAiDailyQuotaPerUser] = useState(50);
  const [aiSystemDailyQuota, setAiSystemDailyQuota] = useState(10000);
  const [aiGeminiApiKey, setAiGeminiApiKey] = useState("");
  const [aiOpenAIApiKey, setAiOpenAIApiKey] = useState("");
  const [aiGroqApiKey, setAiGroqApiKey] = useState("");
  const [aiDetectionEnabled, setAiDetectionEnabled] = useState(false);
  const [aiDetectionProvider, setAiDetectionProvider] = useState("gemini");
  const [aiDetectionModel, setAiDetectionModel] = useState("gemini-2.5-flash");
  const [aiDetectionPrompt, setAiDetectionPrompt] = useState("Assess whether this novel excerpt is substantially AI-generated. Return only JSON with aiScore (0-100), confidence (0-100), and summary.");
  const [aiJailbreakDetectionEnabled, setAiJailbreakDetectionEnabled] = useState(true);
  const [aiMaxPromptLength, setAiMaxPromptLength] = useState(2000);
  const [aiMaxContextLength, setAiMaxContextLength] = useState(1000);
  const [aiUsageStats, setAiUsageStats] = useState<any>(null);
  const [loadingAiSettings, setLoadingAiSettings] = useState(false);

  const [isSaved, setIsSaved] = useState(false);

  // States for moderation modal
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // States for Real user management
  const [platformUsers, setPlatformUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [premiumEditingUserId, setPremiumEditingUserId] = useState<string | null>(null);
  const [permissionEditingUserId, setPermissionEditingUserId] = useState<string | null>(null);
  const [editUserRole, setEditUserRole] = useState("writer");
  const [editUserDepartments, setEditUserDepartments] = useState<string[]>([]);
  const [editUserLevel, setEditUserLevel] = useState(1);
  const [editUserXp, setEditUserXp] = useState(0);
  const [editUserCoins, setEditUserCoins] = useState(0);
  const [editUserStars, setEditUserStars] = useState(0);
  const [editUserNickname, setEditUserNickname] = useState("");
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserPhone, setEditUserPhone] = useState("");
  const [editUserAvatar, setEditUserAvatar] = useState("");
  const [editUserBio, setEditUserBio] = useState("");
  const [editVerifiedAuthor, setEditVerifiedAuthor] = useState(false);
  const [editVerifiedRole, setEditVerifiedRole] = useState(false);
  const [editEmailVerified, setEditEmailVerified] = useState(false);
  const [editUserPassword, setEditUserPassword] = useState("");
  const [editUserPremiumDays, setEditUserPremiumDays] = useState<number>(0);
  const [editPremiumPlan, setEditPremiumPlan] = useState("manual");
  const [editPremiumLifetime, setEditPremiumLifetime] = useState(false);
  const [editDisablePremium, setEditDisablePremium] = useState(false);
  const [editIsStaff, setEditIsStaff] = useState(false);
  const [editBlocked, setEditBlocked] = useState(false);
  const [editPublishingBlocked, setEditPublishingBlocked] = useState(false);
  const [editCustomRoleId, setEditCustomRoleId] = useState<string>("");
  const [editPermissionsText, setEditPermissionsText] = useState("");
  const [customRoles, setCustomRoles] = useState<any[]>([]);
  const [roleEditorId, setRoleEditorId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [achievementsList, setAchievementsList] = useState<any[]>([]);
  const [selectedAchievement, setSelectedAchievement] = useState<string>("");
  const [userSearch, setUserSearch] = useState("");
  const [premiumUserFilter, setPremiumUserFilter] = useState("");
  const [premiumSourceFilter, setPremiumSourceFilter] = useState("");
  const [premiumActivationFilter, setPremiumActivationFilter] = useState("");
  const [premiumExpirationFilter, setPremiumExpirationFilter] = useState("");
  const [selectedUsersIds, setSelectedUsersIds] = useState<string[]>([]);

  // States for ticket management
  const [tickets, setTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const [ticketReply, setTicketReply] = useState("");
  const [monitorMetrics, setMonitorMetrics] = useState<any | null>(null);
  const [siteAnalytics, setSiteAnalytics] = useState<any | null>(null);
  const [adminOps, setAdminOps] = useState<any | null>(null);
  const [loadingOps, setLoadingOps] = useState(false);
  const [timelineUserId, setTimelineUserId] = useState("");
  const [userTimeline, setUserTimeline] = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [reportPunishment, setReportPunishment] = useState("none");
  const [reportBusy, setReportBusy] = useState(false);
  const [opsInternalNote, setOpsInternalNote] = useState("");
  const [backupFrequency, setBackupFrequency] = useState("daily");
  const [communicationScope, setCommunicationScope] = useState<"all" | "selected">("selected");
  const [communicationDelivery, setCommunicationDelivery] = useState<"notification" | "email" | "both">("notification");
  const [communicationTitle, setCommunicationTitle] = useState("");
  const [communicationMessage, setCommunicationMessage] = useState("");
  const [communicationLink, setCommunicationLink] = useState("");
  const [communicationStatus, setCommunicationStatus] = useState("");
  const [communicationSending, setCommunicationSending] = useState(false);
  const [commentModeration, setCommentModeration] = useState<any>({ items: [], counts: {}, pagination: { page: 1, totalPages: 1, total: 0 } });
  const [commentModerationStatus, setCommentModerationStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [commentModerationPage, setCommentModerationPage] = useState(1);
  const [commentModerationSearch, setCommentModerationSearch] = useState("");
  const [selectedCommentIds, setSelectedCommentIds] = useState<string[]>([]);
  const [commentModerationBusy, setCommentModerationBusy] = useState(false);
  const [commentModerationMessage, setCommentModerationMessage] = useState("");
  const [commentModerationMode, setCommentModerationMode] = useState<"manual" | "automatic">("manual");
  const [commentModerationKeyConfigured, setCommentModerationKeyConfigured] = useState(false);
  const [commentModerationTestMessage, setCommentModerationTestMessage] = useState("");
  const [commentModerationTestResult, setCommentModerationTestResult] = useState<any | null>(null);

  // Daily challenges admin
  const [adminChallenges, setAdminChallenges] = useState<any[]>([]);
  const [challengeTitle, setChallengeTitle] = useState("");
  const [challengePrompt, setChallengePrompt] = useState("");
  const [challengeType, setChallengeType] = useState<"continuation" | "story_naming">("continuation");
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeStatusMsg, setChallengeStatusMsg] = useState("");
  // A prompt can be a picture and/or a narration clip, not only text. Both are
  // uploaded first and the challenge stores the returned `/uploads/...` path.
  const [challengeImageUrl, setChallengeImageUrl] = useState("");
  const [challengeAudioUrl, setChallengeAudioUrl] = useState("");
  const [challengeMediaBusy, setChallengeMediaBusy] = useState<"image" | "audio" | null>(null);
  const challengeImageInputRef = React.useRef<HTMLInputElement>(null);
  const challengeAudioInputRef = React.useRef<HTMLInputElement>(null);

  // Events admin
  const [eventOverview, setEventOverview] = useState<any>(null);
  const [exclusionUsername, setExclusionUsername] = useState("");
  const [eventClearNovelId, setEventClearNovelId] = useState("");
  const [eventStatusMsg, setEventStatusMsg] = useState("");

  // Email server admin
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [emailHost, setEmailHost] = useState("");
  const [emailPort, setEmailPort] = useState("587");
  const [emailSecure, setEmailSecure] = useState(false);
  const [emailUser, setEmailUser] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailDirect, setEmailDirect] = useState(false);
  const [emailVerificationToggle, setEmailVerificationToggle] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [inboundEnabled, setInboundEnabled] = useState(false);
  const [inboundPort, setInboundPort] = useState("25");
  const [inboundDomain, setInboundDomain] = useState("");
  const [inboundHost, setInboundHost] = useState("127.0.0.1");
  const [inboundMessages, setInboundMessages] = useState<any[]>([]);
  const [openInboundMessage, setOpenInboundMessage] = useState<any | null>(null);
  const [editingChallengeId, setEditingChallengeId] = useState<string | null>(null);
  const [editChallengeTitle, setEditChallengeTitle] = useState("");
  const [editChallengePrompt, setEditChallengePrompt] = useState("");
  const [challengeWinnerDrafts, setChallengeWinnerDrafts] = useState<Record<string, string[]>>({});

  const loadAdminChallenges = React.useCallback(async () => {
    const token = api.getToken();
    if (!token) return;
    try {
      const data = await api.getAdminChallenges(token);
      const challenges = data.challenges || [];
      setAdminChallenges(challenges);
      setChallengeWinnerDrafts(Object.fromEntries(challenges.map((challenge: any) => [
        challenge.id,
        (challenge.entries || [])
          .filter((entry: any) => entry.winnerRank != null)
          .sort((a: any, b: any) => a.winnerRank - b.winnerRank)
          .map((entry: any) => entry.id),
      ])));
      setChallengeStatusMsg("");
    } catch (err: any) {
      setChallengeStatusMsg(err?.message || "بارگذاری چالش‌ها ناموفق بود.");
    }
  }, []);

  useEffect(() => {
    if (activeSegment === "challenges" && userRole === "owner") {
      loadAdminChallenges();
    }
    if (activeSegment === "events" && userRole === "owner") {
      const token = api.getToken();
      if (token) api.getEventAdminOverview(token).then(setEventOverview).catch((err) => setEventStatusMsg(err?.message || "بارگذاری رویداد ناموفق بود."));
    }
    if (activeSegment === "email" && userRole === "owner") {
      const token = api.getToken();
      if (!token) return;
      api.getEmailServerStatus(token).then((status) => {
        setEmailStatus(status);
        setEmailHost(status.smtp?.host || "");
        setEmailPort(String(status.smtp?.port || 587));
        setEmailSecure(status.smtp?.secure === true);
        setEmailUser(status.smtp?.user || "");
        setEmailFrom(status.smtp?.from || "");
        setEmailDirect(status.smtp?.direct === true);
        setInboundEnabled(status.inbound?.running === true);
        setInboundHost(status.inbound?.host || "127.0.0.1");
      }).catch((err) => setEmailMsg(err?.message || "بارگذاری وضعیت ایمیل ناموفق بود."));
      api.getInboundEmails(token).then(setInboundMessages).catch(() => setInboundMessages([]));
    }
  }, [activeSegment, userRole, loadAdminChallenges]);

  useEffect(() => {
    if ((activeSegment === "owner" || activeSegment === "users") && userRole === "owner") {
      loadUsers();
      loadAiSettings();
    }
    if (activeSegment === "tickets" && (userRole === "owner" || userRole === "publisher")) {
      loadTickets();
    }
    if (activeSegment === "operations" && userRole === "owner") {
      loadOperations();
      loadUsers();
      loadCommentModeration("pending", 1);
      loadCommentModerationSettings();
    }
    if (activeSegment === "audit" && userRole === "owner") {
      const token = api.getToken();
      if (token) {
        api.getAdminAudit(token).then(setAuditEntries).catch(() => setAuditEntries([]));
        api.getAdminAuditFiles(token).then(setAuditFiles).catch(() => setAuditFiles([]));
      }
    }
    if (activeSegment === 'monitor' && userRole === 'owner') {
      const token = api.getToken();
      if (token) {
        api.getMonitorMetrics(token).then((m) => { if (m) setMonitorMetrics(m); }).catch(() => setMonitorMetrics(null));
        api.getAdminSiteAnalytics(token).then(setSiteAnalytics).catch(() => setSiteAnalytics(null));
      }
    }
    if (activeSegment === 'ai' && userRole === 'owner') {
      loadAiSettings();
    }
  }, [activeSegment, userRole]);

  const sendAdminCommunication = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = api.getToken();
    if (!token) return;
    if (communicationScope === "all" && !window.confirm(`ارسال این پیام (${communicationDelivery}) به همه ${platformUsers.length} کاربر انجام شود؟`)) return;
    setCommunicationSending(true);
    setCommunicationStatus("");
    try {
      const result = await api.sendAdminCommunication(token, {
        scope: communicationScope,
        userIds: selectedUsersIds,
        delivery: communicationDelivery,
        title: communicationTitle,
        message: communicationMessage,
        link: communicationLink
      });
      setCommunicationStatus(`ارسال به ${result.recipients} کاربر انجام شد: ${result.notificationsSent} اعلان، ${result.emailsSent} ایمیل${result.emailsSkipped ? `، ${result.emailsSkipped} ایمیل نادیده گرفته شد` : ""}.`);
      setCommunicationTitle("");
      setCommunicationMessage("");
      setCommunicationLink("");
    } catch (err: any) {
      setCommunicationStatus(err?.message || "ارسال پیام ممکن نشد.");
    } finally {
      setCommunicationSending(false);
    }
  };

  const loadOperations = async () => {
    setLoadingOps(true);
    const token = api.getToken();
    if (token) {
      const data = await api.getAdminOperations(token);
      setAdminOps(data);
    }
    setLoadingOps(false);
  };

  const loadCommentModeration = async (status = commentModerationStatus, page = commentModerationPage) => {
    const token = api.getToken();
    if (!token) return;
    setCommentModerationBusy(true);
    try {
      const data = await api.getCommentModeration(token, { status, page, pageSize: 20, search: commentModerationSearch });
      setCommentModeration(data);
      setCommentModerationStatus(status as any);
      setCommentModerationPage(page);
      setSelectedCommentIds([]);
    } catch (error: any) {
      setCommentModerationMessage(error?.message || "بارگذاری دیدگاه‌ها ناموفق بود.");
    } finally { setCommentModerationBusy(false); }
  };

  const loadCommentModerationSettings = async () => {
    const token = api.getToken();
    if (!token) return;
    try {
      const config = await api.getCommentModerationSettings(token);
      setCommentModerationMode(config.mode === "automatic" ? "automatic" : "manual");
      setCommentModerationKeyConfigured(config.apiKeyConfigured === true);
    } catch (error: any) { setCommentModerationMessage(error?.message || "بارگذاری تنظیمات ناموفق بود."); }
  };

  const saveCommentModerationSettings = async () => {
    const token = api.getToken();
    if (!token) return;
    setCommentModerationBusy(true); setCommentModerationMessage("");
    try {
      const config = await api.saveCommentModerationSettings(token, { mode: commentModerationMode });
      setCommentModerationKeyConfigured(config.apiKeyConfigured === true);
      setCommentModerationMessage("تنظیمات نظارت با موفقیت و به‌صورت رمزگذاری‌شده ذخیره شد.");
    } catch (error: any) { setCommentModerationMessage(error?.message || "ذخیره تنظیمات ناموفق بود."); }
    finally { setCommentModerationBusy(false); }
  };

  const decideComment = async (id: string, decision: "approve" | "reject") => {
    const token = api.getToken(); if (!token) return;
    setCommentModerationBusy(true); setCommentModerationMessage("");
    try { await api.decideCommentModeration(token, id, decision); await loadCommentModeration(commentModerationStatus, commentModerationPage); }
    catch (error: any) { setCommentModerationMessage(error?.message || "ثبت تصمیم ناموفق بود."); }
    finally { setCommentModerationBusy(false); }
  };

  const moderateSelectedComments = async (action: "approve" | "reject" | "ai") => {
    if (!selectedCommentIds.length) return;
    const token = api.getToken(); if (!token) return;
    setCommentModerationBusy(true); setCommentModerationMessage(action === "ai" ? "در حال بررسی هوشمند دیدگاه‌ها، یکی‌یکی…" : "در حال ثبت تصمیم گروهی…");
    try {
      const result = await api.batchCommentModeration(token, selectedCommentIds, action);
      const successCount = (result.results || []).filter((item: any) => item.success).length;
      const errorCount = (result.results || []).length - successCount;
      setCommentModerationMessage(`${successCount} دیدگاه پردازش شد${errorCount ? `؛ ${errorCount} مورد به‌دلیل خطا در انتظار ماند` : ""}.`);
      await loadCommentModeration(commentModerationStatus, commentModerationPage);
    } catch (error: any) { setCommentModerationMessage(error?.message || "پردازش گروهی ناموفق بود."); }
    finally { setCommentModerationBusy(false); }
  };

  const testCommentModeration = async () => {
    const message = commentModerationTestMessage.trim();
    const token = api.getToken();
    if (!token || !message) return;
    setCommentModerationBusy(true); setCommentModerationTestResult(null); setCommentModerationMessage("در حال ارسال پیام آزمایشی…");
    try {
      const result = await api.testCommentModeration(token, message);
      setCommentModerationTestResult(result);
      setCommentModerationMessage("");
    } catch (error: any) {
      setCommentModerationMessage(error?.message || "آزمایش پیام ناموفق بود.");
    } finally { setCommentModerationBusy(false); }
  };

  const deleteApprovedComment = async (id: string) => {
    if (!window.confirm("این دیدگاه تأییدشده از سایت حذف شود؟")) return;
    const token = api.getToken(); if (!token) return;
    setCommentModerationBusy(true); setCommentModerationMessage("");
    try {
      await api.deleteApprovedComment(token, id);
      setCommentModerationMessage("دیدگاه تأییدشده حذف شد.");
      await loadCommentModeration(commentModerationStatus, commentModerationPage);
    } catch (error: any) { setCommentModerationMessage(error?.message || "حذف دیدگاه ناموفق بود."); }
    finally { setCommentModerationBusy(false); }
  };

  const loadTimeline = async (userId: string) => {
    setTimelineUserId(userId);
    const token = api.getToken();
    if (token && userId) {
      setUserTimeline(await api.getUserTimeline(token, userId));
    }
  };

  const runContentAction = async (targetType: string, targetId: string, action: string) => {
    const token = api.getToken();
    if (!token) return alert("احراز هویت نشده است");
    const note = action === "delete" ? "" : window.prompt("یادداشت مدیر", action === "quarantine" ? "برای بازبینی دستی قرنطینه شد." : "توسط مدیر بررسی شد.") || "";
    if (action === "delete" && !confirm("این مورد برای همیشه حذف شود؟")) return;
    const ok = await api.applyContentAction(token, { targetType, targetId, action, note });
    if (ok) await loadOperations();
    else alert("عملیات ناموفق بود.");
  };

  const openReport = async (reportId: string) => {
    const token = api.getToken();
    if (!token) return;
    const details = await api.getReportDetails(token, reportId);
    if (details) {
      setSelectedReport(details);
      setReportNote(details.report?.moderator_note || "");
      setReportPunishment("none");
    }
  };

  const decideReport = async (decision: "approved" | "rejected") => {
    if (!selectedReport?.report?.id) return;
    if (decision === "approved" && reportPunishment !== "none" && !confirm(`Accept this report and apply ${reportPunishment.replace(/_/g, " ")}?`)) return;
    setReportBusy(true);
    const token = api.getToken();
    const result = token ? await api.updateReport(token, selectedReport.report.id, { decision, punishment: decision === "approved" ? reportPunishment : "none", moderatorNote: reportNote }) : null;
    setReportBusy(false);
    if (!result?.success) return alert(result?.error || "تصمیم درباره گزارش ناموفق بود.");
    setSelectedReport(null);
    await loadOperations();
  };

  const loadTickets = async () => {
    const token = api.getToken();
    if (token) {
      try { setTickets(await api.getTickets(token, "all")); }
      catch (err: any) { alert(err?.message || "بارگذاری تیکت‌ها ناموفق بود."); }
    }
  };

  const loadTicketMessages = async (id: string) => {
    const token = api.getToken();
    if (token) {
      try { setTicketMessages(await api.getTicketMessages(token, id)); }
      catch (err: any) { alert(err?.message || "بارگذاری پیام‌های تیکت ناموفق بود."); }
    }
  };

  const selectAdminTicket = (ticket: any) => {
    setSelectedTicket(ticket);
    loadTicketMessages(ticket.id);
  };

  const sendAdminTicketReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketReply.trim() || !selectedTicket) return;
    const token = api.getToken();
    if (token) {
      try {
        await api.sendTicketMessage(token, selectedTicket.id, ticketReply);
        setTicketReply("");
        await loadTicketMessages(selectedTicket.id);
        await loadTickets();
      } catch (err: any) { alert(err?.message || "ارسال پاسخ تیکت ناموفق بود."); }
    }
  };
  
  const changeTicketStatus = async (status: string) => {
    const token = api.getToken();
    if (token && selectedTicket) {
      try {
        await api.updateTicketStatus(token, selectedTicket.id, status);
        setSelectedTicket({...selectedTicket, status});
        const arr = [...tickets];
        const idx = arr.findIndex(x => x.id === selectedTicket.id);
        if (idx >= 0) arr[idx].status = status;
        setTickets(arr);
      } catch (err: any) { alert(err?.message || "به‌روزرسانی وضعیت تیکت ناموفق بود."); }
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    setUsersError("");
    const token = api.getToken();
    if (!token) {
      setUsersError("احراز هویت نشده است.");
      setLoadingUsers(false);
      return;
    }
    try {
      const dbUsers = await api.getUsers(token);
      setPlatformUsers(dbUsers);
      setCustomRoles(await api.getCustomRoles(token));
    } catch (error: any) {
      setPlatformUsers([]);
      setUsersError(error?.message || "بارگذاری کاربران ناموفق بود.");
    }
    setLoadingUsers(false);
  };

  const removeSelectedTicket = async () => {
    if (!selectedTicket || !confirm("این تیکت و همه پیام‌هایش برای همیشه حذف شود؟")) return;
    const token = api.getToken();
    if (!token) return;
    try {
      await api.deleteTicket(token, selectedTicket.id);
      setTickets((items) => items.filter((ticket) => ticket.id !== selectedTicket.id));
      setSelectedTicket(null);
      setTicketMessages([]);
    } catch (err: any) {
      alert(err?.message || "حذف تیکت ممکن نشد.");
    }
  };

  // ✅ NEW: Load AI Settings
  const loadAiSettings = async () => {
    setLoadingAiSettings(true);
    const token = api.getToken();
    if (token) {
      const settings = await api.getAISettings(token);
      if (settings) {
        setAiEnabled(settings.enabled !== false);
        setAiButtonVisible(settings.button_visible !== false);
        setAiDailyQuotaPerUser(settings.daily_quota_per_user || 50);
        setAiSystemDailyQuota(settings.system_daily_quota || 10000);
        setAiGeminiApiKey(settings.gemini_api_key ? "***HIDDEN***" : "");
        setAiOpenAIApiKey(settings.openai_api_key ? "***HIDDEN***" : "");
        setAiGroqApiKey(settings.groq_api_key ? "***HIDDEN***" : "");
        setAiDetectionEnabled(!!settings.detection_enabled);
        setAiDetectionProvider(settings.detection_provider || "gemini");
        setAiDetectionModel(settings.detection_model || "gemini-2.5-flash");
        if (settings.detection_base_prompt) setAiDetectionPrompt(settings.detection_base_prompt);
        setAiJailbreakDetectionEnabled(settings.jailbreak_detection_enabled !== false);
        setAiMaxPromptLength(settings.max_prompt_length || 2000);
        setAiMaxContextLength(settings.max_context_length || 1000);
      }
      const stats = await api.getAIUsageStats(token);
      if (stats) setAiUsageStats(stats);
    }
    setLoadingAiSettings(false);
  };

  // ✅ NEW: Save AI Settings
  const saveAiSettings = async () => {
    setLoadingAiSettings(true);
    const token = api.getToken();
    if (token) {
      const result = await api.updateAISettings(token, {
        enabled: aiEnabled,
        button_visible: aiButtonVisible,
        daily_quota_per_user: aiDailyQuotaPerUser,
        system_daily_quota: aiSystemDailyQuota,
        gemini_api_key: aiGeminiApiKey === "***HIDDEN***" ? undefined : aiGeminiApiKey,
        openai_api_key: aiOpenAIApiKey === "***HIDDEN***" ? undefined : aiOpenAIApiKey,
        groq_api_key: aiGroqApiKey === "***HIDDEN***" ? undefined : aiGroqApiKey,
        detection_enabled: aiDetectionEnabled,
        detection_provider: aiDetectionProvider,
        detection_model: aiDetectionModel,
        detection_base_prompt: aiDetectionPrompt,
        jailbreak_detection_enabled: aiJailbreakDetectionEnabled,
        max_prompt_length: aiMaxPromptLength,
        max_context_length: aiMaxContextLength
      });
      if (result && result.success) {
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
        await loadAiSettings();
      }
    }
    setLoadingAiSettings(false);
  };

  useEffect(() => {
    // load achievements for grant UI
    (async () => {
      const ach = await api.getAchievements();
      setAchievementsList(Array.isArray(ach) ? ach : []);
    })();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedContest = JSON.parse(contestJson);
      await onSaveSettings({
        announcement,
        maintenanceMode,
        allowRegistration,
        rulesText,
        mainBannerImage,
        mainBannerTitle,
        mainBannerSubtitle,
        mainBannerDescription,
        faqs: JSON.parse(faqsJson),
        activeContest: parsedContest,
        leaderboardTags: JSON.parse(tagsJson),
        forumCategories: JSON.parse(forumCategoriesJson),
        mainCategories: JSON.parse(mainCategoriesJson),
        subCategories: JSON.parse(subCategoriesJson),
        contentWarnings: JSON.parse(contentWarningsJson),
        genres: JSON.parse(genresJson),
        forumCooldown: forumCooldownConfig,
        activeContestsCount,
        emailVerification: {
          enabled: emailVerificationEnabled,
          provider: emailProvider,
          smtp: {
            host: smtpHost,
            port: Number(smtpPort) || 587,
            user: smtpUser,
            pass: smtpPass,
            from: smtpFrom || DEFAULT_FROM_EMAIL,
            secure: smtpSecure
          },
          mailjet: {
            apiKey: mailjetApiKey,
            secretKey: mailjetSecretKey,
            from: mailjetFrom || DEFAULT_FROM_EMAIL,
            fromName: mailjetFromName || DEFAULT_FROM_NAME
          },
          resend: {
            apiKey: resendApiKey,
            from: resendFrom || DEFAULT_FROM_EMAIL,
            fromName: resendFromName || DEFAULT_FROM_NAME
          }
        },
        section_suggestion_enabled,
        section_must_read_enabled,
        section_new_releases_enabled,
        section_recently_updated_enabled
      });
      const token = api.getToken();
      if (token) {
        if (parsedContest?.title && parsedContest?.theme) {
          await api.saveContest(token, {
            id: parsedContest.id,
            title: parsedContest.title,
            theme: parsedContest.theme,
            description: parsedContest.description || "",
            rules: parsedContest.rules || "",
            prize: parsedContest.prize || "",
            startsAt: parsedContest.startsAt || parsedContest.starts_at,
            endsAt: parsedContest.endsAt || parsedContest.ends_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            status: parsedContest.status || "active"
          });
        }
      }
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (e) {
      alert("قالب JSON در تنظیمات نامعتبر است. لطفاً آن را اصلاح کنید.");
    }
  };

  const saveRules = async () => {
    try {
      await onSaveSettings({ ...systemSettings, rulesText });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (error) {
      alert(error instanceof Error ? error.message : "ذخیره قوانین ممکن نشد.");
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailTo.trim()) {
      setTestEmailStatus("یک آدرس ایمیل آزمایشی وارد کنید.");
      return;
    }
    setTestEmailLoading(true);
    setTestEmailStatus("");
    const result = await api.sendTestEmail(testEmailTo.trim());
    setTestEmailStatus(result?.success ? "ایمیل آزمایشی با موفقیت ارسال شد." : result?.error || "ارسال ایمیل آزمایشی ناموفق بود.");
    setTestEmailLoading(false);
  };

  const submitReject = () => {
    if (rejectingId) {
      onRejectNovel(rejectingId, rejectReason);
      setRejectingId(null);
      setRejectReason("");
    }
  };

  const submitApprove = () => {
    if (approvingId) {
      onApproveNovel(approvingId, rejectReason); // Can attach a positive note as well
      setApprovingId(null);
      setRejectReason("");
    }
  };

  const saveEditUser = async (id: string) => {
    const token = api.getToken();
    if (token) {
      const payload: any = {
        role: editUserRole,
        level: editUserLevel,
        xp: editUserXp,
        coins: editUserCoins,
        stars: editUserStars,
        nickname: editUserNickname,
        email: editUserEmail,
        phone: editUserPhone,
        avatar: editUserAvatar,
        profile_bio: editUserBio,
        departments: editUserDepartments,
        verified_author: editVerifiedAuthor,
        verified_role: editVerifiedRole,
        email_verified: editEmailVerified,
        premiumDays: editUserPremiumDays,
        premium_plan: editPremiumPlan,
        premiumLifetime: editPremiumLifetime,
        disablePremium: editDisablePremium,
        custom_role_id: editCustomRoleId || null,
        is_staff: editIsStaff,
        blocked: editBlocked,
        publishing_blocked: editPublishingBlocked
      };
      if (editUserPassword.trim()) payload.password = editUserPassword.trim();
      const userSaved = await api.updateUser(token, id, payload);
      if (!userSaved) {
        alert("ذخیره پروفایل کاربر ناموفق بود.");
        return;
      }

      const permissionsSaved = await api.updateUserPermissions(token, id, {
        roleId: editCustomRoleId || null,
        permissions: editPermissionsText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
        isStaff: editIsStaff
      });
      if (!permissionsSaved) {
        alert("پروفایل کاربر ذخیره شد، اما ذخیره دسترسی‌ها ناموفق بود.");
        return;
      }
      setEditingUserId(null);
      loadUsers();
    }
  };

  const saveUserAccess = async (id: string) => {
    const token = api.getToken();
    if (!token) return alert("احراز هویت نشده است");
    const roleSaved = await api.updateUser(token, id, { role: editUserRole });
    if (!roleSaved) return alert("به‌روزرسانی نقش کاربر ناموفق بود.");
    const permissionsSaved = await api.updateUserPermissions(token, id, {
      roleId: editCustomRoleId || null,
      permissions: editPermissionsText.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      isStaff: editIsStaff
    });
    if (!permissionsSaved) return alert("به‌روزرسانی دسترسی‌های کاربر ناموفق بود.");
    setPermissionEditingUserId(null);
    await loadUsers();
  };

  const resetRoleEditor = () => {
    setRoleEditorId(null);
    setRoleName("");
    setRoleDescription("");
    setRolePermissions([]);
  };

  const startEditRole = (role: any) => {
    setRoleEditorId(role.id);
    setRoleName(role.name || "");
    setRoleDescription(role.description || "");
    setRolePermissions(Array.isArray(role.permissions) ? role.permissions : []);
  };

  const saveCustomRoleFromForm = async () => {
    const token = api.getToken();
    if (!token) return alert("احراز هویت نشده است");
    const payload = {
      name: roleName.trim(),
      description: roleDescription.trim(),
      permissions: rolePermissions
    };
    if (!payload.name) return alert("نام نقش الزامی است.");
    const result = roleEditorId
      ? await api.updateCustomRole(token, roleEditorId, payload)
      : await api.saveCustomRole(token, payload);
    if (result?.success) {
      setCustomRoles(await api.getCustomRoles(token));
      resetRoleEditor();
      await loadUsers();
    } else {
      alert(result?.error || "ذخیره نقش ناموفق بود.");
    }
  };

  const deleteCustomRoleFromForm = async (roleId: string) => {
    if (!window.confirm("این نقش سفارشی حذف و از کاربران اختصاص‌یافته برداشته شود؟")) return;
    const token = api.getToken();
    if (!token) return alert("احراز هویت نشده است");
    const result = await api.deleteCustomRole(token, roleId);
    if (result?.success) {
      setCustomRoles(await api.getCustomRoles(token));
      if (roleEditorId === roleId) resetRoleEditor();
      await loadUsers();
    } else {
      alert(result?.error || "حذف نقش ناموفق بود.");
    }
  };

  const purgeUser = async (id: string) => {
    if(!window.confirm("از حذف دائمی این کاربر مطمئن هستید؟")) return;
    const token = api.getToken();
    if (token) {
      const deleted = await api.deleteUser(token, id);
      if (!deleted) return alert("حذف کاربر ممکن نشد. صفحه را بازخوانی و دوباره تلاش کنید.");
      await loadUsers();
    }
  };

  // Publisher: see novels that are pending approval
  const pendingNovels = novels.filter((novel) => getNovelApprovalStatus(novel) === "pending_approval");
  const allNovelsList = novels;

  return (
      <div className="authority-panel space-y-5 sm:space-y-6 pb-16 min-w-0 overflow-x-hidden">
      {/* Header Banner info */}
      <div className={`p-4 md:p-5 2xl:p-6 rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex flex-col 2xl:flex-row items-start 2xl:items-center justify-between gap-4 ${activeTheme.shadow}`}>
        <div className="flex min-w-0 items-center gap-3 text-left">
          <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-sans">کنسول مدیریت</h1>
            <p className="text-xs text-slate-500 font-medium">
              Active Role: <span className="text-purple-400 font-bold">{getAccessLabel(userRole)}</span>
            </p>
          </div>
        </div>

        {/* Quick Tabs depending on Role */}
        <div className={`w-full max-w-full p-1 rounded-xl border ${isDark ? "bg-[#0e0a1c]/60 border-violet-950/25" : "bg-stone-100 border-stone-200"} grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:flex 2xl:flex-wrap items-stretch 2xl:items-center gap-1 select-none font-mono text-[10px] sm:text-[11px] overflow-x-auto`}>
          {userRole !== "writer" && (
            <button
              onClick={() => setActiveSegment("publisher")}
              className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                activeSegment === "publisher" ? "bg-violet-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="min-w-0 truncate">صف ناشر ({pendingNovels.length})</span>
            </button>
          )}

          {userRole === "owner" && (
            <>
              <button
                onClick={() => setActiveSegment("owner")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "owner" ? "bg-purple-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">داشبورد اصلی مالک</span>
              </button>

              <button
                onClick={() => setActiveSegment("settings")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "settings" ? "bg-amber-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">تنظیمات پلتفرم</span>
              </button>

              <button
                onClick={() => setActiveSegment("users")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "users" ? "bg-fuchsia-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">کاربران</span>
              </button>

              <button
                onClick={() => setActiveSegment("operations")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "operations" ? "bg-rose-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">نظارت و عملیات</span>
              </button>

              <button
                onClick={() => setActiveSegment("backup")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "backup" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">پشتیبان‌گیری</span>
              </button>

              <button
                onClick={() => setActiveSegment("audit")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "audit" ? "bg-slate-700 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">گزارش ممیزی</span>
              </button>

              <button
                onClick={() => setActiveSegment("monitor")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "monitor" ? "bg-green-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">پایش</span>
              </button>

              <button
                onClick={() => setActiveSegment("categories")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "categories" ? "bg-fuchsia-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Tags className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">دسته‌بندی‌ها</span>
              </button>

              <button
                onClick={() => setActiveSegment("challenges")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "challenges" ? "bg-orange-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">چالش‌های روزانه</span>
              </button>

              <button
                onClick={() => setActiveSegment("events")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "events" ? "bg-cyan-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">ایونت‌ها</span>
              </button>

              <button
                onClick={() => setActiveSegment("email")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "email" ? "bg-sky-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">ایمیل سرور</span>
              </button>


              <button
                onClick={() => setActiveSegment("tickets")}
                className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                  activeSegment === "tickets" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span className="min-w-0 truncate">تیکت‌های پشتیبانی</span>
              </button>
            </>
          )}

          {(userRole === "owner" || userRole === "publisher") && (
            <button
              onClick={() => setActiveSegment("rules")}
              className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                activeSegment === "rules" ? "bg-violet-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="min-w-0 truncate">قوانین</span>
            </button>
          )}

          {userRole === "publisher" && (
            <button
              onClick={() => setActiveSegment("tickets")}
              className={`min-w-0 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all text-center 2xl:whitespace-nowrap ${
                activeSegment === "tickets" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-450 hover:text-slate-100"
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span className="min-w-0 truncate">تیکت‌های پشتیبانی</span>
            </button>
          )}
        </div>
      </div>

      {/* Segment 1: Publisher Queue */}
      {activeSegment === "publisher" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-extrabold tracking-tight">صف انتظار تأیید</h2>
          </div>

          <p className="text-xs text-slate-500 text-left">
            پیش‌نویس‌ها را بررسی و تأیید یا رد کنید. هنگام رد کردن یادداشت بنویسید.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingNovels.map((novel) => (
              <div 
                key={novel.id}
                className={`p-5 rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex flex-col justify-between gap-4 text-left ${activeTheme.shadow}`}
              >
                <div className="flex gap-4">
                  <img
                    src={novel.coverUrl || novel.cover}
                    alt={novel.title}
                    referrerPolicy="no-referrer"
                    className="w-16 h-24 rounded-lg object-cover bg-slate-900 border border-black/15 shrink-0"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase ${novel.approvalStatus === 'rejected' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                      {novel.approvalStatus}
                    </span>
                    <h3 className="font-extrabold text-base truncate pt-1">{novel.title}</h3>
                    <p className="text-xs text-slate-500">نوشته {novel.author}</p>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed pt-1">
                      {novel.description}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-3 border-t border-slate-700/10 dark:border-violet-950/15">
                  <button
                    onClick={() => { setApprovingId(novel.id); setRejectReason("آفرین! برای نمایش عمومی تأیید شد."); }}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white rounded-xl text-xs font-black font-mono uppercase tracking-wider transition-all cursor-pointer shadow-sm shadow-emerald-500/10"
                  >
                    ✓ Verify & Publish
                  </button>
                  <button
                    onClick={() => { setRejectingId(novel.id); setRejectReason(novel.editorNote || "توضیحات را بهبود دهید."); }}
                    className="px-4 py-2 border border-rose-500/20 hover:border-rose-500 bg-rose-500/5 hover:bg-rose-500/15 text-rose-450 rounded-xl text-xs font-black font-mono uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Reject / Note → رد / یادداشت placeholder fix
                  </button>
                </div>
              </div>
            ))}

            {pendingNovels.length === 0 && (
              <div className="col-span-2 text-center p-12 bg-slate-500/5 border border-dashed border-slate-800/10 dark:border-violet-950/20 rounded-2xl py-12">
                <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto opacity-40 mb-3" />
                <h3 className="font-bold text-sm">موردی برای بررسی نیست</h3>
                <p className="text-xs text-slate-500 mt-1">در حال حاضر هیچ پیش‌نویس رمانی در انتظار ممیزی انطباق نیست.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Segment 2: Owner Master Board */}
      {(activeSegment === "owner" || activeSegment === "users") && (
        // Both sections span the full width and stack. They used to share a 7/5
        // column split, which crushed the user-management controls (role editor,
        // bulk toolbar, user rows) into a narrow sidebar and pushed them outside
        // their card.
        <div className="flex flex-col gap-6 items-stretch min-w-0">

          {activeSegment === "owner" && <div className="space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight">کتابخانهٔ پلتفرم</h2>
                <p className="text-xs text-slate-500">
                  آمار کلی، جست‌وجو و فیلتر، و بررسی یا حذف هر اثر — بدون نیاز به مرور کل فهرست.
                </p>
              </div>
            </div>

            {/* The old table showed only title, author, a raw status string and a
                delete button; an owner could not search, sort or see any metric. */}
            <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">در حال بارگذاری کتابخانه…</div>}>
              <OwnerLibraryBoard
                novels={allNovelsList}
                theme={theme}
                borderClass={activeTheme.border}
                cardClass={activeTheme.card}
                shadowClass={activeTheme.shadow}
                controlClass={adminControlClass}
                selectStyle={adminSelectStyle}
                onApprove={(novelId) => {
                  setApprovingId(novelId);
                  setRejectReason("آفرین! برای نمایش عمومی تأیید شد.");
                }}
                onReject={(novelId) => {
                  const target = allNovelsList.find((item) => item.id === novelId);
                  setRejectingId(novelId);
                  setRejectReason(target?.editorNote || "توضیحات را بهبود دهید.");
                }}
                onDelete={onDeleteNovel}
              />
            </Suspense>
          </div>}

          <div className="space-y-4 min-w-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight">مدیریت کاربران</h2>
                <p className="text-xs text-slate-500">مشاهده همه حساب‌ها، تعیین نقش‌ها، اعطای دسترسی مدیر، تأیید کاربران/نویسندگان، مدیریت پرمیوم، مسدودسازی ورود یا انتشار و حذف حساب‌ها.</p>
              </div>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="جستجوی کاربران..."
                className={`w-full md:w-64 p-2 text-xs rounded border focus:outline-none focus:border-fuchsia-500 ${
                  isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"
                }`}
              />
            </div>

            {activeSegment === "users" && userRole === "owner" && (
              <form onSubmit={sendAdminCommunication} className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-4 ${activeTheme.shadow}`}>
                <div className="flex items-start gap-2"><Bell className="w-5 h-5 text-fuchsia-400 shrink-0" /><div><h3 className="text-sm font-bold">ارتباط با کاربران</h3><p className="text-[10px] text-slate-500">ارسال اعلان داخلی، ایمیل یا هر دو به کاربران منتخب یا همه.</p></div></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select value={communicationScope} onChange={(e) => setCommunicationScope(e.target.value as any)} style={adminSelectStyle} className={`p-3 rounded-xl border text-xs ${adminControlClass}`}>
                    <option value="selected">کاربران انتخاب‌شده ({selectedUsersIds.length})</option>
                    <option value="all">همه کاربران ({platformUsers.length})</option>
                  </select>
                  <select value={communicationDelivery} onChange={(e) => setCommunicationDelivery(e.target.value as any)} style={adminSelectStyle} className={`p-3 rounded-xl border text-xs ${adminControlClass}`}>
                    <option value="notification">اعلان داخلی</option>
                    <option value="email">ایمیل</option>
                    <option value="both">اعلان + ایمیل</option>
                  </select>
                  <input value={communicationTitle} onChange={(e) => setCommunicationTitle(e.target.value)} maxLength={140} required placeholder="عنوان اعلان / موضوع ایمیل" className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                  <input value={communicationLink} onChange={(e) => setCommunicationLink(e.target.value)} maxLength={500} placeholder="لینک اختیاری رپتوک، مثلاً /discover" className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                </div>
                <textarea value={communicationMessage} onChange={(e) => setCommunicationMessage(e.target.value)} maxLength={10000} required rows={5} placeholder="پیام را بنویسید..." className={`w-full p-3 rounded-xl border text-xs resize-y ${adminControlClass}`} />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><span className="text-[10px] text-slate-500">{communicationScope === "all" ? `${platformUsers.length} گیرنده` : `${selectedUsersIds.length} گیرنده انتخاب‌شده`}</span><button type="submit" disabled={communicationSending || (communicationScope === "selected" && selectedUsersIds.length === 0)} className="px-5 py-2.5 rounded-xl bg-fuchsia-600 text-white text-xs font-bold disabled:opacity-50">{communicationSending ? "در حال ارسال..." : "ارسال پیام"}</button></div>
                {communicationStatus && <p className={`text-xs ${communicationStatus.startsWith("ارسال") ? "text-emerald-400" : "text-rose-400"}`}>{communicationStatus}</p>}
              </form>
            )}

            <div className={`p-3 sm:p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-4 ${activeTheme.shadow}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-mono font-bold text-slate-400">نقش‌های سفارشی و دسترسی‌ها</h3>
                  <p className="text-[10px] text-slate-500">ایجاد، ویرایش، حذف و اختصاص نقش‌های واقعی دسترسی.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={resetRoleEditor}
                    className={`px-3 py-2 rounded-lg border text-[10px] font-bold ${isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"}`}
                  >
                    نقش جدید
                  </button>
                  <button type="button" onClick={saveCustomRoleFromForm} className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold">
                    {roleEditorId ? "ذخیره نقش" : "ایجاد نقش"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 items-start xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
                <div className={`rounded-xl border p-4 space-y-4 min-w-0 ${isDark ? "bg-slate-950/55 border-slate-800" : "bg-stone-50 border-stone-200"}`}>
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono font-black uppercase tracking-wide text-fuchsia-500">
                        {roleEditorId ? "ویرایش نقش" : "طراحی نقش"}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">ابتدا هویت نقش را مشخص کنید، سپس دسترسی‌های گروه‌بندی‌شده را در پایین انتخاب کنید.</p>
                    </div>
                    <div className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold ${rolePermissions.length ? "bg-fuchsia-500/10 text-fuchsia-300" : "bg-slate-500/10 text-slate-500"}`}>
                      {rolePermissions.length} انتخاب شد
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <label className="space-y-1 text-left">
                      <span className="text-[10px] font-mono font-bold uppercase text-slate-500">نام نقش</span>
                      <input
                        value={roleName}
                        onChange={(e) => setRoleName(e.target.value)}
                        placeholder="مدیر ارشد"
                        className={`w-full rounded-lg border p-2.5 text-xs outline-none focus:border-fuchsia-500 ${isDark ? "bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-600" : "bg-white border-stone-200 text-stone-900 placeholder:text-stone-400"}`}
                      />
                    </label>
                    <label className="space-y-1 text-left">
                      <span className="text-[10px] font-mono font-bold uppercase text-slate-500">توضیحات</span>
                      <input
                        value={roleDescription}
                        onChange={(e) => setRoleDescription(e.target.value)}
                        placeholder="می‌تواند محتوا را بررسی و تیکت‌ها را رسیدگی کند"
                        className={`w-full rounded-lg border p-2.5 text-xs outline-none focus:border-fuchsia-500 ${isDark ? "bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-600" : "bg-white border-stone-200 text-stone-900 placeholder:text-stone-400"}`}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                    {PERMISSION_GROUPS.map((group) => (
                      <div key={group.title} className={`rounded-xl border p-3 space-y-3 ${isDark ? "border-slate-800 bg-black/20" : "border-stone-200 bg-white"}`}>
                        <div className="min-w-0">
                          <div className={`text-[11px] font-bold ${isDark ? "text-slate-200" : "text-stone-800"}`}>{group.title}</div>
                          <div className="text-[9px] text-slate-500 leading-relaxed">{group.description}</div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {group.permissions.map((permission) => {
                            const checked = rolePermissions.includes(permission);
                            return (
                              <label
                                key={permission}
                                className={`flex min-w-0 items-start gap-2 rounded-lg border p-2 text-[10px] cursor-pointer transition ${
                                  checked
                                    ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-300"
                                    : isDark
                                      ? "border-slate-800 text-slate-400 hover:border-slate-700"
                                      : "border-stone-200 text-stone-600 hover:border-fuchsia-300"
                                }`}
                              >
                                <input
                                  className="mt-0.5 shrink-0 accent-fuchsia-500"
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setRolePermissions(e.target.checked
                                      ? [...new Set([...rolePermissions, permission])]
                                      : rolePermissions.filter((item) => item !== permission)
                                    );
                                  }}
                                />
                                {/* Permission keys are long; wrapping them keeps
                                    the whole key readable instead of truncating
                                    it to an ambiguous prefix. */}
                                <span className="min-w-0 break-all font-mono leading-relaxed" title={permission}>{permission}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`rounded-xl border p-4 space-y-3 min-w-0 ${isDark ? "bg-slate-950/55 border-slate-800" : "bg-stone-50 border-stone-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-mono font-black uppercase tracking-wide text-slate-400">نقش‌های موجود</div>
                      <p className="text-[10px] text-slate-500">{customRoles.length} نقش ذخیره‌شده</p>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 min-w-0">
                    {customRoles.length === 0 ? (
                      <div className={`rounded-xl border border-dashed p-5 text-center text-xs ${isDark ? "border-slate-800 text-slate-500" : "border-stone-300 text-stone-500"}`}>هنوز نقش سفارشی وجود ندارد.</div>
                    ) : customRoles.map((role) => (
                      <div key={role.id} className={`rounded-xl border p-3 space-y-2 ${isDark ? "border-slate-800 bg-slate-950/40" : "border-stone-200 bg-white"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-xs truncate">{role.name}</div>
                            <div className="text-[10px] text-slate-500 line-clamp-2">{role.description || "بدون توضیحات"}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button type="button" onClick={() => startEditRole(role)} className={`p-1.5 rounded border ${isDark ? "border-slate-700 text-slate-300 hover:text-white" : "border-stone-200 text-stone-600 hover:text-stone-900"}`}>
                              <Edit className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={() => deleteCustomRoleFromForm(role.id)} className="p-1.5 rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500 hover:text-white">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(role.permissions || []).slice(0, 8).map((permission: string) => (
                            <span key={permission} className="rounded bg-fuchsia-500/10 px-1.5 py-0.5 text-[9px] text-fuchsia-300">{permission}</span>
                          ))}
                          {(role.permissions || []).length > 8 && <span className="text-[9px] text-slate-500">+{(role.permissions || []).length - 8}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Verify Author Form */}
            <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3 ${activeTheme.shadow}`}>
              <h3 className="text-xs font-mono font-bold text-slate-400">تأیید نویسنده</h3>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const input = form.elements.namedItem('verifyUsername') as HTMLInputElement;
                if (!input.value) return;
                
                try {
                  const token = api.getToken();
                  const res = await fetch("/api/admin/verify_author", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": token || "" },
                    credentials: "same-origin",
                    body: JSON.stringify({ username: input.value })
                  });
                  const result = await res.json();
                  if (result.success) {
                      alert(`موفق: ${result.message}`);
                    input.value = "";
                    loadUsers();
                  } else {
                    alert(`خطا: ${result.error}`);
                  }
                } catch(err) {
                  alert("تأیید نویسنده ناموفق بود.");
                }
              }} className="flex flex-col sm:flex-row gap-2">
                <input 
                  type="text" 
                  name="verifyUsername" 
                  placeholder="نام کاربری مشخص را وارد کنید..." 
                  required
                  className={`flex-1 min-w-0 p-2 text-xs rounded border focus:outline-none focus:border-amber-500 transition-colors ${
                    isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"
                  }`}
                />
                <button type="submit" className="px-3 py-2 bg-violet-600 text-white rounded font-bold text-xs hover:bg-violet-500 cursor-pointer whitespace-nowrap">
                  تأیید نویسنده
                </button>
              </form>
            </div>
            
            <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3 ${activeTheme.shadow}`}>
              <h3 className="text-xs font-mono font-bold text-slate-400">اعطای نقش تأییدشده</h3>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const input = form.elements.namedItem('verifyRoleUsername') as HTMLInputElement;
                if (!input.value) return;
                
                try {
                  const token = api.getToken();
                  const res = await fetch("/api/admin/verify_role", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": token || "" },
                    credentials: "same-origin",
                    body: JSON.stringify({ username: input.value })
                  });
                  const result = await res.json();
                  if (result.success) {
                      alert(`موفق: ${result.message}`);
                    input.value = "";
                    loadUsers();
                  } else {
                    alert(`خطا: ${result.error}`);
                  }
                } catch(err) {
                  alert("اعطای نقش تأییدشده ناموفق بود.");
                }
              }} className="flex flex-col sm:flex-row gap-2">
                <input 
                  type="text" 
                  name="verifyRoleUsername" 
                  placeholder="نام کاربری مشخص را وارد کنید..." 
                  required
                  className={`flex-1 min-w-0 p-2 text-xs rounded border focus:outline-none focus:border-emerald-500 transition-colors ${
                    isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"
                  }`}
                />
                <button type="submit" className="px-3 py-2 bg-emerald-600 text-white rounded font-bold text-xs hover:bg-emerald-500 cursor-pointer whitespace-nowrap">
                  اعطای نقش تأییدشده
                </button>
              </form>
            </div>

            <div className={`p-3 sm:p-4 text-xs rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-4 ${activeTheme.shadow}`}>
              {loadingUsers ? <p className="text-center p-4">در حال بارگذاری هسته کاربران...</p> : (
              <div className="space-y-2.5">
                {/* Selection + filters. Each control is labelled and sized on a
                    grid; they used to be an unlabelled flex row that overflowed
                    the card on anything narrower than a desktop. */}
                <div className={`space-y-3 rounded-xl border p-3 ${isDark ? "border-slate-800 bg-black/20" : "border-stone-200 bg-stone-50"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="inline-flex items-center gap-2 text-[12px] font-bold">
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-fuchsia-500" onChange={(e) => {
                        if (e.target.checked) setSelectedUsersIds(platformUsers.map(u => u.id));
                        else setSelectedUsersIds([]);
                      }} checked={selectedUsersIds.length === platformUsers.length && platformUsers.length>0} />
                      <span>انتخاب همه</span>
                    </label>
                    <span className={`rounded-lg px-2 py-1 text-[11px] font-black ${selectedUsersIds.length ? "bg-fuchsia-500/15 text-fuchsia-300" : "bg-slate-500/10 text-slate-500"}`}>
                      {selectedUsersIds.length.toLocaleString("fa-IR")} انتخاب‌شده
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                      کل کاربران: {platformUsers.length.toLocaleString("fa-IR")}
                    </span>
                    {selectedUsersIds.length > 0 && (
                      <button type="button" onClick={() => setSelectedUsersIds([])} className="text-[11px] font-bold text-slate-500 hover:text-rose-400">
                        لغو انتخاب
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0 space-y-1">
                      <span className="block text-[9px] font-mono font-bold uppercase text-slate-500">وضعیت پرمیوم</span>
                      <select value={premiumUserFilter} onChange={e=>setPremiumUserFilter(e.target.value)} style={adminSelectStyle} className={`w-full min-w-0 rounded-lg border p-2 text-xs ${adminControlClass}`}><option value="">همه وضعیت‌های پرمیوم</option><option value="reader">پرمیوم خواننده فعال</option><option value="writer">پرمیوم نویسنده فعال</option><option value="both">هر دو فعال</option><option value="none">بدون پرمیوم</option><option value="permanent">منبع دائمی</option><option value="expired">منبع منقضی‌شده</option><option value="expiring">انقضا تا 30 روز آینده</option></select>
                    </label>
                    <label className="min-w-0 space-y-1">
                      <span className="block text-[9px] font-mono font-bold uppercase text-slate-500">منبع دسترسی</span>
                      <select aria-label="منبع دسترسی پرمیوم" value={premiumSourceFilter} onChange={e=>setPremiumSourceFilter(e.target.value)} style={adminSelectStyle} className={`w-full min-w-0 rounded-lg border p-2 text-xs ${adminControlClass}`}><option value="">همه منابع دسترسی</option>{['paid_subscription','admin_grant','promotion','trial','gift','migration','support_compensation','other'].map(source=><option key={source} value={source}>{source.replaceAll('_',' ')}</option>)}</select>
                    </label>
                    <label className="min-w-0 space-y-1">
                      <span className="block text-[9px] font-mono font-bold uppercase text-slate-500">فعال‌سازی در</span>
                      <input aria-label="تاریخ فعال‌سازی پرمیوم" type="date" value={premiumActivationFilter} onChange={e=>setPremiumActivationFilter(e.target.value)} style={adminSelectStyle} className={`w-full min-w-0 rounded-lg border p-2 text-xs ${adminControlClass}`}/>
                    </label>
                    <label className="min-w-0 space-y-1">
                      <span className="block text-[9px] font-mono font-bold uppercase text-slate-500">انقضا در</span>
                      <input aria-label="تاریخ انقضای پرمیوم" type="date" value={premiumExpirationFilter} onChange={e=>setPremiumExpirationFilter(e.target.value)} style={adminSelectStyle} className={`w-full min-w-0 rounded-lg border p-2 text-xs ${adminControlClass}`}/>
                    </label>
                  </div>

                  <Suspense fallback={null}><PremiumBulkManagement userIds={selectedUsersIds} onComplete={() => { setSelectedUsersIds([]); loadUsers(); }} /></Suspense>
                </div>

                {/* Bulk actions. Each select is paired with its own button so it
                    is obvious which action a button applies. */}
                <div className={`grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-2 xl:grid-cols-3 ${isDark ? "border-slate-800 bg-black/20" : "border-stone-200 bg-stone-50"}`}>
                    <div className="flex min-w-0 items-end gap-2">
                    <select id="batchRoleSelect" aria-label="نقش گروهی" style={adminSelectStyle} className={`min-w-0 flex-1 rounded-lg border p-2 text-xs ${adminControlClass}`}>
                      <option value="">تغییر نقش...</option>
                      <option value="writer">نویسنده</option>
                      <option value="editor">ویراستار</option>
                      <option value="publisher">ناشر</option>
                      {userRole === "owner" && <option value="owner">مالک</option>}
                    </select>
                    <button onClick={async () => {
                      const sel: string[] = [...selectedUsersIds];
                      if (sel.length === 0) return alert('هیچ کاربری انتخاب نشده است');
                      const role = (document.getElementById('batchRoleSelect') as HTMLSelectElement).value;
                      if (!role) return alert('یک نقش انتخاب کنید');
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      for (const id of sel) {
                        await api.updateUser(token, id, { role });
                      }
                      alert('نقش‌ها به‌روزرسانی شد');
                      setSelectedUsersIds([]);
                      loadUsers();
                    }} className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500">اعمال</button>
                    </div>

                    <div className="flex min-w-0 items-end gap-2">
                    <select id="batchAchievementSelect" aria-label="دستاورد گروهی" style={adminSelectStyle} className={`min-w-0 flex-1 rounded-lg border p-2 text-xs ${adminControlClass}`}>
                      <option value="">اعطای دستاورد...</option>
                      {achievementsList.map(a => (<option key={a.id} value={a.id}>{a.title || a.id}</option>))}
                    </select>
                    <button onClick={async () => {
                      const aid = (document.getElementById('batchAchievementSelect') as HTMLSelectElement).value;
                      if (!aid) return alert('دستاورد را انتخاب کنید');
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      for (const id of selectedUsersIds) {
                        await api.grantAchievement(token, id, aid);
                      }
                      alert('دستاوردها اعطا شد');
                      setSelectedUsersIds([]);
                      loadUsers();
                    }} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">اعطا</button>
                    </div>

                    <div className="flex min-w-0 items-end gap-2 sm:col-span-2 xl:col-span-1">
                    <select id="batchPremiumAction" aria-label="عملیات گروهی پرمیوم" style={adminSelectStyle} className={`min-w-0 flex-1 rounded-lg border p-2 text-xs ${adminControlClass}`}>
                      <option value="grant:reader">اعطای پرمیوم خواننده</option><option value="grant:writer">اعطای پرمیوم نویسنده</option><option value="grant:both">اعطای هر دو طرح</option><option value="extend:reader">تمدید خواننده</option><option value="extend:writer">تمدید نویسنده</option><option value="revoke:reader">لغو خواننده</option><option value="revoke:writer">لغو نویسنده</option>
                    </select>
                    <button onClick={async () => {
                      if (!selectedUsersIds.length) return alert('حداقل یک کاربر انتخاب کنید');
                      const [action, selectedType] = (document.getElementById('batchPremiumAction') as HTMLSelectElement).value.split(':');
                      const reason = prompt('دلیل داخلی برای هر سابقه ممیزی'); if (!reason) return;
                      const premiumTypes = selectedType === 'both' ? ['reader','writer'] : [selectedType];
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      const options = { source: 'admin_grant', reason, durationSeconds: 30 * 86400, extensionMode: 'add' };
                      const preview = await fetch('/api/admin/premium/bulk/preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({userIds:selectedUsersIds,action,premiumTypes,options})}).then(r=>r.json());
                      if (!confirm(`${action} ${premiumTypes.join(' + ')} برای ${preview.count || 0} کاربر اجرا شود؟ هر کاربر یک سابقه ممیزی تغییرناپذیر جداگانه دریافت می‌کند.`)) return;
                      const result = await fetch('/api/admin/premium/bulk',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({confirm:true,userIds:selectedUsersIds,action,premiumTypes,options})}).then(r=>r.json());
                      const failed=(result.results||[]).filter((x:any)=>x.error).length; alert(`عملیات گروهی پرمیوم کامل شد. ${failed} مورد ناموفق بود.`); loadUsers();
                    }} className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500">اجرا</button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-3">
                    <button onClick={async () => {
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      const csv = await api.exportUsersCsv(token);
                      if (!csv) return alert('خروجی گرفتن ناموفق بود');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'users_export.csv'; a.click(); URL.revokeObjectURL(url);
                    }} className="px-2 py-1 bg-slate-700 text-white rounded text-xs">خروجی CSV</button>

                    <input id="importUsersFile" type="file" accept="text/csv" style={{ display: 'none' }} onChange={async (e) => {
const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const txt = await f.text(); const token = api.getToken(); if (!token) return alert('احراز هویت نشده است'); const r = await api.importUsersCsv(token, txt); if (r && r.success) { alert(`${r.created} کاربر وارد شد`); loadUsers(); } else alert('ورود ناموفق بود'); (e.target as HTMLInputElement).value = '';
                    }} />
                    <button onClick={() => { const inp = document.getElementById('importUsersFile') as HTMLInputElement; if (inp) inp.click(); }} className="px-2 py-1 bg-slate-600 text-white rounded text-xs">ورود CSV</button>

                    <button onClick={async () => {
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      const r = await api.createBackup(token); if (r && r.success) { alert('پشتیبان ایجاد شد: ' + r.file); } else alert('ایجاد پشتیبان ناموفق بود');
                    }} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">ایجاد پشتیبان</button>

                    <button onClick={async () => {
                      if (!confirm('کاربران انتخاب‌شده برای همیشه حذف شوند؟')) return;
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      let deleted = 0;
                      for (const id of selectedUsersIds) {
                        if (await api.deleteUser(token, id)) deleted += 1;
                      }
                      alert(`${deleted} از ${selectedUsersIds.length} کاربر انتخاب‌شده حذف شد`);
                      setSelectedUsersIds([]);
                      loadUsers();
                    }} className="px-2 py-1 bg-rose-600 text-white rounded text-xs">حذف</button>
                    <button onClick={async () => {
                      // Admin 2FA generate for single selected user
                      if (selectedUsersIds.length !== 1) return alert('برای تولید مجدد 2FA دقیقاً یک کاربر انتخاب کنید');
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      const id = selectedUsersIds[0];
                      const r = await api.adminGenerate2FA(token, id);
                      if (r && r.secret) {
                        alert('2FA تولید شد — QR/رمز را به کاربر نشان دهید');
                      } else alert('تولید 2FA ناموفق بود');
                    }} className="px-2 py-1 bg-amber-600 text-white rounded text-xs">تولید 2FA</button>

                    <button onClick={async () => {
                      if (selectedUsersIds.length !== 1) return alert('برای غیرفعال‌سازی 2FA دقیقاً یک کاربر انتخاب کنید');
                      const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                      const id = selectedUsersIds[0];
                      const ok = await api.adminDisable2FA(token, id);
                      if (ok) { alert('2FA کاربر غیرفعال شد'); loadUsers(); } else alert('غیرفعال‌سازی 2FA ناموفق بود');
                    }} className="px-2 py-1 bg-rose-500 text-white rounded text-xs">غیرفعال‌سازی 2FA</button>
                    </div>
                </div>
                {usersError && (
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {usersError}
                  </div>
                )}
                {!usersError && platformUsers.length === 0 && (
                  <div className="rounded border border-dashed border-slate-700 px-3 py-6 text-center text-xs text-slate-500">
                    کاربری یافت نشد. فهرست را بازخوانی کنید یا نشست مدیر را بررسی کنید.
                  </div>
                )}
                {platformUsers.filter((user) => {
                  const q = userSearch.trim().toLowerCase();
                  if (q && ![user.id,user.username, user.email, user.nickname, user.phone, user.role].some((value) => String(value || "").toLowerCase().includes(q))) return false;
                  const p=user.premium_entitlements||{},sources=p.sources||[];
                  if(premiumUserFilter==='reader'&&!p.reader)return false;if(premiumUserFilter==='writer'&&!p.writer)return false;if(premiumUserFilter==='both'&&!(p.reader&&p.writer))return false;if(premiumUserFilter==='none'&&(p.reader||p.writer))return false;if(premiumUserFilter==='permanent'&&!sources.some((x:any)=>x.is_permanent))return false;if(premiumUserFilter==='expired'&&!sources.some((x:any)=>x.expires_at&&new Date(x.expires_at)<=new Date()))return false;if(premiumUserFilter==='expiring'&&!sources.some((x:any)=>x.expires_at&&new Date(x.expires_at)>new Date()&&new Date(x.expires_at).getTime()<Date.now()+30*86400000))return false;
                  if(premiumSourceFilter&&!sources.some((x:any)=>x.source===premiumSourceFilter))return false;
                  if(premiumActivationFilter&&!sources.some((x:any)=>String(x.starts_at||'').slice(0,10)===premiumActivationFilter))return false;
                  if(premiumExpirationFilter&&!sources.some((x:any)=>String(x.expires_at||'').slice(0,10)===premiumExpirationFilter))return false;
                  return true;
                }).map((user) => {
                  const isBlocked = !!user.blocked;
                  const isPublishingBlocked = !!user.publishing_blocked;
                  const isEditing = editingUserId === user.id;
                  const isPremiumEditing = premiumEditingUserId === user.id;
                  const isPermissionEditing = permissionEditingUserId === user.id;
                  const activePremiumSources = Array.isArray(user.premium_entitlements?.sources) ? user.premium_entitlements.sources : [];
                  const premiumUntilLabel = (type: "reader" | "writer") => {
                    const matching = activePremiumSources.filter((source: any) => source.premium_type === type);
                    if (!matching.length) return null;
                    if (matching.some((source: any) => source.is_permanent)) return "دائمی";
                    const latestExpiry = matching.reduce((latest: number, source: any) => Math.max(latest, new Date(source.expires_at || 0).getTime()), 0);
                    return latestExpiry ? new Date(latestExpiry).toLocaleDateString('fa-IR') : null;
                  };
                  const readerPremiumUntil = premiumUntilLabel("reader");
                  const writerPremiumUntil = premiumUntilLabel("writer");

                  return (
                    <div 
                      key={user.id}
                      className={`p-3 rounded-xl border flex flex-col text-left justify-between gap-3 ${
                        isBlocked 
                          ? "bg-rose-500/5 border-rose-950/20 text-rose-450" 
                          : "bg-black/10 dark:bg-black/25 border-slate-700/5 dark:border-violet-950/10"
                      }`}
                    >
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input type="checkbox" checked={selectedUsersIds.includes(user.id)} onChange={(e) => {
                              if (e.target.checked) setSelectedUsersIds([...selectedUsersIds, user.id]);
                              else setSelectedUsersIds(selectedUsersIds.filter(s => s !== user.id));
                            }} className="h-4 w-4 shrink-0 accent-fuchsia-500" />
                            <span className="font-extrabold font-sans text-xs">{user.username}</span>
                            <span className="text-[7px] font-mono px-1 rounded bg-slate-700 text-slate-350">{user.role} سطح {user.level}</span>
                            {user.is_staff && <span className="text-[7px] font-mono px-1 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/20">مدیر</span>}
                            {user.verified_role && <span className="text-[7px] font-mono px-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">تأییدشده</span>}
                            {user.verified_author && <span className="text-[7px] font-mono px-1 rounded bg-violet-500/15 text-violet-300 border border-violet-500/20">نویسنده تأییدشده</span>}
                            {isBlocked && <span className="text-[7px] font-mono px-1 rounded bg-rose-500/15 text-rose-300 border border-rose-500/20">ورود مسدود</span>}
                            {isPublishingBlocked && <span className="text-[7px] font-mono px-1 rounded bg-orange-500/15 text-orange-300 border border-orange-500/20">انتشار مسدود</span>}
                          </div>
                          {(user.premium_entitlements?.reader || user.premium_entitlements?.writer) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-yellow-400 text-yellow-950 border border-yellow-300 shadow-sm">پرمیوم</span>
                              {user.premium_entitlements?.reader && <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-400/50">پرمیوم خواننده</span>}
                              {user.premium_entitlements?.writer && <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-400/50">پرمیوم نویسنده</span>}
                            </div>
                          )}
                          <p className="text-[10px] text-slate-500 break-words mt-0.5">{user.email || "بدون ایمیل"} | عضویت: {new Date(user.created_at).toLocaleDateString('fa-IR')}{readerPremiumUntil ? ` | خواننده تا ${readerPremiumUntil}` : ""}{writerPremiumUntil ? ` | نویسنده تا ${writerPremiumUntil}` : ""}{!readerPremiumUntil&&!writerPremiumUntil ? " | بدون پرمیوم فعال" : ""}</p>
                        </div>

                        {/* Account facts as discrete chips. As one pipe-joined
                            sentence this overflowed the row and could not wrap at
                            a meaningful point. */}
                        <div className="flex min-w-0 flex-wrap items-start gap-1.5 xl:max-w-sm xl:justify-end">
                          {[
                            user.nickname || "بدون نام مستعار",
                            user.phone || "بدون شماره تماس",
                            user.email_verified ? "ایمیل تأیید شده" : "ایمیل تأیید نشده",
                            `رمان‌ها: ${Number(user.counts?.novels || 0).toLocaleString("fa-IR")}`,
                            `نقدها: ${Number(user.counts?.reviews || 0).toLocaleString("fa-IR")}`,
                            `تیکت‌ها: ${Number(user.counts?.tickets || 0).toLocaleString("fa-IR")}`,
                          ].map((fact, index) => (
                            <span
                              key={index}
                              className={`max-w-full truncate rounded px-1.5 py-0.5 text-[9px] font-bold ${isDark ? "bg-slate-800/70 text-slate-400" : "bg-stone-100 text-stone-600"}`}
                              title={fact}
                            >
                              {fact}
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 xl:shrink-0 xl:justify-end">
                          <button
                            onClick={() => { 
                              setEditingUserId(isEditing ? null : user.id); 
                              setPremiumEditingUserId(null);
                              setPermissionEditingUserId(null);
                              setEditUserRole(user.role); 
                              setEditUserLevel(user.level); 
                              setEditUserXp(user.xp || 0);
                              setEditUserCoins(user.coins || 0);
                              setEditUserStars(user.stars || 0); 
                              setEditUserNickname(user.nickname || "");
                              setEditUserEmail(user.email || "");
                              setEditUserPhone(user.phone || "");
                              setEditUserAvatar(user.avatar || "");
                              setEditUserBio(user.bio || user.profile_bio || "");
                              setEditVerifiedAuthor(!!user.verified_author);
                              setEditVerifiedRole(!!user.verified_role);
                              setEditEmailVerified(!!user.email_verified);
                              setEditUserPassword(""); 
                              setEditUserPremiumDays(0);
                              setEditPremiumPlan(user.premium_plan || "manual");
                              setEditPremiumLifetime(!!user.premium_lifetime);
                              setEditDisablePremium(false);
                              setEditIsStaff(!!user.is_staff);
                              setEditBlocked(!!user.blocked);
                              setEditPublishingBlocked(!!user.publishing_blocked);
                              setEditCustomRoleId(user.custom_role_id || user.customRole?.id || "");
                              setEditPermissionsText((user.permissions || []).join("\n"));
                              let parsedDeps: string[] = [];
                              if (user.departments) {
                                try { parsedDeps = typeof user.departments === 'string' ? JSON.parse(user.departments) : user.departments; } catch(e){}
                              }
                              setEditUserDepartments(parsedDeps);
                            }}
                            className="p-1.5 rounded-lg border transition-all cursor-pointer bg-slate-800 text-slate-300 border-slate-700 hover:text-white"
                            title={isEditing ? "بستن تنظیمات کاربر" : "ویرایش تنظیمات کاربر"}
                          >
                           <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPermissionEditingUserId(isPermissionEditing ? null : user.id);
                              setPremiumEditingUserId(null);
                              setEditingUserId(null);
                              setEditUserRole(user.role || "writer");
                              setEditCustomRoleId(user.custom_role_id || user.customRole?.id || "");
                              setEditPermissionsText((user.permissions || []).join("\n"));
                              setEditIsStaff(!!user.is_staff);
                            }}
                            className={`px-2 py-1 rounded-lg border transition-all shrink-0 cursor-pointer text-[10px] font-bold flex items-center gap-1 ${
                              isPermissionEditing
                                ? "bg-fuchsia-500 border-fuchsia-400 text-slate-950"
                                : "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-slate-950"
                            }`}
                            title={isPermissionEditing ? "بستن دسترسی‌ها" : "مدیریت نقش و دسترسی‌ها"}
                          >
                            <ShieldCheck className="w-3.5 h-3.5" /> Permissions
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPremiumEditingUserId(isPremiumEditing ? null : user.id);
                              setEditingUserId(null);
                              setPermissionEditingUserId(null);
                            }}
                            className={`px-2 py-1 rounded-lg border transition-all shrink-0 cursor-pointer text-[10px] font-bold flex items-center gap-1 ${
                              isPremiumEditing
                                ? "bg-amber-500 border-amber-400 text-slate-950"
                                : "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500 hover:text-slate-950"
                            }`}
                            title={isPremiumEditing ? "بستن تنظیمات پرمیوم" : "ویرایش تنظیمات پرمیوم"}
                          >
                            <Sparkles className="w-3.5 h-3.5" /> پرمیوم
                          </button>
                          <button
                            onClick={async () => {
                              const token = api.getToken();
                              if (!token) return alert("احراز هویت نشده است");
                              const ok = await api.updateUser(token, user.id, { blocked: !isBlocked });
                              if (!ok) return alert("به‌روزرسانی مسدودسازی ورود ناموفق بود.");
                              loadUsers();
                            }}
                            className={`p-1.5 rounded-lg border transition-all shrink-0 cursor-pointer ${
                              isBlocked ? "bg-rose-500 border-rose-600 text-white" : "bg-transparent border-slate-700/20 text-slate-400 hover:text-rose-500 hover:border-rose-500"
                            }`}
                            title={isBlocked ? "اجازه ورود" : "مسدودسازی ورود"}
                          >
                            {isBlocked ? <Unlock className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={async () => {
                              const token = api.getToken();
                              if (!token) return alert("احراز هویت نشده است");
                              const ok = await api.updateUser(token, user.id, { publishing_blocked: !isPublishingBlocked });
                              if (!ok) return alert("به‌روزرسانی مسدودسازی انتشار ناموفق بود.");
                              loadUsers();
                            }}
                            className={`px-2 py-1 rounded-lg border transition-all shrink-0 cursor-pointer text-[10px] font-bold ${
                              isPublishingBlocked ? "bg-orange-500 border-orange-600 text-white" : "bg-transparent border-slate-700/20 text-slate-400 hover:text-orange-400 hover:border-orange-500"
                            }`}
                          >
                            {isPublishingBlocked ? "اجازه انتشار" : "مسدودسازی انتشار"}
                          </button>
                          <button
                            onClick={() => purgeUser(user.id)}
                            className="p-1.5 rounded-lg border transition-all shrink-0 cursor-pointer bg-black text-rose-700 border-rose-900 hover:bg-rose-600 hover:text-white"
                          >
                           <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isPermissionEditing && (
                        <div className="pt-3 mt-2 border-t border-fuchsia-500/20 min-w-0 space-y-3">
                          <div>
                            <h4 className="text-xs font-bold text-fuchsia-300">Role and permissions for {user.username}</h4>
                            <p className="text-[10px] text-slate-500">تعیین نقش پایه، نقش سفارشی اختیاری و دسترسی‌های تکی.</p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <label className="text-[10px] text-slate-400">Base role
                              <select style={adminSelectStyle} className={`mt-1 w-full border rounded p-2 ${adminControlClass}`} value={editUserRole} onChange={e => setEditUserRole(e.target.value)}>
                                <option value="writer">نویسنده</option><option value="editor">ویراستار</option><option value="publisher">ناشر</option><option value="moderator">مدیر محتوا</option><option value="support">پشتیبانی</option><option value="owner">مالک</option>
                              </select>
                            </label>
                            <label className="text-[10px] text-slate-400">Custom role
                              <select style={adminSelectStyle} className={`mt-1 w-full border rounded p-2 ${adminControlClass}`} value={editCustomRoleId} onChange={e => setEditCustomRoleId(e.target.value)}>
                                <option value="">بدون نقش سفارشی</option>
                                {customRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {PERMISSION_GROUPS.flatMap(group => group.permissions).map(permission => {
                              const selected = editPermissionsText.split(/[\n,]/).map(item => item.trim()).includes(permission);
                              return <label key={permission} className={`flex items-center gap-2 rounded border p-2 text-[10px] cursor-pointer ${selected ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-300" : "border-slate-700 text-slate-400"}`}>
                                <input type="checkbox" checked={selected} onChange={e => {
                                  const current = editPermissionsText.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
                                  setEditPermissionsText((e.target.checked ? [...new Set([...current, permission])] : current.filter(item => item !== permission)).join("\n"));
                                }} />
                                <span className="font-mono">{permission}</span>
                              </label>;
                            })}
                          </div>
                          <textarea className="w-full bg-slate-900 border border-slate-700 rounded p-2 min-h-20 text-[10px]" value={editPermissionsText} onChange={e => setEditPermissionsText(e.target.value)} placeholder="دسترسی‌های اضافی، هر خط یک مورد" />
                          <label className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={editIsStaff} onChange={e => setEditIsStaff(e.target.checked)} /> دسترسی کارکنان/پنل مدیریت</label>
                          <button type="button" onClick={() => saveUserAccess(user.id)} className="px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold">ذخیره دسترسی‌ها</button>
                        </div>
                      )}

                      {isPremiumEditing && (
                        <div className="pt-3 mt-2 border-t border-amber-500/20 min-w-0">
                          <Suspense fallback={<div className="text-xs text-slate-500">در حال بارگذاری مدیریت پرمیوم…</div>}>
                            <PremiumManagementCards userId={user.id} onChanged={loadUsers} />
                          </Suspense>
                        </div>
                      )}

                      {/* Edit user form */}
                      {isEditing && (
                        <div className="pt-3 mt-2 border-t border-slate-800 flex flex-col gap-2 min-w-0">
                           <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_80px_80px] gap-2">
                             <select style={adminSelectStyle} className={`w-full border rounded p-1 ${adminControlClass}`} value={editUserRole} onChange={e => setEditUserRole(e.target.value)}>
                               <option value="writer">نویسنده</option>
                               <option value="editor">ویراستار</option>
                               <option value="publisher">ناشر</option>
                               <option value="owner">مالک</option>
                             </select>
                             <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-1" value={editUserLevel} onChange={e => setEditUserLevel(parseInt(e.target.value))} placeholder="سطح" />
                             <input type="number" className="w-full bg-slate-900 border border-slate-700 rounded p-1" value={editUserStars} onChange={e => setEditUserStars(parseInt(e.target.value))} placeholder="ستاره" title="ستاره‌های کاربر" />
                           </div>
                           
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                             <input type="text" className="bg-slate-900 border border-slate-700 rounded p-1" value={editUserNickname} onChange={e => setEditUserNickname(e.target.value)} placeholder="نام مستعار" />
                             <input type="email" className="bg-slate-900 border border-slate-700 rounded p-1" value={editUserEmail} onChange={e => setEditUserEmail(e.target.value)} placeholder="ایمیل" />
                             <input type="text" className="bg-slate-900 border border-slate-700 rounded p-1" value={editUserPhone} onChange={e => setEditUserPhone(e.target.value)} placeholder="شماره تماس" />
                             <input type="text" className="bg-slate-900 border border-slate-700 rounded p-1" value={editUserAvatar} onChange={e => setEditUserAvatar(e.target.value)} placeholder="URL آواتار یا حروف اول" />
                             <input type="number" className="bg-slate-900 border border-slate-700 rounded p-1" value={editUserXp} onChange={e => setEditUserXp(parseInt(e.target.value) || 0)} placeholder="XP" />
                             <input type="number" className="bg-slate-900 border border-slate-700 rounded p-1" value={editUserCoins} onChange={e => setEditUserCoins(parseInt(e.target.value) || 0)} placeholder="سکه‌ها" />
                           </div>
                           <textarea className="bg-slate-900 border border-slate-700 rounded p-2 min-h-20" value={editUserBio} onChange={e => setEditUserBio(e.target.value)} placeholder="بیوگرافی پروفایل" />
                           <div className="flex flex-wrap gap-3 text-[10px]">
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editVerifiedAuthor} onChange={e => setEditVerifiedAuthor(e.target.checked)} /> نویسنده تأییدشده</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editVerifiedRole} onChange={e => setEditVerifiedRole(e.target.checked)} /> نقش تأییدشده</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editEmailVerified} onChange={e => setEditEmailVerified(e.target.checked)} /> ایمیل تأیید شده</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editIsStaff} onChange={e => setEditIsStaff(e.target.checked)} /> دسترسی مدیر</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editPremiumLifetime} onChange={e => setEditPremiumLifetime(e.target.checked)} /> پرمیوم مادام‌العمر</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editDisablePremium} onChange={e => setEditDisablePremium(e.target.checked)} /> غیرفعال‌سازی پرمیوم</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editBlocked} onChange={e => setEditBlocked(e.target.checked)} /> مسدودسازی ورود</label>
                             <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={editPublishingBlocked} onChange={e => setEditPublishingBlocked(e.target.checked)} /> مسدودسازی انتشار</label>
                           </div>

                           <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                             <select style={adminSelectStyle} className={`border rounded p-1 ${adminControlClass}`} value={editCustomRoleId} onChange={e => setEditCustomRoleId(e.target.value)}>
                                <option value="">بدون نقش سفارشی</option>
                               {customRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                             </select>
                             <textarea className="bg-slate-900 border border-slate-700 rounded p-2 min-h-16 text-[10px]" value={editPermissionsText} onChange={e => setEditPermissionsText(e.target.value)} placeholder={"Extra permissions, one per line\nnovel:approve\nanalytics:read_all"} />
                           </div>

                           {/* Department Access Setting */}
                           <div className="flex flex-col gap-1 p-2 bg-slate-800/30 rounded border border-slate-800">
                             <span className="text-[9px] font-bold text-slate-400">دسترسی به دپارتمان‌های پشتیبانی:</span>
                             <div className="flex flex-wrap gap-2 text-[10px]">
                               {['general', 'technical', 'billing', 'moderation'].map(dep => (
                                 <label key={dep} className="flex items-center gap-1 cursor-pointer">
                                   <input type="checkbox" className="w-3 h-3 text-violet-500 bg-slate-900 border-slate-700" 
                                     checked={editUserDepartments.includes(dep)} 
                                     onChange={(e) => {
                                        if (e.target.checked) setEditUserDepartments([...editUserDepartments, dep]);
                                        else setEditUserDepartments(editUserDepartments.filter(d => d !== dep));
                                     }} 
                                   />
                                   <span className="capitalize">{dep}</span>
                                 </label>
                               ))}
                             </div>
                           </div>

                           <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_112px_96px_repeat(4,auto)] gap-2 items-stretch">
                             <input type="text" className="bg-slate-900 border border-slate-700 rounded p-1 min-w-0" value={editUserPassword} onChange={e => setEditUserPassword(e.target.value)} placeholder="رمز عبور جدید (اختیاری)..." />
                             <select style={adminSelectStyle} className={`border rounded p-1 text-[10px] ${adminControlClass}`} value={editPremiumPlan} onChange={e => setEditPremiumPlan(e.target.value)} title="طرح پرمیوم">
                               <option value="manual">دستی</option>
                               <option value="monthly">ماهانه</option>
                               <option value="yearly">سالانه</option>
                               <option value="lifetime">مادام‌العمر</option>
                             </select>
                              <input type="number" className="bg-slate-900 border border-slate-700 rounded p-1 text-[10px]" value={editUserPremiumDays} onChange={e => setEditUserPremiumDays(parseInt(e.target.value) || 0)} placeholder="روزهای پرمیوم" title="اعطای روزهای پرمیوم" />
                            <button onClick={() => saveEditUser(user.id)} className="bg-purple-600 hover:bg-purple-500 text-white px-2 rounded cursor-pointer font-bold">ذخیره</button>
                            <button onClick={async () => {
                              const subject = window.prompt("موضوع ایمیل");
                              if (!subject) return;
                              const message = window.prompt("متن ایمیل");
                              if (!message) return;
                              const token = api.getToken();
                              if (!token) return alert("احراز هویت نشده است");
                              const result = await api.sendAdminEmail(token, user.id, { subject, message });
                              alert(result?.success ? "ایمیل ارسال شد." : result?.error || "ارسال ایمیل ناموفق بود.");
                            }} className="bg-violet-600 hover:bg-violet-500 text-white px-2 rounded cursor-pointer font-bold">ایمیل</button>
                            <button onClick={async () => {
                              const title = window.prompt("عنوان اعلان");
                              if (!title) return;
                              const message = window.prompt("متن اعلان");
                              if (!message) return;
                              const token = api.getToken();
                              if (!token) return alert("احراز هویت نشده است");
                              const result = await api.sendAdminNotification(token, user.id, { title, message });
                              alert(result?.success ? "اعلان ارسال شد." : result?.error || "ارسال اعلان ناموفق بود.");
                            }} className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-2 rounded cursor-pointer font-bold">اعلان</button>
                            <div className="flex min-w-0 items-center gap-2">
                              <select style={adminSelectStyle} className={`min-w-0 border rounded p-1 text-[12px] ${adminControlClass}`} value={selectedAchievement} onChange={e => setSelectedAchievement(e.target.value)}>
                                <option value="">اعطای دستاورد...</option>
                                {achievementsList.map(a => (<option key={a.id} value={a.id}>{a.title || a.id}</option>))}
                              </select>
                              <button onClick={async () => {
                                  if (!selectedAchievement) return alert('دستاورد را انتخاب کنید');
                                  const token = api.getToken();
                                  if (!token) return alert('احراز هویت نشده است');
                                  const ok = await api.grantAchievement(token, user.id, selectedAchievement);
                                  if (ok) {
                                    alert('دستاورد اعطا شد');
                                    setSelectedAchievement('');
                                    loadUsers();
                                  } else alert('اعطای دستاورد ناموفق بود');
                                }} className="px-2 py-1 bg-emerald-600 text-white rounded text-xs">اعطا</button>
                            </div>
                           </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>)}
            </div>
          </div>
        </div>
      )}

      {activeSegment === "backup" && userRole === "owner" && (
        <div className="space-y-5 text-left">
          <div>
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2"><Database className="w-5 h-5 text-emerald-500" />پشتیبان‌گیری پایگاه داده</h2>
            <p className="text-xs text-slate-500">دانلود یا بازیابی کامل پایگاه داده PostgreSQL. رمز مالک شما برای هر عملیات بررسی می‌شود.</p>
          </div>
          <div className={`rounded-2xl border ${activeTheme.border} ${activeTheme.card} p-5 space-y-5`}>
            <label className="block max-w-md space-y-1">
              <span className="text-xs font-bold">تأیید رمز مالک</span>
              <input type="password" autoComplete="current-password" value={databaseBackupPassword} onChange={(e) => setDatabaseBackupPassword(e.target.value)} className={`w-full rounded-lg border p-2 text-sm ${adminControlClass}`} placeholder="برای دانلود و بازیابی ضروری است" />
            </label>

            <section className="rounded-xl border border-slate-700/40 p-4 space-y-2">
              <h3 className="font-bold flex items-center gap-2"><Download className="w-4 h-4 text-emerald-400" />دانلود کامل پایگاه داده</h3>
              <p className="text-xs text-slate-500">پشتیبانی با قالب سفارشی PostgreSQL شامل اسکیمای پایگاه داده و همه رکوردها ایجاد می‌کند.</p>
              <button type="button" disabled={databaseBackupBusy || !databaseBackupPassword} onClick={async () => {
                const token = api.getToken(); if (!token) return;
                setDatabaseBackupBusy(true); setDatabaseBackupStatus("در حال ایجاد پشتیبان پایگاه داده…");
                try {
                  const response = await fetch("/api/admin/database-backup/download", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify({ password: databaseBackupPassword }) });
                  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "دانلود پشتیبان ناموفق بود.");
                  const blob = await response.blob(); const disposition = response.headers.get("content-disposition") || ""; const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `reptoc-database-${Date.now()}.dump`; const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); setDatabaseBackupStatus("پشتیبان پایگاه داده دانلود شد."); setDatabaseBackupPassword("");
                } catch (error: any) { setDatabaseBackupStatus(error?.message || "دانلود پشتیبان ناموفق بود."); } finally { setDatabaseBackupBusy(false); }
              }} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">دانلود پشتیبان پایگاه داده</button>
            </section>

            <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-3">
              <h3 className="font-bold flex items-center gap-2 text-rose-300"><Upload className="w-4 h-4" />بارگذاری و بازیابی پایگاه داده</h3>
              <p className="text-xs text-rose-200/70">هشدار: بازیابی، اشیا و رکوردهای فعلی پایگاه داده را با پشتیبان انتخاب‌شده جایگزین می‌کند. این کار قابل بازگشت نیست مگر اینکه ابتدا نسخه پشتیبان تهیه کنید.</p>
              <input type="file" accept=".dump,.backup,application/octet-stream" onChange={(e) => setDatabaseBackupFile(e.target.files?.[0] || null)} className="block w-full max-w-xl text-xs" />
              <button type="button" disabled={databaseBackupBusy || !databaseBackupPassword || !databaseBackupFile} onClick={async () => {
                if (!databaseBackupFile || !confirm(`بازیابی کل پایگاه داده از ${databaseBackupFile.name} انجام شود؟ داده‌های فعلی ممکن است جایگزین شوند.`)) return;
                const token = api.getToken(); if (!token) return;
                setDatabaseBackupBusy(true); setDatabaseBackupStatus("در حال بازیابی پایگاه داده… این صفحه را نبندید.");
                try {
                  const form = new FormData(); form.append("password", databaseBackupPassword); form.append("backup", databaseBackupFile);
                  const response = await fetch("/api/admin/database-backup/restore", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": token }, body: form }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "بازیابی پایگاه داده ناموفق بود."); setDatabaseBackupStatus("پایگاه داده با موفقیت بازیابی شد. اگر نشست شما تغییر کرده دوباره وارد شوید."); setDatabaseBackupPassword(""); setDatabaseBackupFile(null);
                } catch (error: any) { setDatabaseBackupStatus(error?.message || "بازیابی پایگاه داده ناموفق بود."); } finally { setDatabaseBackupBusy(false); }
              }} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">بارگذاری و بازیابی پشتیبان</button>
            </section>
            {databaseBackupStatus && <div role="status" className="rounded-lg border border-slate-700 px-3 py-2 text-xs">{databaseBackupStatus}</div>}
          </div>
        </div>
      )}

      {activeSegment === "operations" && userRole === "owner" && (
        <div className="space-y-4 text-left">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-rose-500" />
                <span>مرکز عملیات مدیریت</span>
              </h2>
              <p className="text-xs text-slate-500">امنیت، خط زمانی کاربر، صف‌های مدیریت محتوا، ایمنی محتوا، آمار، تیکت‌ها، مالی، پشتیبان‌گیری و قالب‌های نقش.</p>
            </div>
            <button onClick={loadOperations} className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold">
              {loadingOps ? "در حال بازخوانی..." : "بازخوانی عملیات"}
            </button>
          </div>

          {!adminOps ? (
            <div className={`p-6 rounded-2xl border ${activeTheme.border} ${activeTheme.card} text-xs text-slate-500`}>
              {loadingOps ? "در حال بارگذاری داشبورد عملیات..." : "هیچ داده عملیاتی بارگذاری نشده است."}
            </div>
          ) : (
            <>
              <section dir="rtl" className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-4 text-right`} aria-labelledby="comment-moderation-title">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div>
                    <h3 id="comment-moderation-title" className="text-base font-black flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-500" />نظارت هوشمند دیدگاه‌ها</h3>
                    <p className="mt-1 text-xs text-slate-500">دیدگاه‌های فصل، پاسخ‌ها و دیدگاه‌های پاراگرافی؛ تأیید و رد دستی یا بررسی هوشمند ترتیبی.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <button type="button" onClick={() => loadCommentModeration("pending", 1)} className={`rounded-lg border px-3 py-2 ${commentModerationStatus === "pending" ? "border-amber-500 bg-amber-500/10" : activeTheme.border}`}><b>{commentModeration.counts?.pending || 0}</b><br />در انتظار</button>
                    <button type="button" onClick={() => loadCommentModeration("approved", 1)} className={`rounded-lg border px-3 py-2 ${commentModerationStatus === "approved" ? "border-emerald-500 bg-emerald-500/10" : activeTheme.border}`}><b>{commentModeration.counts?.approved || 0}</b><br />تأییدشده</button>
                    <button type="button" onClick={() => loadCommentModeration("rejected", 1)} className={`rounded-lg border px-3 py-2 ${commentModerationStatus === "rejected" ? "border-rose-500 bg-rose-500/10" : activeTheme.border}`}><b>{commentModeration.counts?.rejected || 0}</b><br />ردشده</button>
                  </div>
                </div>

                <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <label className="text-xs font-bold">حالت پیش‌فرض
                      <select value={commentModerationMode} onChange={(event) => setCommentModerationMode(event.target.value as "manual" | "automatic")} className={`mt-1 block min-w-52 rounded-lg border p-2 ${adminControlClass}`} style={adminSelectStyle}>
                        <option value="manual">تأیید دستی</option>
                        <option value="automatic">تأیید/رد خودکار</option>
                      </select>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1.5 text-[11px] font-black ${commentModerationKeyConfigured ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}>{commentModerationKeyConfigured ? "سرویس هوشمند آماده است" : "سرویس هوشمند آماده نیست"}</span>
                      <button type="button" disabled={commentModerationBusy} onClick={saveCommentModerationSettings} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">ذخیره حالت</button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">آدرس و کلید سرویس به‌صورت ثابت، پنهان و رمزگذاری‌شده در سرور نگهداری می‌شوند و از پنل قابل مشاهده یا تغییر نیستند. در حالت خودکار، <code>ALLOW</code> منتشر و <code>BLOCK</code> رد می‌شود؛ خطا یا پاسخ نامشخص دیدگاه را در صف نگه می‌دارد.</p>
                </div>

                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3 space-y-3">
                  <div>
                    <h4 className="text-sm font-black">تست قضاوت یک پیام</h4>
                    <p className="text-[11px] text-slate-500">این پیام فقط برای آزمایش به سرویس ارسال می‌شود و به‌عنوان دیدگاه ذخیره یا منتشر نمی‌شود.</p>
                  </div>
                  <div className="flex flex-col md:flex-row gap-2">
                    <textarea value={commentModerationTestMessage} onChange={(event) => { setCommentModerationTestMessage(event.target.value); setCommentModerationTestResult(null); }} maxLength={5000} rows={2} placeholder="پیامی که می‌خواهید قضاوت آن را ببینید…" className={`flex-1 rounded-lg border p-3 text-xs resize-y ${adminControlClass}`} />
                    <button type="button" disabled={commentModerationBusy || !commentModerationTestMessage.trim()} onClick={testCommentModeration} className="rounded-lg bg-cyan-600 px-5 py-2 text-xs font-black text-white disabled:opacity-40">تست پیام</button>
                  </div>
                  {commentModerationTestResult && (
                    <div role="status" className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-xs font-bold ${commentModerationTestResult.verdict === "ALLOW" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "border-rose-500/40 bg-rose-500/10 text-rose-500"}`}>
                      <span dir="ltr" className="rounded bg-black/10 px-2 py-1 font-mono text-sm">{commentModerationTestResult.verdict}</span>
                      <span>{commentModerationTestResult.verdict === "ALLOW" ? "این پیام تأیید و منتشر می‌شود." : "این پیام رد می‌شود و نمایش داده نخواهد شد."}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col md:flex-row gap-2 md:items-center justify-between">
                  <form onSubmit={(event) => { event.preventDefault(); loadCommentModeration(commentModerationStatus, 1); }} className="flex gap-2 flex-1 max-w-xl">
                    <input value={commentModerationSearch} onChange={(event) => setCommentModerationSearch(event.target.value)} placeholder="جست‌وجو در متن، نام کاربر یا داستان…" className={`flex-1 rounded-lg border p-2 text-xs ${adminControlClass}`} />
                    <button type="submit" className="rounded-lg border border-slate-500/30 px-3 py-2 text-xs font-bold">جست‌وجو</button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!selectedCommentIds.length || commentModerationBusy} onClick={() => moderateSelectedComments("ai")} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">بررسی هوشمند یکی‌یکی</button>
                    <button type="button" disabled={!selectedCommentIds.length || commentModerationBusy} onClick={() => moderateSelectedComments("approve")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">تأیید انتخاب‌ها</button>
                    <button type="button" disabled={!selectedCommentIds.length || commentModerationBusy} onClick={() => moderateSelectedComments("reject")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">رد انتخاب‌ها</button>
                  </div>
                </div>

                {commentModerationMessage && <div role="status" className="rounded-lg border border-slate-500/20 px-3 py-2 text-xs">{commentModerationMessage}</div>}
                <div className="overflow-x-auto rounded-xl border border-slate-500/20">
                  <table className="w-full min-w-[850px] text-xs">
                    <thead className="bg-black/10">
                      <tr>
                        <th className="p-3"><input aria-label="انتخاب همه دیدگاه‌های این صفحه" type="checkbox" checked={!!commentModeration.items?.length && selectedCommentIds.length === commentModeration.items.length} onChange={(event) => setSelectedCommentIds(event.target.checked ? commentModeration.items.map((item: any) => item.id) : [])} /></th>
                        <th className="p-3 text-right">دیدگاه</th><th className="p-3 text-right">کاربر</th><th className="p-3 text-right">داستان / فصل</th><th className="p-3 text-right">وضعیت</th><th className="p-3 text-right">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(commentModeration.items || []).map((item: any) => (
                        <tr key={item.id} className="border-t border-slate-500/15 align-top">
                          <td className="p-3"><input aria-label={`انتخاب دیدگاه ${item.id}`} type="checkbox" checked={selectedCommentIds.includes(item.id)} onChange={(event) => setSelectedCommentIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>
                          <td className="p-3 max-w-md"><p className="whitespace-pre-wrap break-words leading-6">{item.content}</p><div className="mt-1 text-[10px] text-slate-500">{new Date(item.created_at).toLocaleString("fa-IR")} {item.paragraph_id ? "· دیدگاه پاراگراف" : item.parent_id ? "· پاسخ" : "· دیدگاه فصل"}</div></td>
                          <td className="p-3"><b>{item.author_name}</b><div dir="ltr" className="text-[10px] text-slate-500">@{item.author_username || "unknown"}</div></td>
                          <td className="p-3"><b>{item.novel_title || "داستان حذف‌شده"}</b><div className="text-[10px] text-slate-500">{item.chapter_title || `فصل ${item.chapter_number || "—"}`}</div></td>
                          <td className="p-3"><span className={`inline-flex rounded-full px-2 py-1 font-bold ${item.moderation_status === "visible" ? "bg-emerald-500/15 text-emerald-500" : item.moderation_status === "rejected" ? "bg-rose-500/15 text-rose-500" : "bg-amber-500/15 text-amber-500"}`}>{item.moderation_status === "visible" ? "تأییدشده" : item.moderation_status === "rejected" ? "ردشده" : "در انتظار"}</span><div className="mt-1 text-[10px] text-slate-500">{item.moderation_result || "بررسی‌نشده"}</div></td>
                          <td className="p-3"><div className="flex flex-wrap gap-1">
                            {item.moderation_status !== "visible" && <button type="button" disabled={commentModerationBusy} onClick={() => decideComment(item.id, "approve")} className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-40">{item.moderation_status === "rejected" ? "تأیید مجدد" : "تأیید"}</button>}
                            {item.moderation_status !== "rejected" && <button type="button" disabled={commentModerationBusy} onClick={() => decideComment(item.id, "reject")} className="rounded bg-rose-600 px-2 py-1 text-white disabled:opacity-40">رد</button>}
                            {item.moderation_status === "visible" && <button type="button" disabled={commentModerationBusy} onClick={() => deleteApprovedComment(item.id)} className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-40">حذف</button>}
                          </div></td>
                        </tr>
                      ))}
                      {!commentModerationBusy && !(commentModeration.items || []).length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">دیدگاهی در این بخش نیست.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-center gap-3 text-xs">
                  <button type="button" disabled={commentModerationPage <= 1 || commentModerationBusy} onClick={() => loadCommentModeration(commentModerationStatus, commentModerationPage - 1)} className="rounded-lg border border-slate-500/30 px-3 py-2 disabled:opacity-40">صفحه قبل</button>
                  <span>صفحه {commentModeration.pagination?.page || 1} از {commentModeration.pagination?.totalPages || 1} · {commentModeration.pagination?.total || 0} دیدگاه</span>
                  <button type="button" disabled={commentModerationPage >= (commentModeration.pagination?.totalPages || 1) || commentModerationBusy} onClick={() => loadCommentModeration(commentModerationStatus, commentModerationPage + 1)} className="rounded-lg border border-slate-500/30 px-3 py-2 disabled:opacity-40">صفحه بعد</button>
                </div>
              </section>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ["نشست‌های فعال", adminOps.security?.activeSessions || 0],
                  ["قفل‌شده / مسدود", adminOps.security?.lockedUsers || 0],
                  ["2FA فعال", adminOps.security?.twofaUsers || 0],
                  ["هشدارهای امنیتی", adminOps.security?.suspiciousLast30Days || 0],
                  ["تیکت‌های باز", adminOps.tickets?.open || 0],
                  ["سفارش‌های پرداخت‌شده", adminOps.finance?.paidOrders || 0],
                  ["حجم ستاره", adminOps.finance?.starVolume || 0],
                  ["فایل‌های پشتیبان", adminOps.backups?.files?.length || 0],
                ].map(([label, value]) => (
                  <div key={label} className={`p-3 rounded-xl border ${activeTheme.border} ${activeTheme.card}`}>
                    <div className="text-[10px] text-slate-500 uppercase font-mono">{label}</div>
                    <div className="text-xl font-black">{String(value)}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-sm font-bold">داشبورد امنیت</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {(adminOps.security?.recent || []).slice(0, 12).map((event: any) => (
                      <div key={event.id} className="p-2 rounded border border-slate-800/20 text-xs flex justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold truncate">{event.event_type}</div>
                          <div className="text-[10px] text-slate-500 truncate">{event.user_id || "ناشناس"} | {event.ip || "IP نامشخص"}</div>
                        </div>
                        <div className="text-[10px] text-slate-500 whitespace-nowrap">{new Date(event.created_at).toLocaleString('fa-IR')}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-sm font-bold">خط زمانی کاربر</h3>
                  <div className="flex gap-2">
                    <select value={timelineUserId} onChange={(e) => loadTimeline(e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-xs">
                      <option value="">انتخاب کاربر...</option>
                      {platformUsers.map((user) => <option key={user.id} value={user.id}>{user.username} ({user.role})</option>)}
                    </select>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {userTimeline.map((item, index) => (
                      <div key={`${item.source}-${index}`} className="p-2 rounded border border-slate-800/20 text-xs">
                        <div className="flex justify-between gap-2">
                          <span className="font-bold">{item.source}: {item.title}</span>
                          <span className="text-[10px] text-slate-500">{new Date(item.created_at).toLocaleString('fa-IR')}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{typeof item.details === "string" ? item.details : JSON.stringify(item.details)}</div>
                      </div>
                    ))}
                    {timelineUserId && userTimeline.length === 0 && <div className="text-xs text-slate-500">رویدادی در خط زمانی پیدا نشد.</div>}
                  </div>
                </div>
              </div>

              <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                <h3 className="text-sm font-bold">صف‌های مدیریت محتوا و ایمنی محتوا</h3>
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
                  {[
                    ["صف فصل‌ها", "chapter", adminOps.queues?.chapters || []],
                    ["صف دیدگاه‌ها", "", adminOps.queues?.comments || []],
                    ["صف انجمن", "forum_thread", adminOps.queues?.forum || []],
                    ["گزارش‌های تخلف", "report", adminOps.queues?.reports || []],
                  ].map(([title, defaultType, rows]: any) => (
                    <div key={title} className="rounded-xl border border-slate-800/20 p-3 min-h-48">
                      <div className="text-xs font-bold mb-2">{title}</div>
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {rows.slice(0, 10).map((row: any) => {
                          const targetType = row.type || defaultType;
                          const targetId = row.id;
                          return (
                            <div key={`${title}-${targetId}`} className="p-2 rounded bg-black/10 text-[11px] space-y-1">
                              <div className="font-bold line-clamp-1">{row.title || row.reason || row.content || row.novel_title || targetId}</div>
                              <div className="text-[10px] text-slate-500">{row.moderation_status || row.status || row.priority || "pending"}</div>
                              {targetType !== "report" && (
                                <div className="flex flex-wrap gap-1">
                                  <button onClick={async () => { const token = api.getToken(); if (!token) return; await api.scanAdminContent(token, targetType, targetId); loadOperations(); }} className="px-2 py-1 rounded bg-violet-600 text-white">اسکن</button>
                                  <button onClick={() => runContentAction(targetType, targetId, "quarantine")} className="px-2 py-1 rounded bg-amber-600 text-white">قرنطینه</button>
                                  <button onClick={() => runContentAction(targetType, targetId, "release")} className="px-2 py-1 rounded bg-emerald-600 text-white">آزادسازی</button>
                                  <button onClick={() => runContentAction(targetType, targetId, "delete")} className="px-2 py-1 rounded bg-rose-600 text-white">حذف</button>
                                </div>
                              )}
                              {targetType === "report" && <button onClick={() => openReport(targetId)} className="px-2 py-1 rounded bg-rose-600 text-white">بررسی گزارش</button>}
                            </div>
                          );
                        })}
                        {rows.length === 0 && <div className="text-[11px] text-slate-500">موردی نیست.</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                  {(adminOps.contentSafety?.scans || []).slice(0, 8).map((scan: any) => (
                    <div key={scan.id} className="p-2 rounded border border-slate-800/20 text-xs">
                      <div className="font-bold">{scan.target_type} | ریسک {scan.risk_score}%</div>
                      <div className="text-[10px] text-slate-500">{(scan.flags || []).join(", ") || "بدون پرچم"}</div>
                      <div className="text-[10px] text-slate-500 line-clamp-2">{scan.summary}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-sm font-bold">آمار پیشرفته و مالی</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-500">رمان‌های برتر</div>
                      {(adminOps.analytics?.topNovels || []).slice(0, 8).map((novel: any) => (
                        <div key={novel.id} className="flex justify-between text-xs border-b border-slate-800/20 pb-1">
                          <span className="truncate">{novel.title}</span>
                          <span>{Number(novel.views_count || 0).toLocaleString()} بازدید · میانگین {Number(novel.average_views || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} در هر فصل</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-500">سفارش‌های پرمیوم</div>
                      {(adminOps.finance?.premiumOrders || []).slice(0, 8).map((order: any) => (
                        <div key={order.id} className="flex justify-between text-xs border-b border-slate-800/20 pb-1">
                          <span className="truncate">{order.user_id}</span>
                          <span>{order.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-sm font-bold">تیکت‌های حرفه‌ای</h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {(adminOps.tickets?.items || []).slice(0, 10).map((ticket: any) => (
                      <div key={ticket.id} className="p-2 rounded border border-slate-800/20 text-xs space-y-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-bold truncate">{ticket.title}</span>
                          <span>{ticket.status}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {["OPEN", "PENDING", "RESOLVED", "CLOSED"].map((status) => (
                            <button key={status} onClick={async () => { const token = api.getToken(); if (!token) return; await api.updateTicketPro(token, ticket.id, { status }); loadOperations(); }} className="px-2 py-1 rounded bg-slate-800 text-white">{status}</button>
                          ))}
                          <button onClick={async () => { const token = api.getToken(); if (!token) return; const note = opsInternalNote || window.prompt("یادداشت داخلی") || ""; if (!note) return; await api.addTicketInternalNote(token, ticket.id, note); setOpsInternalNote(""); loadOperations(); }} className="px-2 py-1 rounded bg-purple-600 text-white">یادداشت داخلی</button>
                        </div>
                        {ticket.internalNotes?.length > 0 && <div className="text-[10px] text-slate-500">{ticket.internalNotes.length} یادداشت داخلی</div>}
                      </div>
                    ))}
                  </div>
                  <input value={opsInternalNote} onChange={(e) => setOpsInternalNote(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs" placeholder="متن یادداشت داخلی قابل استفاده مجدد..." />
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-sm font-bold">زمان‌بندی پشتیبان‌گیری و بازیابی</h3>
                  <div className="flex flex-wrap gap-2">
                    <select value={backupFrequency} onChange={(e) => setBackupFrequency(e.target.value)} className="bg-slate-900 border border-slate-700 rounded p-2 text-xs">
                      <option value="hourly">ساعتی</option>
                    <option value="daily">روزانه</option>
                    <option value="weekly">هفتگی</option>
                    </select>
                    <button onClick={async () => { const token = api.getToken(); if (!token) return; await api.saveBackupSchedule(token, { name: `پشتیبان‌گیری کاربران (${backupFrequency})`, frequency: backupFrequency, enabled: true }); loadOperations(); }} className="px-3 py-2 rounded bg-violet-600 text-white text-xs font-bold">ذخیره زمان‌بندی</button>
                    <button onClick={async () => { const token = api.getToken(); if (!token) return; await api.createBackup(token); loadOperations(); }} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-bold">ایجاد فوری پشتیبان</button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {(adminOps.backups?.schedules || []).map((schedule: any) => (
                      <div key={schedule.id} className="text-xs p-2 rounded border border-slate-800/20 flex justify-between">
                        <span>{schedule.name} | {schedule.frequency}</span>
                        <span>{schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString('fa-IR') : "بدون اجرای بعدی"}</span>
                      </div>
                    ))}
                    {(adminOps.backups?.files || []).map((file: any) => (
                      <div key={file.name} className="text-xs p-2 rounded border border-slate-800/20 flex justify-between gap-2">
                        <span className="truncate">{file.name}</span>
                        <button onClick={async () => { if (!confirm("بازیابی کاربران از این پشتیبان انجام شود؟")) return; const token = api.getToken(); if (!token) return; const result = await api.restoreBackupUsers(token, file.name); alert(result?.success ? `${result.restored} کاربر بازیابی شد.` : "بازیابی ناموفق بود."); loadOperations(); }} className="px-2 py-1 rounded bg-amber-600 text-white">بازیابی</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-sm font-bold">قالب‌های آماده نقش و دسترسی</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(adminOps.rolePresets || []).map((preset: any) => (
                      <div key={preset.id} className="p-3 rounded border border-slate-800/20 text-xs space-y-2">
                        <div className="font-bold">{preset.name}</div>
                        <div className="text-[10px] text-slate-500">{preset.description}</div>
                        <div className="flex flex-wrap gap-1">
                          {preset.permissions.map((permission: string) => <span key={permission} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px]">{permission}</span>)}
                        </div>
                        <button onClick={async () => { const token = api.getToken(); if (!token) return; await api.createRoleFromPreset(token, preset.id); await loadUsers(); await loadOperations(); }} className="px-2 py-1 rounded bg-fuchsia-600 text-white">ایجاد نقش</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Segment: Audit Log */}
      {activeSegment === "audit" && userRole === "owner" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold tracking-tight">گزارش ممیزی مدیریت</h2>
          </div>

          <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b bg-black/10 text-slate-400">
                    <th className="p-2">زمان</th>
                    <th className="p-2">عامل</th>
                    <th className="p-2">هدف</th>
                    <th className="p-2">اقدام</th>
                    <th className="p-2">جزئیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {auditEntries.map(a => (
                    <tr key={a.id} className="hover:bg-slate-500/5">
                      <td className="p-2 text-[11px]">{new Date(a.created_at).toLocaleString('fa-IR')}</td>
                      <td className="p-2">{a.actor_id || 'سیستم'}</td>
                      <td className="p-2">{a.target_user_id || ''}</td>
                      <td className="p-2">{a.action}</td>
                      <td className="p-2 truncate max-w-[500px]">{typeof a.details === 'string' ? a.details : JSON.stringify(a.details)}</td>
                    </tr>
                  ))}
                  {auditEntries.length === 0 && (
                    <tr><td colSpan={5} className="p-4 text-center text-xs text-slate-500">موردی در گزارش ممیزی پیدا نشد.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-bold">لاگ‌های فایل</h3>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 p-2 rounded border bg-black/5">
                  {auditFiles.length === 0 && <div className="text-xs text-slate-500 p-2">فایل لاگی پیدا نشد.</div>}
                  {auditFiles.map(f => (
                    <div key={f.name} className="flex items-center justify-between text-xs p-2 border-b">
                      <div>
                        <div className="font-mono text-[12px]">{f.name}</div>
                        <div className="text-[10px] text-slate-500">{(f.size/1024).toFixed(1)} KB • {new Date(f.mtime).toLocaleString('fa-IR')}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button onClick={async () => {
                          const token = api.getToken(); if (!token) return;
                          const c = await api.getAdminAuditFileContent(token, f.name);
                          setSelectedAuditFile(f.name);
                          setSelectedAuditContent(c);
                        }} className="px-2 py-1 bg-slate-800 text-white rounded text-[11px]">مشاهده</button>
                        <button onClick={async () => {
                          if (!confirm('Delete this audit file? This cannot be undone.')) return;
                          const token = api.getToken(); if (!token) return;
                          const ok = await api.deleteAdminAuditFile(token, f.name);
                          if (ok) {
                            setAuditFiles(auditFiles.filter(x => x.name !== f.name));
                            if (selectedAuditFile === f.name) { setSelectedAuditFile(null); setSelectedAuditContent(null); }
                          } else alert('حذف فایل ناموفق بود');
                        }} className="px-2 py-1 bg-rose-600 text-white rounded text-[11px]">حذف</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="md:col-span-2 p-2 rounded border bg-black/5">
                  <div className="text-xs text-slate-400 mb-2">محتوای انتهای فایل انتخاب‌شده.</div>
                  <pre className="text-[11px] whitespace-pre-wrap max-h-72 overflow-auto p-2 bg-transparent">
                    {selectedAuditContent || 'No file selected.'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Segment: Monitoring */}
      {activeSegment === 'monitor' && userRole === 'owner' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-green-500" />
            <h2 className="text-lg font-bold tracking-tight">داشبورد پایش</h2>
          </div>
          <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
            {monitorMetrics ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-left">
                <div className="p-3 rounded border border-slate-800/20">
                  <div className="text-xs text-slate-500">کل کاربران</div>
                  <div className="text-xl font-bold">{monitorMetrics.usersTotal}</div>
                </div>
                <div className="p-3 rounded border border-slate-800/20">
                  <div className="text-xs text-slate-500">نشست‌های فعال</div>
                  <div className="text-xl font-bold">{monitorMetrics.sessionsTotal}</div>
                </div>
                <div className="p-3 rounded border border-slate-800/20">
                  <div className="text-xs text-slate-500">کاربران جدید (24 ساعت)</div>
                  <div className="text-xl font-bold">{monitorMetrics.newUsersLast24h}</div>
                </div>
                <div className="p-3 rounded border border-slate-800/20">
                  <div className="text-xs text-slate-500">کل رمان‌ها / در انتظار</div>
                  <div className="text-xl font-bold">{monitorMetrics.novelsTotal} / {monitorMetrics.pendingApprovals}</div>
                </div>
                <div className="p-3 rounded border border-slate-800/20">
                  <div className="text-xs text-slate-500">دیدگاه‌ها / نقدها</div>
                  <div className="text-xl font-bold">{siteAnalytics ? `${siteAnalytics.totals.reviews} / ${siteAnalytics.totals.chapterComments}` : "..."}</div>
                </div>
                <div className="p-3 rounded border border-slate-800/20">
                  <div className="text-xs text-slate-500">سیگنال‌های آماری / VPN</div>
                  <div className="text-xl font-bold">{siteAnalytics ? `${siteAnalytics.totals.analyticsSignals} / ${siteAnalytics.totals.vpnOrProxyRate}%` : "..."}</div>
                </div>
                {siteAnalytics && (
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { title: "توزیع جغرافیایی", rows: siteAnalytics.audience?.countries || [] },
                      { title: "توزیع دستگاه‌ها", rows: siteAnalytics.audience?.devices || [] },
                      { title: "توزیع مرورگرها", rows: siteAnalytics.audience?.browsers || [] },
                    ].map((group) => (
                      <div key={group.title} className="p-3 rounded border border-slate-800/20 space-y-2">
                        <div className="text-xs font-bold text-slate-500">{group.title}</div>
                        {group.rows.slice(0, 6).map((row: any) => (
                          <div key={`${group.title}-${row.name}`} className="space-y-1">
                            <div className="flex justify-between gap-2 text-[11px]">
                              <span className="truncate">{row.name}</span>
                              <span className="font-mono text-violet-400">{row.percentage}%</span>
                            </div>
                            <div className="h-1.5 rounded bg-slate-800/30 overflow-hidden">
                              <div className="h-full rounded bg-violet-500" style={{ width: `${Math.min(100, row.percentage)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="p-3 rounded border border-slate-800/20 md:col-span-3">
                  <div className="text-xs text-slate-500">آخرین بازخوانی</div>
                  <div className="text-sm">{new Date(monitorMetrics.timestamp).toLocaleString('fa-IR')}</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">معیاری در دسترس نیست.</div>
            )}
          </div>
        </div>
      )}



      {activeSegment === "rules" && (
        <section className={`rounded-2xl border p-5 md:p-7 ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-violet-500" /><h2 className="text-lg font-bold">ویرایشگر قوانین و شرایط</h2></div>
              <p className="mt-1 text-xs text-slate-500">قوانین را در پایین اضافه، تغییر یا حذف کنید. پاپ‌آپ ثبت‌نام پس از ذخیره به‌روز می‌شود.</p>
            </div>
            <button type="button" onClick={saveRules} className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-500">{isSaved ? "✓ ذخیره شد" : "ذخیره قوانین"}</button>
          </div>
          <label className="mb-2 block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">سند قوانین متنی غنی</label>
          <div className={`min-h-[480px] overflow-hidden rounded-2xl border ${isDark ? "border-violet-950" : "border-stone-200"}`}>
            <TiptapEditor
              content={rulesText}
              onChange={setRulesText}
              placeholder="عنوان‌ها، قوانین شماره‌دار، فهرست گلوله‌ای، لینک‌ها و نکات مهم اضافه کنید..."
              theme={theme}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-500"><span>برای خواناتر شدن شرایط از عنوان‌ها و فهرست‌های شماره‌دار استفاده کنید.</span><span>{rulesText.replace(/<[^>]*>/g, "").length.toLocaleString()} کاراکتر</span></div>
        </section>
      )}

      {/* Segment 3: Platform Settings (Owner Config Form) */}
      {activeSegment === "settings" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold tracking-tight">تنظیمات پیکربندی سیستم</h2>
          </div>

          <form onSubmit={handleSaveSettings} className={`p-6 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-6 text-left ${activeTheme.shadow}`}>
            {/* Global site announcement input */}
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-slate-400 flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-400" />
                  <span>اطلاعیه پلتفرم</span>
              </label>
              <textarea
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="اطلاعیه سایت که به همه کاربران نمایش داده می‌شود."
                className={`w-full p-3 h-20 text-xs rounded-xl border focus:outline-none focus:border-amber-500 transition-colors ${
                  isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"
                }`}
              />
            </div>

            {/* Maintenance and Registration parameters toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Option A: Lock Maintenance mode */}
              <div className={`p-4 rounded-xl border ${activeTheme.border} flex items-center justify-between gap-4`}>
                <div className="space-y-0.5 text-left">
                  <span className="font-bold text-xs text-slate-350 font-sans block">حالت قفل سیستم</span>
                  <span className="text-[10px] text-slate-500">قفل کردن رابط کتابخانه برای عملیات نگهداری.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMaintenanceMode(!maintenanceMode)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-extrabold uppercase transition border cursor-pointer ${
                    maintenanceMode
                      ? "bg-rose-600 border-rose-500 text-white shadow"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {maintenanceMode ? "🔒 قفل فعال" : "🔒 قفل خاموش"}
                </button>
              </div>

              {/* Option B: Disable user registrations */}
              <div className={`p-4 rounded-xl border ${activeTheme.border} flex items-center justify-between gap-4`}>
                <div className="space-y-0.5 text-left">
                  <span className="font-bold text-xs text-slate-350 font-sans block">ثبت‌نام مهمانان</span>
                  <span className="text-[10px] text-slate-500">اجازه ثبت‌نام به کاربران.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowRegistration(!allowRegistration)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-extrabold uppercase transition border cursor-pointer ${
                    allowRegistration
                      ? "bg-violet-600 border-violet-500 text-white shadow"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {allowRegistration ? "✓ فعال" : "☒ بسته"}
                </button>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-800/10 dark:border-violet-950/15">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold tracking-tight">تأیید ایمیل</h3>
                  <p className="text-[10px] text-slate-500">هنگام ساخت حساب توسط خواننده، کد تأیید 6 رقمی از طریق Resend، Mailjet API یا SMTP ارسال می‌شود.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEmailVerificationEnabled(!emailVerificationEnabled)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-extrabold uppercase transition border cursor-pointer ${
                    emailVerificationEnabled ? "bg-emerald-600 border-emerald-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {emailVerificationEnabled ? "فعال" : "غیرفعال"}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select value={emailProvider} onChange={(e) => setEmailProvider(e.target.value as EmailProvider)} className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`}>
                  <option value="resend">Resend API</option>
                  <option value="mailjet">Mailjet API</option>
                  <option value="smtp">SMTP</option>
                </select>
                <input type="password" value={resendApiKey} onChange={(e) => setResendApiKey(e.target.value)} placeholder="کلید API Resend (برای حفظ کلید ذخیره‌شده خالی بگذارید)" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} placeholder="ایمیل فرستنده Resend" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={resendFromName} onChange={(e) => setResendFromName(e.target.value)} placeholder="نام فرستنده Resend" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={mailjetApiKey} onChange={(e) => setMailjetApiKey(e.target.value)} placeholder="کلید API Mailjet (برای حفظ کلید ذخیره‌شده خالی بگذارید)" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input type="password" value={mailjetSecretKey} onChange={(e) => setMailjetSecretKey(e.target.value)} placeholder="کلید مخفی Mailjet (برای حفط رمز ذخیره‌شده خالی بگذارید)" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={mailjetFrom} onChange={(e) => setMailjetFrom(e.target.value)} placeholder="ایمیل فرستنده Mailjet" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={mailjetFromName} onChange={(e) => setMailjetFromName(e.target.value)} placeholder="نام فرستنده Mailjet" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="هاست SMTP" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)} placeholder="پورت SMTP" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="نام کاربری SMTP" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="رمز عبور SMTP (برای حفظ رمز ذخیره‌شده خالی بگذارید)" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="آدرس ایمیل فرستنده" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`} />
                <label className={`p-2 text-xs rounded-xl border flex items-center gap-2 ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`}>
                  <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                  استفاده از SMTP/TLS امن
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <input
                  type="email"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="گیرنده ایمیل آزمایشی"
                  className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200 text-stone-900"}`}
                />
                <button
                  type="button"
                  onClick={handleSendTestEmail}
                  disabled={testEmailLoading}
                  className="px-3 py-2 rounded-xl bg-fuchsia-600 text-white text-[10px] font-mono font-extrabold uppercase disabled:opacity-60"
                >
                  {testEmailLoading ? "در حال ارسال..." : "ارسال ایمیل آزمایشی"}
                </button>
              </div>
              {testEmailStatus && <p className="text-[10px] text-slate-500">{testEmailStatus}</p>}
            </div>

            {/* Content Sections Visibility Management */}
            <div className="space-y-4 pt-4 border-t border-slate-800/10 dark:border-violet-950/15">
              <h3 className="text-sm font-bold tracking-tight flex items-center gap-2"><Eye className="w-4 h-4 text-emerald-500" /> کنترل چیدمان صفحه اصلی</h3>
              <p className="text-[10px] text-slate-500 -mt-2 mb-2 font-mono">بخش‌های کشف را کامل روشن یا خاموش کنید.</p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "فید پیشنهادها", enabled: section_suggestion_enabled, setEnabled: setSection_suggestion_enabled },
                  { label: "حتماً بخوانید", enabled: section_must_read_enabled, setEnabled: setSection_must_read_enabled },
                  { label: "انتشارهای جدید", enabled: section_new_releases_enabled, setEnabled: setSection_new_releases_enabled },
                  { label: "به‌روزشده‌های اخیر", enabled: section_recently_updated_enabled, setEnabled: setSection_recently_updated_enabled },
                ].map((sec, idx) => (
                  <div key={idx} className={`p-4 rounded-xl border ${activeTheme.border} ${activeTheme.card} flex flex-col items-center gap-3 text-center`}>
                    <span className="text-xs font-bold">{sec.label}</span>
                    <button
                      type="button"
                      onClick={() => sec.setEnabled(!sec.enabled)}
                      className={`w-full px-3 py-1.5 rounded-lg text-[10px] font-mono font-extrabold uppercase transition border cursor-pointer ${
                        sec.enabled
                          ? "bg-emerald-600 border-emerald-500 text-white shadow"
                          : "bg-slate-800 border-slate-700 text-slate-400"
                      }`}
                    >
                      {sec.enabled ? "✓ نمایان" : "☒ پنهان"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="space-y-4 pt-4 border-t border-slate-800/10 dark:border-violet-950/15">
              <h3 className="text-sm font-bold tracking-tight text-slate-400">پیکربندی پیشرفته اجزا (JSON)</h3>
              
              <div className="space-y-4 pt-2">
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono font-bold text-slate-500">انجمن‌ها: فاصله زمانی ایجاد موضوع (دقیقه)</label>
                    <input 
                      type="number"
                      value={forumCooldownConfig}
                      onChange={e => setForumCooldownConfig(parseInt(e.target.value) || 0)}
                      className={`w-full p-2 text-xs rounded-xl border focus:outline-none transition-colors max-w-[200px] ${
                        isDark ? "bg-[#0e0a1c] border-violet-950 text-slate-300" : "bg-stone-50 border-stone-200 text-stone-700"
                      }`}
                    />
                 </div>
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono font-bold text-slate-500">تعداد مسابقه‌های فعال</label>
                    <input 
                      type="number"
                      value={activeContestsCount}
                      onChange={e => setActiveContestsCount(parseInt(e.target.value) || 0)}
                      className={`w-full p-2 text-xs rounded-xl border focus:outline-none transition-colors max-w-[200px] ${
                        isDark ? "bg-[#0e0a1c] border-violet-950 text-slate-300" : "bg-stone-50 border-stone-200 text-stone-700"
                      }`}
                    />
                 </div>
              </div>

              <div className="space-y-2 pt-4">
                <label className="text-[10px] font-mono font-bold text-slate-500">GLOBAL CONTENT WARNINGS ([] JSON OBJECTS)</label>
                <textarea
                  value={contentWarningsJson}
                  onChange={(e) => setContentWarningsJson(e.target.value)}
                  className={`w-full p-3 h-32 text-[10px] font-mono rounded-xl border focus:outline-none transition-colors ${
                    isDark ? "bg-[#0e0a1c] border-violet-950 text-slate-300" : "bg-stone-50 border-stone-200 text-stone-700"
                  }`}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-slate-500">مسابقه فعال</label>
                <textarea
                  value={contestJson}
                  onChange={(e) => setContestJson(e.target.value)}
                  className={`w-full p-3 h-32 text-[10px] font-mono rounded-xl border focus:outline-none transition-colors ${
                    isDark ? "bg-[#0e0a1c] border-violet-950 text-slate-300" : "bg-stone-50 border-stone-200 text-stone-700"
                  }`}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-slate-500">برچسب‌های جدول امتیازات</label>
                <textarea
                  value={tagsJson}
                  onChange={(e) => setTagsJson(e.target.value)}
                  className={`w-full p-3 h-32 text-[10px] font-mono rounded-xl border focus:outline-none transition-colors ${
                    isDark ? "bg-[#0e0a1c] border-violet-950 text-slate-300" : "bg-stone-50 border-stone-200 text-stone-700"
                  }`}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-mono font-bold text-slate-500">سؤالات متداول پشتیبانی</label>
                <textarea
                  value={faqsJson}
                  onChange={(e) => setFaqsJson(e.target.value)}
                  className={`w-full p-3 h-32 text-[10px] font-mono rounded-xl border focus:outline-none transition-colors ${
                    isDark ? "bg-[#0e0a1c] border-violet-950 text-slate-300" : "bg-stone-50 border-stone-200 text-stone-700"
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800/10 dark:border-violet-950/15">
              <span className="text-amber-500 text-xs font-bold uppercase font-mono">
                {isSaved ? "✓ پیکربندی با سرور همگام شد!" : ""}
              </span>
              <button
                type="submit"
                className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-black uppercase tracking-wider font-mono rounded-xl hover:from-violet-500 hover:to-purple-500 transition shadow cursor-pointer shadow-violet-500/10"
              >
                ذخیره تنظیمات زنده
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Segment: Daily Challenges Manager */}
      {activeSegment === "challenges" && userRole === "owner" && (() => {
        const createChallenge = async (event: React.FormEvent) => {
          event.preventDefault();
          const token = api.getToken();
          if (!token) return;
          setChallengeBusy(true);
          setChallengeStatusMsg("");
          try {
            await api.createChallenge(token, {
              title: challengeTitle,
              promptText: challengePrompt,
              challengeType,
              imageUrl: challengeImageUrl,
              audioUrl: challengeAudioUrl,
            });
            setChallengeTitle("");
            setChallengePrompt("");
            setChallengeImageUrl("");
            setChallengeAudioUrl("");
            setChallengeType("continuation");
            setChallengeStatusMsg("چالش جدید فعال شد و چالش‌های قبلی بایگانی شدند.");
            await loadAdminChallenges();
          } catch (err: any) {
            setChallengeStatusMsg(err?.message || "ساخت چالش ناموفق بود.");
          } finally {
            setChallengeBusy(false);
          }
        };
        // Media is uploaded immediately so the admin sees a real preview before
        // publishing, and the challenge row only ever stores a stored path.
        const uploadChallengeImage = async (file: File) => {
          setChallengeMediaBusy("image");
          setChallengeStatusMsg("");
          try {
            if (!file.type.startsWith("image/")) throw new Error("فایل انتخابی تصویر نیست.");
            if (file.size > 5 * 1024 * 1024) throw new Error("حجم تصویر باید کمتر از ۵ مگابایت باشد.");
            const body = await uploadImageBlob(file, {
              fileName: file.name || "challenge.jpg",
              csrfToken: api.getToken(),
              fields: { visibility: "public" },
            });
            if (!body.url) throw new Error("بارگذاری تصویر بدون نشانی پایان یافت.");
            setChallengeImageUrl(String(body.url));
            setChallengeStatusMsg("تصویر چالش بارگذاری شد.");
          } catch (err: any) {
            setChallengeStatusMsg(err?.message || "بارگذاری تصویر ناموفق بود.");
          } finally {
            setChallengeMediaBusy(null);
            if (challengeImageInputRef.current) challengeImageInputRef.current.value = "";
          }
        };
        const uploadChallengeAudio = async (file: File) => {
          setChallengeMediaBusy("audio");
          setChallengeStatusMsg("");
          try {
            const { url } = await api.uploadChallengeAudio(file);
            setChallengeAudioUrl(url);
            setChallengeStatusMsg("فایل صوتی چالش بارگذاری شد.");
          } catch (err: any) {
            setChallengeStatusMsg(err?.message || "بارگذاری فایل صوتی ناموفق بود.");
          } finally {
            setChallengeMediaBusy(null);
            if (challengeAudioInputRef.current) challengeAudioInputRef.current.value = "";
          }
        };
        const moderate = async (entryId: string, action: "approve" | "reject") => {
          const token = api.getToken();
          if (!token) return;
          try {
            await api.moderateChallengeEntry(token, entryId, action);
            await loadAdminChallenges();
          } catch (err: any) {
            setChallengeStatusMsg(err?.message || "بررسی مشارکت ناموفق بود.");
          }
        };
        const toggleWinner = (challengeId: string, entryId: string) => {
          setChallengeWinnerDrafts((current) => {
            const selected = current[challengeId] || [];
            const next = selected.includes(entryId)
              ? selected.filter((id) => id !== entryId)
              : selected.length < 3 ? [...selected, entryId] : selected;
            return { ...current, [challengeId]: next };
          });
        };
        const saveWinners = async (challenge: any, announce: boolean) => {
          const token = api.getToken();
          if (!token) return;
          const rankedEntryIds = challengeWinnerDrafts[challenge.id] || [];
          setChallengeStatusMsg("");
          try {
            await api.saveChallengeWinners(token, challenge.id, rankedEntryIds, announce);
            setChallengeStatusMsg(announce ? "نام‌های برتر ذخیره و نتیجه اعلام شد." : "انتخاب برندگان ذخیره شد؛ نتیجه هنوز عمومی نیست.");
            await loadAdminChallenges();
          } catch (err: any) {
            setChallengeStatusMsg(err?.message || "ذخیره برندگان ناموفق بود.");
          }
        };
        return (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-orange-400" />
            <div>
              <h2 className="text-lg font-bold">مدیریت چالش‌های روزانه</h2>
              <p className="text-[10px] text-slate-500">چالش ادامهٔ داستان یا نام‌گذاری داستان از روی تصویر بسازید و مشارکت‌ها و برندگان را مدیریت کنید.</p>
            </div>
          </div>

          <form onSubmit={createChallenge} className={`grid grid-cols-1 gap-4 p-5 rounded-2xl border ${activeTheme.border} ${activeTheme.card}`}>
            <div>
              <label className="mb-2 block text-[11px] font-black text-slate-400">نوع چالش</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setChallengeType("continuation")} className={`rounded-xl border p-3 text-right text-xs font-bold transition ${challengeType === "continuation" ? "border-violet-500 bg-violet-500/15 text-violet-300" : `${activeTheme.border} text-slate-400`}`}>
                  ادامهٔ داستان
                  <span className="mt-1 block text-[9px] font-normal opacity-70">کاربر متن آغازین را ادامه می‌دهد</span>
                </button>
                <button type="button" onClick={() => setChallengeType("story_naming")} className={`rounded-xl border p-3 text-right text-xs font-bold transition ${challengeType === "story_naming" ? "border-orange-500 bg-orange-500/15 text-orange-300" : `${activeTheme.border} text-slate-400`}`}>
                  نام‌گذاری داستان
                  <span className="mt-1 block text-[9px] font-normal opacity-70">کاربر برای تصویر یک نام پیشنهاد می‌دهد</span>
                </button>
              </div>
            </div>
            <input
              value={challengeTitle}
              onChange={(e) => setChallengeTitle(e.target.value)}
              maxLength={140}
              placeholder={challengeType === "story_naming" ? "عنوان چالش — مثلاً: برای این تصویر نام بساز" : "عنوان چالش — مثلاً: چالش شب باران"}
              className={`w-full p-3 rounded-xl border text-xs ${adminControlClass}`}
            />
            <textarea
              value={challengePrompt}
              onChange={(e) => setChallengePrompt(e.target.value)}
              maxLength={5000}
              rows={5}
              placeholder={challengeType === "story_naming" ? "توضیح اختیاری برای تصویر و قوانین انتخاب نام..." : "متن آغازین داستان... (حداقل ۲۰ کاراکتر) — خواننده‌ها باید همین را ادامه بدهند."}
              className={`w-full p-3 rounded-xl border text-xs resize-y leading-relaxed ${adminControlClass}`}
            />
            {/* Optional picture and narration for the prompt. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={`rounded-xl border p-3 ${activeTheme.border}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
                    <ImagePlus className="h-3.5 w-3.5 text-violet-400" /> تصویر چالش ({challengeType === "story_naming" ? "الزامی" : "اختیاری"})
                  </span>
                  {challengeImageUrl && (
                    <button type="button" onClick={() => setChallengeImageUrl("")} className="text-slate-500 hover:text-rose-400" aria-label="حذف تصویر">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <input
                  ref={challengeImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadChallengeImage(file);
                  }}
                />
                {challengeImageUrl ? (
                  <img src={challengeImageUrl} alt="پیش‌نمایش تصویر چالش" className="max-h-32 w-full rounded-lg object-cover" />
                ) : (
                  <button
                    type="button"
                    onClick={() => challengeImageInputRef.current?.click()}
                    disabled={challengeMediaBusy !== null}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-600 py-4 text-[11px] font-bold text-slate-400 hover:border-violet-500 disabled:opacity-50"
                  >
                    {challengeMediaBusy === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {challengeMediaBusy === "image" ? "در حال بارگذاری…" : "انتخاب تصویر"}
                  </button>
                )}
              </div>

              <div className={`rounded-xl border p-3 ${activeTheme.border}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
                    <Music className="h-3.5 w-3.5 text-emerald-400" /> صدای چالش (اختیاری)
                  </span>
                  {challengeAudioUrl && (
                    <button type="button" onClick={() => setChallengeAudioUrl("")} className="text-slate-500 hover:text-rose-400" aria-label="حذف فایل صوتی">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <input
                  ref={challengeAudioInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/flac"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadChallengeAudio(file);
                  }}
                />
                {challengeAudioUrl ? (
                  <audio controls preload="none" src={challengeAudioUrl} className="w-full" />
                ) : (
                  <button
                    type="button"
                    onClick={() => challengeAudioInputRef.current?.click()}
                    disabled={challengeMediaBusy !== null}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-600 py-4 text-[11px] font-bold text-slate-400 hover:border-emerald-500 disabled:opacity-50"
                  >
                    {challengeMediaBusy === "audio" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}
                    {challengeMediaBusy === "audio" ? "در حال بارگذاری…" : "انتخاب فایل صوتی"}
                  </button>
                )}
                <p className="mt-1.5 text-[9px] text-slate-500">MP3، M4A، OGG، WAV، WebM یا FLAC — حداکثر ۱۵ مگابایت</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-mono text-slate-500">{challengePrompt.length}/5000</span>
              <button
                type="submit"
                /* A media-only prompt is valid, so the text minimum is waived
                   once a picture or narration has been attached. */
                disabled={
                  challengeBusy
                  || challengeMediaBusy !== null
                  || challengeTitle.trim().length < 3
                  || (challengeType === "story_naming"
                    ? !challengeImageUrl
                    : (challengePrompt.trim().length < 20 && !challengeImageUrl && !challengeAudioUrl))
                }
                className="rounded-xl bg-orange-600 px-6 py-2.5 text-xs font-black text-white transition hover:bg-orange-500 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {challengeBusy ? "در حال انتشار..." : "انتشار چالش"}
              </button>
            </div>
            {challengeStatusMsg && <p className="text-xs font-bold text-emerald-400">{challengeStatusMsg}</p>}
          </form>

          <div className="space-y-4">
            {adminChallenges.length === 0 ? (
              <div className={`p-8 text-center text-xs italic rounded-2xl border ${activeTheme.border} ${activeTheme.card} text-slate-500`}>هنوز چالشی ساخته نشده است.</div>
            ) : adminChallenges.map((challenge: any) => (
              <div key={challenge.id} className={`p-4 rounded-2xl border space-y-3 ${activeTheme.border} ${activeTheme.card}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black truncate">{challenge.title}</h3>
                    <p className="mt-0.5 text-[10px] text-slate-500 font-mono">
                      {challenge.challengeType === "story_naming" ? "نام‌گذاری داستان" : "ادامهٔ داستان"} · {new Date(challenge.createdAt).toLocaleString("fa-IR")} · {challenge.counts.approved} تأییدشده · {challenge.counts.pending} در انتظار · {challenge.counts.rejected} ردشده
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${challenge.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-slate-400"}`}>
                      {challenge.status === "active" ? "فعال" : "بایگانی"}
                    </span>
                    <button
                      onClick={() => { setEditingChallengeId(editingChallengeId === challenge.id ? null : challenge.id); setEditChallengeTitle(challenge.title); setEditChallengePrompt(challenge.promptText); }}
                      className="rounded-lg border border-violet-500/30 px-2.5 py-1 text-[10px] font-bold text-violet-400 hover:bg-violet-500/10 cursor-pointer"
                    >ویرایش</button>
                    {challenge.status === "active" && (
                      <button
                        onClick={async () => { const t = api.getToken(); if (t && window.confirm("این چالش بایگانی شود؟")) { await api.archiveChallenge(t, challenge.id); loadAdminChallenges(); } }}
                        className="rounded-lg border border-amber-500/30 px-2.5 py-1 text-[10px] font-bold text-amber-400 hover:bg-amber-500/10 cursor-pointer"
                      >بایگانی</button>
                    )}
                    <button
                      onClick={async () => { const t = api.getToken(); if (t && window.confirm("چالش و همهٔ مشارکت‌هایش برای همیشه حذف شود؟")) { await api.deleteChallenge(t, challenge.id); loadAdminChallenges(); } }}
                      className="rounded-lg border border-rose-500/30 p-1.5 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      title="حذف چالش"
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {challenge.promptText && (
                  <p className={`rounded-xl bg-black/20 p-3 text-xs leading-relaxed whitespace-pre-wrap ${isDark ? "text-slate-300" : "text-stone-700"}`}>{challenge.promptText}</p>
                )}

                {/* Attached prompt media, exactly as readers will see it. */}
                {(challenge.imageUrl || challenge.audioUrl) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {challenge.imageUrl && (
                      <img src={challenge.imageUrl} alt={`تصویر چالش ${challenge.title}`} loading="lazy" className="max-h-40 w-full rounded-xl object-cover" />
                    )}
                    {challenge.audioUrl && (
                      <audio controls preload="none" src={challenge.audioUrl} className="w-full self-center" />
                    )}
                  </div>
                )}

                {editingChallengeId === challenge.id && (
                  <div className="space-y-2 rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
                    <input
                      value={editChallengeTitle}
                      onChange={(e) => setEditChallengeTitle(e.target.value)}
                      maxLength={140}
                      placeholder="عنوان چالش"
                      className={`w-full p-2.5 rounded-lg border text-xs ${adminControlClass}`}
                    />
                    <textarea
                      value={editChallengePrompt}
                      onChange={(e) => setEditChallengePrompt(e.target.value)}
                      maxLength={5000}
                      rows={4}
                      placeholder="متن آغازین"
                      className={`w-full p-2.5 rounded-lg border text-xs resize-y leading-relaxed ${adminControlClass}`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const token = api.getToken();
                          if (!token) return;
                          try {
                            await api.updateChallenge(token, challenge.id, { title: editChallengeTitle, promptText: editChallengePrompt });
                            setEditingChallengeId(null);
                            setChallengeStatusMsg("چالش ویرایش شد.");
                            await loadAdminChallenges();
                          } catch (err: any) { setChallengeStatusMsg(err?.message || "ویرایش ناموفق بود."); }
                        }}
                        disabled={editChallengeTitle.trim().length < 3 || (challenge.challengeType !== "story_naming" && editChallengePrompt.trim().length < 20 && !challenge.imageUrl && !challenge.audioUrl)}
                        className="rounded-lg bg-violet-600 px-4 py-1.5 text-[10px] font-black text-white hover:bg-violet-500 disabled:opacity-40 cursor-pointer"
                      >ذخیره ویرایش</button>
                      <button onClick={() => setEditingChallengeId(null)} className="rounded-lg border border-slate-700/30 px-3 py-1.5 text-[10px] font-bold text-slate-400 cursor-pointer">انصراف</button>
                    </div>
                  </div>
                )}

                {challenge.challengeType === "story_naming" && (
                  <div className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="flex items-center gap-1.5 text-xs font-black text-amber-400"><Trophy className="h-3.5 w-3.5" /> نام‌های برتر</h4>
                        <p className="mt-1 text-[9px] text-slate-500">از فهرست پایین حداکثر سه نام را به ترتیب رتبه انتخاب کنید.</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${challenge.winnersAnnouncedAt ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-slate-400"}`}>
                        {challenge.winnersAnnouncedAt ? "نتیجه اعلام شده" : "بدون اعلام برنده"}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[0, 1, 2].map((index) => {
                        const entryId = (challengeWinnerDrafts[challenge.id] || [])[index];
                        const entry = (challenge.entries || []).find((item: any) => item.id === entryId);
                        return (
                          <div key={index} className={`rounded-lg border p-2 ${activeTheme.border}`}>
                            <span className="text-[9px] font-black text-amber-500">رتبهٔ {(index + 1).toLocaleString("fa-IR")}</span>
                            <p className="mt-1 truncate text-[11px] font-bold">{entry?.content || "انتخاب نشده"}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => saveWinners(challenge, false)} className="rounded-lg border border-slate-500/30 px-3 py-1.5 text-[10px] font-bold text-slate-400 hover:bg-slate-500/10">ذخیره بدون اعلام</button>
                      <button onClick={() => saveWinners(challenge, true)} disabled={(challengeWinnerDrafts[challenge.id] || []).length === 0} className="rounded-lg bg-amber-600 px-3 py-1.5 text-[10px] font-black text-white hover:bg-amber-500 disabled:opacity-40">اعلام برندگان</button>
                      {challenge.winnersAnnouncedAt && (
                        <button onClick={() => saveWinners(challenge, false)} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-[10px] font-bold text-rose-400 hover:bg-rose-500/10">لغو نمایش نتیجه</button>
                      )}
                    </div>
                  </div>
                )}

                {(challenge.entries || []).length > 0 && (
                  <div className="space-y-2">
                    {challenge.entries.map((entry: any) => (
                      <div key={entry.id} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-start ${activeTheme.border} ${entry.moderationStatus === "pending" ? "border-amber-500/25" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-violet-400">@{entry.username}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              entry.moderationStatus === "approved" ? "bg-emerald-500/15 text-emerald-400"
                              : entry.moderationStatus === "rejected" ? "bg-rose-500/15 text-rose-400"
                              : "bg-amber-500/15 text-amber-400"
                            }`}>
                              {entry.moderationStatus === "approved" ? "تأییدشده" : entry.moderationStatus === "rejected" ? "ردشده" : "در انتظار"}
                            </span>
                          </div>
                          <p className="line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-350" dir="rtl">{entry.content}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {challenge.challengeType === "story_naming" && entry.moderationStatus === "approved" && (
                            <button
                              onClick={() => toggleWinner(challenge.id, entry.id)}
                              disabled={!(challengeWinnerDrafts[challenge.id] || []).includes(entry.id) && (challengeWinnerDrafts[challenge.id] || []).length >= 3}
                              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black disabled:opacity-30 ${(challengeWinnerDrafts[challenge.id] || []).includes(entry.id) ? "bg-amber-500 text-black" : "border border-amber-500/30 text-amber-400 hover:bg-amber-500/10"}`}
                            >
                              {(challengeWinnerDrafts[challenge.id] || []).includes(entry.id)
                                ? `رتبهٔ ${((challengeWinnerDrafts[challenge.id] || []).indexOf(entry.id) + 1).toLocaleString("fa-IR")}`
                                : "انتخاب برنده"}
                            </button>
                          )}
                          {entry.moderationStatus !== "approved" && (
                            <button onClick={() => moderate(entry.id, "approve")} className="rounded-lg bg-emerald-600/90 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-emerald-500 cursor-pointer">تأیید</button>
                          )}
                          {entry.moderationStatus === "pending" && (
                            <button onClick={() => moderate(entry.id, "reject")} className="rounded-lg bg-amber-600/90 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-amber-500 cursor-pointer">رد</button>
                          )}
                          <button
                            onClick={async () => { const t = api.getToken(); if (t && window.confirm("این مشارکت حذف شود؟")) { await api.deleteChallengeEntry(t, entry.id); loadAdminChallenges(); } }}
                            className="rounded-lg border border-rose-500/30 p-1.5 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                            title="حذف"
                          ><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        );
      })()}

      {/* Segment: Events Manager */}
      {activeSegment === "events" && userRole === "owner" && (() => {
        const addExclusion = async () => {
          const token = api.getToken();
          if (!token || !exclusionUsername.trim()) return;
          setEventStatusMsg("");
          try {
            await api.addEventExclusion(token, exclusionUsername.trim());
            setExclusionUsername("");
            setEventStatusMsg("نویسنده به فهرست مستثناها اضافه شد.");
            setEventOverview(await api.getEventAdminOverview(token));
          } catch (err: any) {
            setEventStatusMsg(err?.message || "افزودن استثنا ناموفق بود.");
          }
        };
        return (
        <div className="space-y-5">
          {/* Full event life cycle: create, edit, feature, archive, delete. */}
          <Suspense fallback={<div className="p-6 text-center text-xs text-slate-500">در حال بارگذاری مدیریت رویدادها…</div>}>
            <EventManager
              theme={theme}
              controlClass={adminControlClass}
              borderClass={activeTheme.border}
              cardClass={activeTheme.card}
            />
          </Suspense>

          <div className="flex items-center gap-2 border-t border-slate-700/20 pt-5">
            <Trophy className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-lg font-bold">سلامت جدول امتیازها</h2>
              <p className="text-[10px] text-slate-500">{eventOverview?.event?.title || "رویداد بازدیدهای اوت"} — وضعیت: {{ upcoming: "هنوز شروع نشده", active: "در جریان", completed: "پایان‌یافته" }[eventOverview?.event?.phase as string] || "-"}</p>
            </div>
          </div>

          {!eventOverview ? (
            <div className={`p-8 text-center text-xs italic rounded-2xl border ${activeTheme.border} ${activeTheme.card} text-slate-500`}>{eventStatusMsg || "در حال بارگذاری..."}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "رمان‌های واجد شرایط", val: eventOverview.stats.eligibleNovels, color: "text-violet-300", bg: "bg-violet-500/10" },
                  { label: "رمان‌های رتبه‌دار", val: eventOverview.stats.rankedNovels, color: "text-fuchsia-300", bg: "bg-fuchsia-500/10" },
                  { label: "بازدیدهای رویداد", val: eventOverview.stats.eligibleViews, color: "text-emerald-300", bg: "bg-emerald-500/10" },
                  { label: "نویسندگان مستثنا", val: eventOverview.stats.excludedAuthors, color: "text-amber-300", bg: "bg-amber-500/10" },
                ].map((card, idx) => (
                  <div key={idx} className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} ${card.bg}`}>
                    <p className={`text-xl font-black ${card.color}`}>{Number(card.val || 0).toLocaleString("fa-IR")}</p>
                    <p className="mt-1 text-[9px] font-mono uppercase text-slate-500">{card.label}</p>
                  </div>
                ))}
              </div>

              {/* Daily activity */}
              {(eventOverview.dailyActivity || []).length > 0 && (
                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card}`}>
                  <h3 className="mb-3 text-[11px] font-black uppercase tracking-wider text-slate-400">فعالیت روزانهٔ بازدیدهای رویداد</h3>
                  <div className="flex h-28 items-end gap-1 overflow-x-auto pb-1">
                    {eventOverview.dailyActivity.map((day: any) => {
                      const max = Math.max(...eventOverview.dailyActivity.map((d: any) => d.views), 1);
                      return (
                        <div key={day.day} className="group relative min-w-[14px] flex-1" title={`${new Date(day.day).toLocaleDateString("fa-IR")}: ${day.views.toLocaleString("fa-IR")} بازدید`}>
                          <div className="w-full rounded-t bg-gradient-to-t from-cyan-600 to-violet-500 opacity-80 group-hover:opacity-100" style={{ height: `${Math.max(6, (day.views / max) * 96)}px` }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top ten + exclusions side by side */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-2`}>
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">۱۰ رمان برتر</h3>
                  {(eventOverview.topTen || []).length === 0 ? (
                    <p className="py-6 text-center text-xs italic text-slate-500">هنوز رتبه‌ای ثبت نشده است.</p>
                  ) : eventOverview.topTen.map((row: any) => (
                    <div key={row.novelId} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                      <span className="min-w-0 truncate text-[11px] font-bold text-slate-200">
                        <span className="ml-1 inline-block w-6 rounded bg-cyan-500/15 text-center text-[10px] font-black text-cyan-300">{row.rank}</span>
                        {row.title}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] font-bold text-cyan-300">{row.eventViews.toLocaleString("fa-IR")}</span>
                    </div>
                  ))}
                </div>

                <div className={`p-4 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-3`}>
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">استثنا کردن نویسنده از رویداد</h3>
                  <div className="flex gap-2">
                    <input
                      value={exclusionUsername}
                      onChange={(e) => setExclusionUsername(e.target.value)}
                      placeholder="نام کاربری نویسنده..."
                      className={`min-w-0 flex-1 p-2.5 rounded-xl border text-xs ${adminControlClass}`}
                    />
                    <button onClick={addExclusion} className="shrink-0 rounded-xl bg-cyan-600 px-4 py-2 text-[11px] font-black text-white hover:bg-cyan-500 cursor-pointer">استثنا</button>
                  </div>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar">
                    {(eventOverview.excludedAuthors || []).map((item: any) => (
                      <div key={item.userId} className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-1.5">
                        <span className="truncate font-mono text-[10px] text-slate-400">{item.matchedName || item.userId}</span>
                        <button
                          onClick={async () => { const t = api.getToken(); if (t && await api.removeEventExclusion(t, item.userId)) { setEventOverview(await api.getEventAdminOverview(t)); } }}
                          className="shrink-0 rounded p-1 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          title="حذف از استثناها"
                        ><Trash2 className="w-3 h-3" /></button>
                      </div>
                    ))}
                    {(eventOverview.excludedAuthors || []).length === 0 && <p className="py-2 text-center text-[10px] italic text-slate-500">فهرست خالی است.</p>}
                  </div>

                  <div className={`border-t pt-3 ${activeTheme.border}`}>
                    <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">پاک‌سازی بازدیدهای مشکوک یک رمان</h3>
                    <div className="flex gap-2">
                      <input
                        value={eventClearNovelId}
                        onChange={(e) => setEventClearNovelId(e.target.value)}
                        placeholder="شناسه رمان..."
                        className={`min-w-0 flex-1 p-2.5 rounded-xl border text-xs font-mono ${adminControlClass}`}
                      />
                      <button
                        onClick={async () => {
                          const token = api.getToken();
                          if (!token || !eventClearNovelId.trim()) return;
                          if (!window.confirm("همهٔ بازدیدهای رویداد این رمان پاک شود؟")) return;
                          try {
                            const result = await api.clearEventNovelViews(token, eventClearNovelId.trim());
                            setEventStatusMsg(`${result.removedViews ?? 0} بازدید پاک شد.`);
                            setEventClearNovelId("");
                            setEventOverview(await api.getEventAdminOverview(token));
                          } catch (err: any) {
                            setEventStatusMsg(err?.message || "پاک‌سازی ناموفق بود.");
                          }
                        }}
                        className="shrink-0 rounded-xl bg-rose-600 px-4 py-2 text-[11px] font-black text-white hover:bg-rose-500 cursor-pointer"
                      >پاک‌سازی</button>
                    </div>
                  </div>
                </div>
              </div>
              {eventStatusMsg && <p className="text-xs font-bold text-emerald-400">{eventStatusMsg}</p>}
            </>
          )}
        </div>
        );
      })()}

      {/* Segment: Email Server */}
      {activeSegment === "email" && userRole === "owner" && (() => {
        const saveSmtp = async (event: React.FormEvent) => {
          event.preventDefault();
          const token = api.getToken();
          if (!token) return;
          setEmailBusy(true);
          setEmailMsg("");
          try {
            await api.saveEmailSmtpConfig(token, {
              host: emailHost,
              port: Number(emailPort) || 587,
              secure: emailSecure,
              user: emailUser,
              pass: emailPass || undefined,
              from: emailFrom,
              direct: emailDirect,
              verificationEnabled: emailVerificationToggle || emailStatus?.provider?.enabled
            });
            setEmailStatus(await api.getEmailServerStatus(token));
            setEmailMsg("پیکربندی ایمیل ذخیره شد.");
          } catch (err: any) {
            setEmailMsg(err?.message || "ذخیره پیکربندی ناموفق بود.");
          } finally {
            setEmailBusy(false);
          }
        };
        return (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-sky-400" />
            <div>
              <h2 className="text-lg font-bold">راه‌اندازی ایمیل سرور</h2>
              <p className="text-[10px] text-slate-500">مرحله‌به‌مرحله: پیکربندی SMTP یا ارسال مستقیم با پورت ۲۵، تست ارسال و فعال‌سازی دریافت.</p>
            </div>
          </div>

          {!emailStatus ? (
            <div className={`p-8 text-center text-xs italic rounded-2xl border ${activeTheme.border} ${activeTheme.card} text-slate-500`}>{emailMsg || "در حال بارگذاری..."}</div>
          ) : (
            <>
              {/* Step 0: status */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "SMTP کامل", ok: emailStatus.provider.availability.smtp },
                  { label: "ارسال مستقیم (25)", ok: emailStatus.provider.availability.direct },
                  { label: "تأیید ایمیل فعال", ok: !!emailStatus.provider.enabled && emailStatus.provider.availability.any },
                  { label: "دریافت فعال", ok: emailStatus.inbound?.running }
                ].map((item, idx) => (
                  <div key={idx} className={`p-3 rounded-2xl border ${activeTheme.border} ${activeTheme.card} flex items-center gap-2`}>
                    {item.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <Ban className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className="text-[11px] font-bold">{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Step 1: SMTP / direct config */}
              <form onSubmit={saveSmtp} className={`p-5 rounded-2xl border space-y-4 ${activeTheme.border} ${activeTheme.card}`}>
                <h3 className="text-sm font-black">۱. پیکربندی ارسال</h3>
                <label className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-slate-700/20 cursor-pointer">
                  <span className="text-xs font-bold">ارسال مستقیم روی سرور (پورت ۲۵، بدون رله)</span>
                  <input type="checkbox" checked={emailDirect} onChange={(e) => { setEmailDirect(e.target.checked); if (e.target.checked) setEmailPort("25"); }} className="w-4 h-4" />
                </label>
                {!emailDirect ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={emailHost} onChange={(e) => setEmailHost(e.target.value)} placeholder="SMTP Host — مثلاً mail.reptoc.xyz" className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                    <div className="flex items-center gap-2">
                      <input value={emailPort} onChange={(e) => setEmailPort(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="پورت (587/465/25)" className={`min-w-0 flex-1 p-3 rounded-xl border text-xs ${adminControlClass}`} />
                      <label className="flex items-center gap-1.5 text-xs shrink-0"><input type="checkbox" checked={emailSecure} onChange={(e) => setEmailSecure(e.target.checked)} className="w-4 h-4" /> SSL/TLS</label>
                    </div>
                    <input value={emailUser} onChange={(e) => setEmailUser(e.target.value)} placeholder="نام کاربری" autoComplete="off" className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                    <input type="password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} placeholder={emailStatus.smtp.hasPassword ? "رمز عبور (ذخیره شده)" : "رمز عبور"} autoComplete="new-password" className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-400 bg-amber-500/10 rounded-xl p-3">
                    در حالت مستقیم، سرور خودتان ایمیل را مستقیم به MX گیرنده تحویل می‌دهد. مطمئن شوید پورت ۲۵ سرور باز است، رکوردهای SPF/DKIM دامنه تنظیم شده و IP در بلک‌لیست نیست.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="آدرس فرستنده — noreply@reptoc.xyz" className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                  <label className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-slate-700/20 cursor-pointer">
                    <span className="text-xs font-bold">الزام تأیید ایمیل هنگام ثبت‌نام</span>
                    <input type="checkbox" checked={emailVerificationToggle || emailStatus.provider.enabled === true} onChange={(e) => setEmailVerificationToggle(e.target.checked)} className="w-4 h-4" />
                  </label>
                </div>
                <button type="submit" disabled={emailBusy} className="rounded-xl bg-sky-600 px-6 py-2.5 text-xs font-black text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer">
                  {emailBusy ? "..." : "ذخیره مرحلهٔ ارسال"}
                </button>
              </form>

              {/* Step 2: test send */}
              <div className={`p-5 rounded-2xl border space-y-3 ${activeTheme.border} ${activeTheme.card}`}>
                <h3 className="text-sm font-black">۲. تست ارسال</h3>
                <TestSendRow busy={emailBusy} onSend={async (to) => {
                  const token = api.getToken();
                  if (!token) return;
                  setEmailMsg("");
                  try { await api.sendEmailTest(token, to); setEmailMsg(`ایمیل آزمایشی به ${to} ارسال شد.`); }
                  catch (err: any) { setEmailMsg(err?.message || "ارسال آزمایشی ناموفق بود."); }
                }} />
              </div>

              {/* Step 3: inbound */}
              <div className={`p-5 rounded-2xl border space-y-3 ${activeTheme.border} ${activeTheme.card}`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black">۳. دریافت ایمیل (SMTP ورودی)</h3>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${emailStatus.inbound?.running ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-slate-400"}`}>
                    {emailStatus.inbound?.running ? `فعال روی :${emailStatus.inbound.port}` : "غیرفعال"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_auto] gap-2">
                  <input value={inboundDomain} onChange={(e) => setInboundDomain(e.target.value)} placeholder={`دامنهٔ پذیرنده — مثلاً reptoc.xyz`} className={`p-3 rounded-xl border text-xs ${adminControlClass}`} />
                  <input value={inboundPort} onChange={(e) => setInboundPort(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="پورت" className={`p-3 rounded-xl border text-xs font-mono ${adminControlClass}`} />
                  <input value={inboundHost} onChange={(e) => setInboundHost(e.target.value)} placeholder="127.0.0.1" className={`p-3 rounded-xl border text-xs font-mono ${adminControlClass}`} title="آدرس Bind — پیش‌فرض امن فقط لوکال است" />
                  <button
                    onClick={async () => {
                      const token = api.getToken();
                      if (!token) return;
                      setEmailMsg("");
                      try {
                        const result = await api.toggleEmailInbound(token, { enabled: !inboundEnabled, port: Number(inboundPort) || 25, domain: inboundDomain, host: inboundHost.trim() || "127.0.0.1" });
                        setInboundEnabled(result.inbound?.running === true);
                        setEmailMsg(result.inbound?.running ? `دریافت ایمیل روی ${result.inbound.host}:${result.inbound.port} فعال شد.` : "دریافت ایمیل غیرفعال شد.");
                      } catch (err: any) { setEmailMsg(err?.message || "خطا در تغییر وضعیت دریافت."); }
                    }}
                    className={`shrink-0 rounded-xl px-5 py-2 text-xs font-black text-white cursor-pointer ${inboundEnabled ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
                  >
                    {inboundEnabled ? "توقف دریافت" : "شروع دریافت"}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Host پیش‌فرض «127.0.0.1» است؛ فقط اگر سرور ایمیل باید از بیرون قابل دسترس باشد آدرس عمومی (مثلاً 0.0.0.0) بگذارید و فایروال را محدود کنید.</p>

                {(inboundMessages.length > 0) && (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar pt-2">
                    {inboundMessages.map((message) => (
                      <div key={message.id} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                        <button onClick={async () => { const token = api.getToken(); if (token) setOpenInboundMessage(await api.readInboundEmail(token, message.id)); }} className="min-w-0 text-right cursor-pointer">
                          <span className="block truncate text-[11px] font-bold text-slate-200">{message.subject || "(بدون موضوع)"}</span>
                          <span className="block truncate text-[9px] font-mono text-slate-500">{message.envelope_from} → {message.envelope_to}</span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="font-mono text-[9px] text-slate-500">{new Date(message.received_at).toLocaleDateString("fa-IR")}</span>
                          <button onClick={async () => { const token = api.getToken(); if (token && await api.deleteInboundEmail(token, message.id)) setInboundMessages((prev) => prev.filter((m) => m.id !== message.id)); }} className="rounded p-1 text-rose-400 hover:bg-rose-500/10 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {emailMsg && <p className="text-xs font-bold text-emerald-400">{emailMsg}</p>}

              {openInboundMessage && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setOpenInboundMessage(null)}>
                  <div className={`max-w-2xl w-full max-h-[80vh] overflow-auto rounded-2xl border p-5 space-y-3 ${activeTheme.border} ${activeTheme.card}`} onClick={(e) => e.stopPropagation()}>
                    <h4 className="font-black text-sm">{openInboundMessage.subject || "(بدون موضوع)"}</h4>
                    <p className="font-mono text-[10px] text-slate-500">{openInboundMessage.envelope_from} → {openInboundMessage.envelope_to} · {new Date(openInboundMessage.received_at).toLocaleString("fa-IR")}</p>
                    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed bg-black/30 rounded-xl p-3 max-h-96 overflow-auto">{openInboundMessage.raw}</pre>
                    <button onClick={() => setOpenInboundMessage(null)} className="rounded-xl bg-violet-600 px-4 py-2 text-[11px] font-bold text-white cursor-pointer">بستن</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        );
      })()}

      {/* Segment: Categories Manager */}
      {activeSegment === "categories" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Tags className="w-5 h-5 text-fuchsia-500" />
            <h2 className="text-lg font-bold tracking-tight">مدیریت طبقه‌بندی و دسته‌بندی‌ها</h2>
          </div>

          <form onSubmit={handleSaveSettings} className={`p-6 rounded-2xl border ${activeTheme.border} ${activeTheme.card} space-y-6 text-left ${activeTheme.shadow}`}>
            
            <CategoryManager 
               title="دسته‌های اصلی سراسری رمان‌ها" 
               itemsJson={mainCategoriesJson} 
               onChange={setMainCategoriesJson} 
               isDark={isDark} 
            />

            <CategoryManager 
               title="زیردسته‌های سراسری رمان‌ها" 
               itemsJson={subCategoriesJson} 
               onChange={setSubCategoriesJson} 
               isDark={isDark} 
            />

            <CategoryManager 
               title="ژانرهای سراسری" 
               itemsJson={genresJson} 
               onChange={setGenresJson} 
               isDark={isDark} 
            />

            <CategoryManager 
               title="انجمن‌ها: دسته‌های موضوع" 
               itemsJson={forumCategoriesJson} 
               onChange={setForumCategoriesJson} 
               isDark={isDark} 
            />

            <div className="flex items-center justify-between pt-3 border-t border-slate-800/10 dark:border-violet-950/15">
              <span className="text-fuchsia-500 text-xs font-bold uppercase font-mono">
                {isSaved ? "✓ دسته‌بندی‌ها با سرور همگام شد!" : ""}
              </span>
              <button
                type="submit"
                className="px-6 py-2.5 bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white text-xs font-black uppercase tracking-wider font-mono rounded-xl hover:from-fuchsia-500 hover:to-purple-500 transition shadow cursor-pointer shadow-fuchsia-500/10"
              >
                ذخیره دسته‌بندی‌ها
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Segment 4: Support Tickets */}
      {activeSegment === "tickets" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 xl:gap-6 items-start min-h-[520px] lg:max-h-[calc(100vh-220px)]">
          {/* Tickets List */}
          <div className={`lg:col-span-4 p-4 rounded-2xl border flex flex-col min-h-[320px] lg:h-full ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
            <h2 className="text-sm font-bold tracking-tight mb-4 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-500" />
              <span>تیکت‌های مدیریت</span>
            </h2>
            <div className="flex-grow overflow-y-auto space-y-2 pr-1">
              {tickets.map(ticket => (
                <div 
                  key={ticket.id} 
                  onClick={() => selectAdminTicket(ticket)}
                  className={`p-3 text-left rounded-xl border cursor-pointer transition-all ${
                    selectedTicket?.id === ticket.id 
                      ? "bg-emerald-500/10 border-emerald-500" 
                      : isDark ? "bg-black/40 border-slate-800 hover:border-emerald-500" : "bg-stone-50 border-stone-200 hover:border-emerald-500"
                  }`}
                >
                  <h4 className="font-bold text-[11px] line-clamp-1">{ticket.title}</h4>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[9px] text-slate-500">{new Date(ticket.created_at).toLocaleDateString('fa-IR')}</p>
                    <div className="flex gap-1 items-center">
                      <span className="px-1 py-[1px] rounded bg-slate-800 text-slate-300 text-[8px] font-bold uppercase">{ticket.category || 'General'}</span>
                      <span className={`px-1.5 py-[1px] rounded text-[8px] font-bold font-mono ${
                        ticket.status === 'OPEN' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 
                        ticket.status === 'CLOSED' ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30' :
                        'bg-violet-500/20 text-violet-500 border border-violet-500/30'
                      }`}>
                        {ticket.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ticket Messages */}
          <div className={`lg:col-span-8 p-4 rounded-2xl border flex flex-col min-h-[420px] lg:h-full ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow}`}>
            {selectedTicket ? (
              <>
                <div className="flex items-start justify-between pb-3 border-b border-slate-800/10 dark:border-violet-950/20 mb-3 text-left">
                  <div>
                    <h3 className="font-bold text-sm">{selectedTicket.title}</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">شناسه تیکت: {selectedTicket.id}</p>
                  </div>
                  <div className="flex gap-2 text-[10px]">
                    <button onClick={() => changeTicketStatus('OPEN')} className="px-2 py-1 rounded bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition">باز</button>
                    <button onClick={() => changeTicketStatus('PENDING')} className="px-2 py-1 rounded bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition">در انتظار</button>
                    <button onClick={() => changeTicketStatus('CLOSED')} className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition">بستن</button>
                    <button onClick={removeSelectedTicket} className="px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-500 transition">حذف</button>
                  </div>
                </div>

                <div className="flex-grow overflow-y-auto space-y-4 pr-2 mb-3">
                  {ticketMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.is_admin ? "justify-end" : "justify-start"}`}>
                      <div className={`p-3 max-w-[80%] rounded-2xl text-xs text-left shadow-xs ${
                        msg.is_admin 
                          ? "bg-emerald-600 text-white rounded-tr-none"
                          : isDark 
                            ? "bg-[#0e0a1c] border border-violet-950 text-slate-300 rounded-tl-none" 
                            : "bg-stone-50 border border-stone-200 text-stone-800 rounded-tl-none"
                      }`}>
                        <div className="font-bold mb-1 opacity-75 text-[9px] uppercase tracking-wider font-mono">
                          {msg.is_admin ? msg.sender || "مدیر" : msg.sender || "کاربر"}
                        </div>
                        <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={sendAdminTicketReply} className="flex gap-2 shrink-0">
                  <textarea
                    rows={2}
                    placeholder="راه‌حل رسمی پشتیبانی را بنویسید..."
                    value={ticketReply}
                    onChange={e => setTicketReply(e.target.value)}
                    className={`flex-grow px-3 py-2 text-xs rounded-xl focus:outline-none border resize-none ${
                      isDark ? "bg-black border-slate-800 text-white focus:border-emerald-500" : "bg-stone-50 border-stone-200 focus:border-emerald-500"
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={!ticketReply.trim()}
                    className="px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl cursor-pointer shrink-0 font-bold text-[10px] uppercase font-mono transition-all disabled:opacity-50"
                  >
                    Reply
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
                <ShieldAlert className="w-8 h-8 opacity-40" />
                <p className="text-xs">برای مشاهده گفت‌وگو یک تیکت انتخاب کنید.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approve Reason modal */}
      {selectedReport && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => !reportBusy && setSelectedReport(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#0b0716] border border-rose-900/40 text-white rounded-3xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl text-left">
            <div className="flex justify-between gap-4"><div><h3 className="font-black">بررسی گزارش تخلف</h3><p className="text-[10px] text-slate-500">{selectedReport.report.id} · {selectedReport.report.status}</p></div><button onClick={() => setSelectedReport(null)} className="text-slate-400 hover:text-white">بستن</button></div>
            <div className="grid md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-800 p-3"><div className="text-[9px] uppercase text-slate-500 font-black">گزارش‌دهنده</div><div className="font-bold mt-1">{selectedReport.reporter?.nickname || selectedReport.reporter?.username || "کاربر حذف‌شده"}</div><div className="font-mono text-[10px] text-slate-500">{selectedReport.reporter?.id || selectedReport.report.reporter_id}</div></div>
              <div className="rounded-xl border border-slate-800 p-3"><div className="text-[9px] uppercase text-slate-500 font-black">حساب هدف</div><div className="font-bold mt-1">{selectedReport.targetUser?.nickname || selectedReport.targetUser?.username || "در دسترس نیست"}</div><div className="font-mono text-[10px] text-slate-500">{selectedReport.targetUser?.id || selectedReport.report.target_user_id || "حساب مرتبطی نیست"}</div></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-800/20 pt-5">
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-slate-400">قوانین و شرایط خدمات</label>
                <textarea value={rulesText} onChange={(e) => setRulesText(e.target.value)} rows={8} maxLength={20000} className={`w-full p-3 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-slate-400">بنر اصلی صفحه اصلی</label>
                <input value={mainBannerImage} onChange={(e) => setMainBannerImage(e.target.value)} placeholder="HTTPS URL تصویر" className={`w-full p-3 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
                <input value={mainBannerTitle} onChange={(e) => setMainBannerTitle(e.target.value)} placeholder="عنوان بنر" className={`w-full p-3 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
                <input value={mainBannerSubtitle} onChange={(e) => setMainBannerSubtitle(e.target.value)} placeholder="زیرعنوان برجسته" className={`w-full p-3 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
                <textarea value={mainBannerDescription} onChange={(e) => setMainBannerDescription(e.target.value)} placeholder="توضیحات بنر" rows={3} className={`w-full p-3 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-800/20 pt-5">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">بررسی منشأ AI ویرایشگر</h3><p className="text-[10px] text-slate-500">تنظیم سرویس‌دهنده استفاده‌شده توسط اسکن «بررسی AI» ویرایشگر.</p></div><input type="checkbox" checked={aiDetectionEnabled} onChange={(e) => setAiDetectionEnabled(e.target.checked)} /></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <select value={aiDetectionProvider} onChange={(e) => setAiDetectionProvider(e.target.value)} className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`}><option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="groq">Groq</option></select>
                <input value={aiDetectionModel} onChange={(e) => setAiDetectionModel(e.target.value)} placeholder="نام مدل" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
                <button type="button" onClick={saveAiSettings} disabled={loadingAiSettings} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white">ذخیره پیکربندی AI</button>
                <input type="password" value={aiGeminiApiKey} onChange={(e) => setAiGeminiApiKey(e.target.value)} placeholder="کلید API Gemini" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
                <input type="password" value={aiOpenAIApiKey} onChange={(e) => setAiOpenAIApiKey(e.target.value)} placeholder="کلید API OpenAI" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
                <input type="password" value={aiGroqApiKey} onChange={(e) => setAiGroqApiKey(e.target.value)} placeholder="کلید API Groq" className={`p-2 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
              </div>
              <textarea value={aiDetectionPrompt} onChange={(e) => setAiDetectionPrompt(e.target.value)} rows={5} maxLength={5000} placeholder="پرامپت پایه تشخیص" className={`w-full p-3 text-xs rounded-xl border ${isDark ? "bg-[#0e0a1c] border-violet-950 text-white" : "bg-white border-stone-200"}`} />
            </div>
            <div className="rounded-xl border border-slate-800 p-3 space-y-1"><div className="text-[9px] uppercase text-slate-500 font-black">شکایت</div><div className="font-bold text-rose-300">{selectedReport.report.reason}</div><p className="text-xs whitespace-pre-wrap">{selectedReport.report.details}</p></div>
            <div className="rounded-xl border border-amber-900/30 bg-amber-500/5 p-3 space-y-2"><div className="text-[9px] uppercase text-amber-500 font-black">هدف دقیق گزارش‌شده · {selectedReport.report.target_type}</div><div className="text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{selectedReport.target?.content || selectedReport.target?.snippet || selectedReport.target?.description || selectedReport.target?.title || selectedReport.target?.username || "هدف حذف شده است؛ تصویر لحظه‌ای ذخیره‌شده در ادامه می‌آید."}</div><pre className="text-[9px] text-slate-500 whitespace-pre-wrap break-all">{JSON.stringify(selectedReport.target, null, 2)}</pre></div>
            <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-400">یادداشت مدیر</span><textarea rows={3} value={reportNote} onChange={(e) => setReportNote(e.target.value)} className="w-full rounded-xl bg-black border border-slate-700 p-3 text-xs resize-none" /></label>
            {selectedReport.canPunish && <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-400">در صورت پذیرش، تنبیه</span><select value={reportPunishment} onChange={(e) => setReportPunishment(e.target.value)} className="w-full rounded-xl bg-black border border-slate-700 p-3 text-xs"><option value="none">بدون تنبیه</option><option value="warn">تذکر</option><option value="publishing_block">مسدودسازی انتشار</option><option value="account_block">مسدودسازی حساب</option></select></label>}
            <div className="flex justify-end gap-2"><button disabled={reportBusy} onClick={() => decideReport("rejected")} className="px-4 py-2 rounded-xl bg-slate-700 text-xs font-bold">رد گزارش</button><button disabled={reportBusy} onClick={() => decideReport("approved")} className="px-4 py-2 rounded-xl bg-rose-600 text-xs font-bold">پذیرش گزارش{reportPunishment !== "none" ? " و تنبیه" : ""}</button></div>
          </div>
        </div>
      )}

      {approvingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0b0716] border border-violet-950 text-white rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl relative z-10 text-left">
            <h3 className="text-base font-bold font-sans flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="w-5 h-5" />
              <span>تأیید و انتشار سری</span>
            </h3>
            
            <p className="text-xs text-slate-400">
              یادداشت سردبیری یا پیام تشویق‌آمیز برای نویسنده ضمیمه کنید (اختیاری).
            </p>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full p-3 h-24 text-xs bg-black border border-violet-900/40 rounded-xl text-white focus:outline-none focus:border-emerald-500 font-mono"
            />

            <div className="flex gap-2 justify-end pt-2 text-[11px] font-mono">
              <button
                onClick={() => setApprovingId(null)}
                className="px-4 py-2 border border-slate-700/30 text-slate-450 hover:text-white rounded-xl transition cursor-pointer"
              >
                لغو
              </button>
              <button
                onClick={submitApprove}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition cursor-pointer"
              >
                تأیید نهایی
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0b0716] border border-violet-950 text-white rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl relative z-10 text-left">
            <h3 className="text-base font-bold font-sans flex items-center gap-2 text-rose-500">
              <ShieldAlert className="w-5 h-5" />
              <span>رد سری پیش‌نویس</span>
            </h3>
            
            <p className="text-xs text-slate-400">
              بازخورد تحلیلی و دقیق ممیزی برای کمک به نویسنده بنویسید.
            </p>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full p-3 h-28 text-xs bg-black border border-violet-900/40 rounded-xl text-white focus:outline-none focus:border-rose-500 font-mono"
            />

            <div className="flex gap-2 justify-end pt-2 text-[11px] font-mono">
              <button
                onClick={() => setRejectingId(null)}
                className="px-4 py-2 border border-slate-700/30 text-slate-450 hover:text-white rounded-xl transition cursor-pointer"
              >
                لغو
              </button>
              <button
                onClick={submitReject}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition cursor-pointer"
              >
                تأیید رد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

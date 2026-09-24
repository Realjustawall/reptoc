import React, { useState } from "react";
import ReactCrop, { Crop, PixelCrop } from "react-image-crop";
import { getRegistrationErrors } from "../utils/registrationValidation";
import "react-image-crop/dist/ReactCrop.css";
import { motion } from "motion/react";
import { 
  Award, 
  Flame, 
  Trophy, 
  Search, 
  BookOpen, 
  Users, 
  Settings, 
  BookMarked, 
  MessageSquare, 
  BarChart3, 
  TrendingUp, 
  Sparkles, 
  Clock, 
  Compass, 
  ArrowLeft, 
  Calendar, 
  CheckCircle2, 
  Star, 
  ThumbsUp, 
  Activity,
  Milestone,
  Heart,
  Lock,
  User,
  LogIn,
  LogOut,
  Shield,
  KeyRound,
  Laptop,
  Book,
  Library,
  PenTool,
  Eye,
  Crown,
  CheckCircle,
   Moon,
   X,
   Check,
   Copy,
   Save,
   Trash2,
   BellRing
} from "lucide-react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  Legend 
} from "recharts";
import { Novel, ReadingProgress } from "../types";
import { api } from "../utils/api";
import { SUB_CATEGORIES } from "../data";
import { COUNTRY_DIAL_CODES, normalizePhoneNumber } from "../utils/phone";
import AuthorSocialLinksPanel from "./AuthorSocialLinksPanel";
import SafeImage from "./SafeImage";
import { uploadImageBlob } from "../utils/imageUpload";
import { canUsePushNotifications, disablePushNotifications, enablePushNotifications, getPushStatus } from "../utils/pushNotifications";

type SocialProfile = { id: string; username: string; displayName?: string; avatar: string; followed: boolean; role?: string };

function GoogleLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  );
}

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

interface UserProfileProps {
  theme: "light" | "dark";
  novels: Novel[];
  followers: SocialProfile[];
  setFollowers: React.Dispatch<React.SetStateAction<SocialProfile[]>>;
  following: SocialProfile[];
  setFollowing: React.Dispatch<React.SetStateAction<SocialProfile[]>>;
  myComments: { id: string; novelTitle: string; comment: string; createdAt: string; rating: number }[];
  readingProgress: ReadingProgress[];
  bookmarkedIds: string[];
  claimedAchievements: string[];
  onClaimAchievement: (id: string, xpReward: number) => void;
  userLevelState: { level: number; xp: number };
  onBackToDashboard: () => void;
  currentUser: any;
  onAuthSuccess: (token: string, user: any) => void;
  onLogout: () => void;
  onOpenRules?: () => void;
  defaultTab?: "overview" | "social" | "exchange" | "security";
}

export default function UserProfile({
  theme,
  novels,
  followers,
  setFollowers,
  following,
  setFollowing,
  myComments,
  readingProgress,
  bookmarkedIds,
  claimedAchievements,
  onClaimAchievement,
  userLevelState,
  onBackToDashboard,
  currentUser,
  onAuthSuccess,
  onLogout,
  defaultTab = "overview",
  onOpenRules
}: UserProfileProps) {
  const [followerFilter, setFollowerFilter] = useState("");
  const [followingFilter, setFollowingFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "social" | "exchange" | "security" | "preferences" | "achievements">(defaultTab as any);

  // Avatar upload state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarPreviewSrc, setAvatarPreviewSrc] = useState("");
  const [avatarCrop, setAvatarCrop] = useState<Crop>({ unit: "%", x: 10, y: 10, width: 80, height: 80 });
  const [avatarCompletedCrop, setAvatarCompletedCrop] = useState<PixelCrop | null>(null);
  const avatarImageRef = React.useRef<HTMLImageElement | null>(null);
  const [profileFields, setProfileFields] = useState({ email: "", phone: "", firstName: "", lastName: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [usernameDraft, setUsernameDraft] = useState(String(currentUser?.username || ""));
  const [usernameChanging, setUsernameChanging] = useState(false);
  const [usernameFeedback, setUsernameFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [userIdCopied, setUserIdCopied] = useState(false);

  const isDark = theme === "dark";

  // Security and Sessions state
  const [sessions, setSessions] = useState<any[]>([]);
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean>(!!currentUser?.twofa_enabled);
  const [twoFaSetupSecret, setTwoFaSetupSecret] = useState<string | null>(null);
  const [twoFaOtpUrl, setTwoFaOtpUrl] = useState<string | null>(null);
  const [twoFaTokenInput, setTwoFaTokenInput] = useState<string>("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [secCurrentPassword, setSecCurrentPassword] = useState("");
  const [secNewPassword, setSecNewPassword] = useState("");
  const [secRepeatPassword, setSecRepeatPassword] = useState("");
  const [secLoading, setSecLoading] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleConnected, setGoogleConnected] = useState<boolean>(!!currentUser?.google_connected);
  const [googleAccountEmail, setGoogleAccountEmail] = useState<string>(currentUser?.email || "");
  const [secFeedback, setSecFeedback] = useState<{ type: "success" | "error", message: string } | null>(null);

  // Preferences state
  const [subgenrePreferences, setSubgenrePreferences] = useState<string[]>([]);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, boolean>>({
    notify_comments: true, notify_ratings: true, notify_defaults: true, notify_likes: true, notify_replies: true, notify_logins: true
  });
  const [pushState, setPushState] = useState<"unsupported" | "loading" | "enabled" | "disabled" | "denied">("loading");
  const [pushMessage, setPushMessage] = useState("");

  // Achievements state
  const [dbAchievements, setDbAchievements] = useState<any[]>([]);
  const [achFilterStatus, setAchFilterStatus] = useState<"all" | "done" | "not_done">("all");
  const [achFilterXp, setAchFilterXp] = useState<"all" | "low" | "mid" | "high">("all");
  const [achSortBy, setAchSortBy] = useState<"hardest" | "easiest" | "most_common" | "rarest">("hardest");
  const [exchangeReceived, setExchangeReceived] = useState<any[]>([]);
  const [exchangeGiven, setExchangeGiven] = useState<any[]>([]);
  const [exchangeStats, setExchangeStats] = useState<any | null>(null);

  React.useEffect(() => {
    if (currentUser) {
      api.getAchievements().then(data => {
        setDbAchievements(data || []);
      });
    }
  }, [currentUser]);

  React.useEffect(() => {
    if (currentUser && activeTab === "security") {
      const token = api.getToken();
      if (token) {
        api.getSessions(token).then(res => {
          if (res.success) setSessions(res.sessions);
        });
      }
    }
  }, [currentUser, activeTab]);

  React.useEffect(() => {
    setTwoFaEnabled(!!currentUser?.twofa_enabled);
    setGoogleConnected(!!currentUser?.google_connected);
    setGoogleAccountEmail(currentUser?.email || "");
  }, [currentUser]);

  React.useEffect(() => {
    if (!currentUser || activeTab !== "security") return;
    let cancelled = false;
    setGoogleLoading(true);
    api.getGoogleStatus().then((result) => {
      if (cancelled || !result?.success) return;
      setGoogleConnected(!!result.connected);
      setGoogleAccountEmail(result.accountEmail || currentUser.email || "");
    }).finally(() => { if (!cancelled) setGoogleLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser?.id, activeTab]);

  React.useEffect(() => {
    if (activeTab !== "security") return;
    try {
      const raw = window.sessionStorage.getItem("reptoc-google-link-feedback");
      if (!raw) return;
      window.sessionStorage.removeItem("reptoc-google-link-feedback");
      const feedback = JSON.parse(raw);
      setSecFeedback({ type: feedback?.type === "success" ? "success" : "error", message: String(feedback?.message || "حساب گوگل متصل نشد.") });
    } catch {}
  }, [activeTab]);

  React.useEffect(() => {
    if (!currentUser) return;
    setProfileFields({
      email: currentUser.email || "",
      phone: currentUser.phone || "",
      firstName: currentUser.first_name || "",
      lastName: currentUser.last_name || ""
    });
    setUsernameDraft(currentUser.username || "");
  }, [currentUser?.id, currentUser?.username, currentUser?.email, currentUser?.phone, currentUser?.first_name, currentUser?.last_name]);

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileFeedback(null);
    const result = await api.updateProfileIdentity(profileFields);
    if (result?.success && result.user) {
      const token = api.getToken();
      if (token) onAuthSuccess(token, { ...currentUser, ...result.user });
      setProfileFeedback({ type: "success", message: "اطلاعات پروفایل ذخیره شد." });
    } else {
      setProfileFeedback({ type: "error", message: result?.error || "اطلاعات پروفایل ذخیره نشد." });
    }
    setProfileSaving(false);
  };

  const copyUserId = async () => {
    try {
      await navigator.clipboard.writeText(String(currentUser.id));
      setUserIdCopied(true);
      window.setTimeout(() => setUserIdCopied(false), 1800);
    } catch {
      setProfileFeedback({ type: "error", message: "کپی شناسه کاربری ممکن نشد." });
    }
  };

  const usernameAvailableAt = currentUser?.username_change_available_at
    ? new Date(currentUser.username_change_available_at)
    : null;
  const usernameCooldownActive = !!usernameAvailableAt
    && Number.isFinite(usernameAvailableAt.getTime())
    && usernameAvailableAt.getTime() > Date.now();

  const handleUsernameChange = async () => {
    const requested = usernameDraft.trim();
    setUsernameFeedback(null);
    if (!/^[A-Za-z0-9_]{3,30}$/.test(requested)) {
      setUsernameFeedback({ type: "error", message: "از 3 تا 30 حرف، عدد یا زیرخط (_) استفاده کنید." });
      return;
    }
    setUsernameChanging(true);
    const result = await api.changeUsername(requested);
    if (result?.success && result.user) {
      const token = api.getToken();
      if (token) onAuthSuccess(token, { ...currentUser, ...result.user });
      setUsernameDraft(result.user.username);
      setUsernameFeedback({
        type: "success",
        message: `نام کاربری تغییر کرد. پیوند قبلی پروفایل شما اکنون به همین‌جا هدایت می‌شود؛ تغییر بعدی از ${new Date(result.usernameChangeAvailableAt).toLocaleString("fa-IR")} امکان‌پذیر است.`
      });
    } else {
      setUsernameFeedback({ type: "error", message: result?.error || "تغییر نام کاربری ممکن نشد." });
    }
    setUsernameChanging(false);
  };

  React.useEffect(() => {
    if (currentUser && activeTab === "preferences") {
      setPreferencesLoading(true);
      api.getPreferences().then(prefs => {
        setSubgenrePreferences(prefs.subgenres || []);
        setPreferencesLoading(false);
      });
      const token = api.getToken();
      if (token) api.getNotificationPrefs(token).then((prefs) => prefs && setNotificationPrefs((old) => ({ ...old, ...prefs })));
      if (!token || !canUsePushNotifications()) setPushState("unsupported");
      else getPushStatus(token).then((status) => setPushState(status.permission === "denied" ? "denied" : status.subscribed ? "enabled" : "disabled")).catch(() => setPushState("disabled"));
    }
  }, [currentUser, activeTab]);

  const togglePush = async () => {
    const token = api.getToken();
    if (!token) return;
    setPushState("loading"); setPushMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      if (await registration.pushManager.getSubscription()) {
        await disablePushNotifications(token); setPushState("disabled"); setPushMessage("اعلان Push روی این دستگاه غیرفعال شد.");
      } else {
        await enablePushNotifications(token); setPushState("enabled"); setPushMessage("اعلان فصل جدید، پاسخ‌ها و نتیجهٔ چالش فعال شد.");
      }
    } catch (error: any) {
      setPushState(typeof Notification !== "undefined" && Notification.permission === "denied" ? "denied" : "disabled");
      setPushMessage(error?.message || "تغییر وضعیت Push انجام نشد.");
    }
  };

  React.useEffect(() => {
    if (!currentUser || activeTab !== "exchange") return;
    let cancelled = false;

    Promise.all([
      api.getExchangeReceived(),
      api.getExchangeGiven(),
      api.getExchangeStats()
    ]).then(([received, given, stats]) => {
      if (cancelled) return;
      setExchangeReceived(received);
      setExchangeGiven(given);
      setExchangeStats(stats);
    }).catch(() => {
      if (cancelled) return;
      setExchangeReceived([]);
      setExchangeGiven([]);
      setExchangeStats(null);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser, activeTab]);

  const handleSavePreferences = async () => {
    setPreferencesLoading(true);
    await api.savePreferences({ subgenres: subgenrePreferences });
    const token = api.getToken();
    if (token) await api.updateNotificationPrefs(token, notificationPrefs);
    setPreferencesLoading(false);
    setPreferencesSaved(true);
    setTimeout(() => setPreferencesSaved(false), 3000);
  };

  const handleAvatarFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarError(null);
    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      setAvatarError("لطفاً یک فایل تصویر معتبر انتخاب کنید.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setAvatarError("حجم تصویر نمایه نمی‌تواند بیشتر از 10 مگابایت باشد.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarPreviewSrc(String(reader.result || ""));
      setAvatarCrop({ unit: "%", x: 10, y: 10, width: 80, height: 80 });
      setAvatarCompletedCrop(null);
      setAvatarCropOpen(true);
    };
    reader.onerror = () => setAvatarError("خواندن تصویر انتخاب‌شده ناموفق بود.");
    reader.readAsDataURL(file);
  };

  const getAvatarSourceCrop = (image: HTMLImageElement): PixelCrop => {
    if (avatarCompletedCrop?.width && avatarCompletedCrop?.height) {
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      return {
        unit: "px",
        x: avatarCompletedCrop.x * scaleX,
        y: avatarCompletedCrop.y * scaleY,
        width: avatarCompletedCrop.width * scaleX,
        height: avatarCompletedCrop.height * scaleY
      };
    }

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    return {
      unit: "px",
      x: (image.naturalWidth - side) / 2,
      y: (image.naturalHeight - side) / 2,
      width: side,
      height: side
    };
  };

  const getCroppedAvatarBlob = async (): Promise<Blob | null> => {
    if (!avatarImageRef.current) return null;

    const image = avatarImageRef.current;
    const sourceCrop = getAvatarSourceCrop(image);
    const canvas = document.createElement("canvas");
    const outputSize = 512;
    canvas.width = outputSize;
    canvas.height = outputSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      sourceCrop.x,
      sourceCrop.y,
      sourceCrop.width,
      sourceCrop.height,
      0,
      0,
      outputSize,
      outputSize
    );

    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
  };

  const uploadCroppedAvatar = async () => {
    setAvatarError(null);
    setAvatarUploading(true);

    try {
      const blob = await getCroppedAvatarBlob();
      if (!blob) {
        setAvatarError("برش تصویر نمایه ناموفق بود.");
        return;
      }

      const token = api.getToken();
      const data = await uploadImageBlob(blob, {
        endpoint: "/api/upload/avatar",
        fieldName: "avatar",
        fileName: "avatar.jpg",
        csrfToken: token,
      });

      if (!data.avatar && !data.avatarUrl && !data.user) {
        setAvatarError("بارگذاری بدون نشانی قابل استفاده برای تصویر نمایه کامل شد.");
      } else {
        const token = api.getToken();
        if (token) {
          let nextUser = data?.user
            ? { ...currentUser, ...data.user, avatar: data.avatar || data.avatarUrl || data.user.avatar }
            : data?.avatarUrl
              ? { ...currentUser, avatar: data.avatarUrl }
              : null;
          const meData = await api.getMe(token);
          if (meData && meData.success && meData.user) {
            nextUser = { ...meData.user, avatar: data?.avatar || data?.avatarUrl || meData.user.avatar };
          }
          if (nextUser) onAuthSuccess(token, nextUser);
        }
        setAvatarError(null);
        setAvatarCropOpen(false);
        setAvatarPreviewSrc("");
        setAvatarCompletedCrop(null);
      }
    } catch (err: any) {
      setAvatarError(err?.message || "تصویر نمایه بارگذاری نشد. لطفاً دوباره تلاش کنید.");
      console.error("Avatar upload error:", err);
    } finally {
      setAvatarUploading(false);
    }
  };

  const closeAvatarCrop = () => {
    if (avatarUploading) return;
    setAvatarCropOpen(false);
    setAvatarPreviewSrc("");
    setAvatarCompletedCrop(null);
  };

  const handleSocialFollowToggle = async (target: any, nextState: boolean) => {
    const result = await api.saveSocialRelation(target.id || "", "following", nextState, target.username);
    if (result?.followers && result?.following) {
      setFollowers(result.followers);
      setFollowing(result.following);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecFeedback(null);
    if (secNewPassword !== secRepeatPassword) {
      setSecFeedback({ type: "error", message: "رمزهای عبور جدید یکسان نیستند." });
      return;
    }
    setSecLoading(true);
    const token = api.getToken();
    if (token) {
      const res = await api.changePassword(token, secCurrentPassword, secNewPassword);
      if (res.success) {
        setSecFeedback({ type: "success", message: "رمز عبور با موفقیت به‌روزرسانی شد." });
        const authToken = api.getToken();
        if (authToken) onAuthSuccess(authToken, { ...currentUser, password_set: true });
        setSecCurrentPassword(""); setSecNewPassword(""); setSecRepeatPassword("");
      } else {
        setSecFeedback({ type: "error", message: res.error || "به‌روزرسانی رمز عبور ناموفق بود." });
      }
    }
    setSecLoading(false);
  };

  const handleDeleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (deleteAccountBusy || deleteConfirmation !== "DELETE") return;
    const token = api.getToken();
    if (!token) {
      setDeleteAccountError("نشست شما منقضی شده است. پیش از حذف حساب، دوباره وارد شوید.");
      return;
    }
    setDeleteAccountBusy(true);
    setDeleteAccountError("");
    const result = await api.deleteAccount(token, deleteConfirmation, deletePassword);
    if (result?.success) {
      api.clearToken();
      onLogout();
      return;
    }
    setDeleteAccountError(result?.error || "حساب حذف نشد.");
    setDeleteAccountBusy(false);
  };

  const handleGoogleDisconnect = async () => {
    if (!window.confirm("اتصال گوگل از این حساب قطع شود؟ برای ورود همچنان می‌توانید از رمز عبور استفاده کنید.")) return;
    setGoogleLoading(true);
    setSecFeedback(null);
    const result = await api.disconnectGoogle();
    if (result?.success) {
      const token = api.getToken();
      if (token) onAuthSuccess(token, { ...currentUser, google_connected: false });
      setGoogleConnected(false);
      setSecFeedback({ type: "success", message: "اتصال حساب گوگل قطع شد." });
    } else {
      setSecFeedback({ type: "error", message: result?.error || "قطع اتصال گوگل ممکن نشد." });
    }
    setGoogleLoading(false);
  };

  const handleEndSession = async (id: string, isCurrent: boolean) => {
    const token = api.getToken();
    if (token) {
      const res = await api.deleteSession(token, id);
      if (res.success) {
        setSessions(prev => prev.filter(s => s.id !== id));
        if (isCurrent) onLogout();
      }
    }
  };

  const [authMode, setAuthMode] = useState<"login" | "register" | "2fa">("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [countryCodeInput, setCountryCodeInput] = useState("+1");
  const [phoneInput, setPhoneInput] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [repeatPasswordInput, setRepeatPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  // ✅ NEW: 2FA states
  const [otpSessionToken, setOtpSessionToken] = useState("");
  const [otpInput, setOtpInput] = useState("");

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    if (authMode === "register") {
      const errors = getRegistrationErrors({ nickname: nicknameInput, username: usernameInput, email: emailInput, phone: normalizePhoneNumber(countryCodeInput, phoneInput), password: passwordInput, repeatPassword: repeatPasswordInput, acceptedRules });
      if (errors.length) {
        setAuthError(errors.join(" "));
        setAuthLoading(false);
        return;
      }
    }

    try {
      if (authMode === "2fa") {
        // ✅ NEW: Verify OTP
        if (!/^\d{6}$/.test(otpInput)) {
          setAuthError("رمز یکبار مصرف باید 6 رقم باشد");
          setAuthLoading(false);
          return;
        }

        const result = await api.verify2FA(otpSessionToken, otpInput);
        if (result && result.success) {
          onAuthSuccess(result.token || result.csrfToken || api.getToken() || "", result.user);
          setAuthMode("login");
          setOtpInput("");
          setOtpSessionToken("");
        } else {
          setAuthError(result.error || "رمز یکبار مصرف نامعتبر است. لطفاً دوباره تلاش کنید.");
        }
      } else if (authMode === "login") {
        const result = await api.login(usernameInput, passwordInput, rememberMe);
        if (result && result.requiresOTP) {
          // ✅ NEW: Transition to 2FA mode
          setAuthMode("2fa");
          setOtpSessionToken(result.otpSessionToken);
          setAuthError("");
        } else if (result && result.success) {
          onAuthSuccess(result.token || result.csrfToken || api.getToken() || "", result.user);
        } else {
          setAuthError(result.error || "ورود ناموفق بود. اطلاعات ورود نامعتبر است.");
        }
      } else {
        const result = await api.register(usernameInput, passwordInput, nicknameInput, emailInput, normalizePhoneNumber(countryCodeInput, phoneInput));
        if (result && result.success) {
          onAuthSuccess(result.token || result.csrfToken || api.getToken() || "", result.user);
        } else {
          setAuthError(result.error || "ثبت‌نام ناموفق بود. ممکن است نام کاربری قبلاً گرفته شده باشد.");
        }
      }
    } catch (err) {
      setAuthError("خطا در ارتباط با سرور.");
    } finally {
      setAuthLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="max-w-md mx-auto my-8 sm:my-12 px-3 sm:px-0"
      >
        <div className={`p-5 sm:p-8 rounded-3xl border ${isDark ? "bg-[#05060f] border-violet-900/15 text-white shadow-[0_15px_45px_rgba(139,92,246,0.03)]" : "bg-white border-stone-200 text-stone-900"} shadow-2xl relative overflow-hidden`}>
          <span className="absolute -right-12 -top-12 w-28 h-28 rounded-full bg-violet-500/10 blur-2xl" />
          <span className="absolute -left-12 -bottom-12 w-28 h-28 rounded-full bg-purple-500/10 blur-2xl" />

          {/* Heading */}
          <div className="text-center space-y-2 relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-lg mb-4">
              <LogIn className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black tracking-tight">درگاه ورود رپتوک</h2>
          </div>

          {/* Toggle Tab */}
          <div className="flex border-b border-slate-750/10 dark:border-slate-800/40 my-6">
            <button
              onClick={() => { setAuthMode("login"); setAuthError(""); }}
              className={`flex-1 py-2 text-center text-xs font-black transition-all border-b-2 cursor-pointer ${authMode === "login" ? "border-violet-500 text-violet-500 dark:text-violet-400" : "border-transparent text-slate-400"}`}
            >
              ورود
            </button>
            <button
              onClick={() => { setAuthMode("register"); setAuthError(""); }}
              className={`flex-1 py-2 text-center text-xs font-black transition-all border-b-2 cursor-pointer ${authMode === "register" ? "border-violet-500 text-violet-500 dark:text-violet-400" : "border-transparent text-slate-400"}`}
            >
              ثبت‌نام
            </button>
          </div>

          {/* Error capsule */}
          {authError && (
            <div className="p-3 mb-4 rounded-xl text-center bg-rose-500/10 border border-rose-500/25 text-rose-500 text-xs font-black">
              {authError}
            </div>
          )}

          {/* Form */}
          <form noValidate onSubmit={handleAuthSubmit} className="space-y-4 relative z-10">
            {authMode === "2fa" ? (
              // ✅ NEW: 2FA Form
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/25">
                  <p className="text-xs text-violet-300 text-center">
                    کد 6 رقمی را از اپلیکیشن احراز هویت خود وارد کنید
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">کد 6 رقمی</label>
                  <div className="relative">
                    <span className="absolute right-3 top-3 text-slate-400">
                      <Shield className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      placeholder="000000"
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                      className={`w-full py-2.5 pr-10 pl-4 text-xs font-extrabold tracking-widest rounded-xl border focus:outline-none transition-all text-center ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                    />
                  </div>
                </div>
              </div>
            ) : authMode === "register" ? (
              <>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">نام مستعار</label>
                    <div className="relative">
                      <span className="absolute right-3 top-3 text-slate-400">
                        <Sparkles className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        required
                        placeholder="نام مستعار"
                        value={nicknameInput}
                        onChange={(e) => setNicknameInput(e.target.value)}
                        className={`w-full py-2.5 pr-10 pl-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                      />
                    </div>
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">نام کاربری</label>
                    <div className="relative">
                      <span className="absolute right-3 top-3 text-slate-400">
                        <User className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        required
                        placeholder="نام کاربری"
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        className={`w-full py-2.5 pr-10 pl-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">ایمیل</label>
                  <div className="relative">
                    <span className="absolute right-3 top-3 text-slate-400">
                      <User className="w-4 h-4" />
                    </span>
                    <input
                      type="email"
                      required
                      placeholder="نشانی ایمیل"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className={`w-full py-2.5 pr-10 pl-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">شماره تلفن</label>
                  <div className="relative">
                    <span className="absolute right-3 top-3 text-slate-400">
                      <User className="w-4 h-4" />
                    </span>
                    <div className="grid grid-cols-[minmax(7.5rem,0.45fr)_minmax(0,1fr)] gap-2">
                      <select
                        value={countryCodeInput}
                        onChange={(e) => setCountryCodeInput(e.target.value)}
                        className={`w-full py-2.5 px-3 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                      >
                        {COUNTRY_DIAL_CODES.map((country) => (
                          <option key={`${country.iso}-${country.code}`} value={country.code}>
                            {country.iso} {country.code}
                          </option>
                        ))}
                      </select>
                      <input
                        type="tel"
                        placeholder="شماره تلفن"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        className={`w-full py-2.5 px-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">رمز عبور</label>
                    <div className="relative">
                      <span className="absolute right-3 top-3 text-slate-400">
                        <Lock className="w-4 h-4" />
                      </span>
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="رمز عبور را وارد کنید"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        className={`w-full py-2.5 pl-10 pr-10 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-3 text-slate-400 hover:text-violet-500">
                        <Search className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Enhanced Password Strength Indicator */}
                    <div className="mt-2 w-full">
                      {passwordInput.length > 0 && (() => {
                        let score = 0;
                        if (passwordInput.length >= 8) score += 1;
                        if (/[A-Z]/.test(passwordInput)) score += 1;
                        if (/[a-z]/.test(passwordInput)) score += 1;
                        if (/[0-9]/.test(passwordInput)) score += 1;
                        if (/[^A-Za-z0-9]/.test(passwordInput)) score += 1;
                        
                        let label = "خیلی ضعیف";
                        let colorClass = "bg-rose-500";
                        if (score === 2) { label = "ضعیف"; colorClass = "bg-orange-500"; }
                        if (score === 3) { label = "متوسط"; colorClass = "bg-amber-400"; }
                        if (score === 4) { label = "قوی"; colorClass = "bg-violet-500"; }
                        if (score === 5) { label = "خیلی قوی"; colorClass = "bg-emerald-500"; }
                        
                        return (
                          <div className="space-y-1.5 animate-in fade-in zoom-in duration-300 relative">
                            <div className="flex gap-1 h-1.5 w-full">
                              {[1,2,3,4,5].map(step => (
                                <div key={step} className={`h-full flex-1 rounded-full transition-all duration-300 ${score >= step ? colorClass : (isDark ? "bg-slate-800" : "bg-slate-200")}`} />
                              ))}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`text-[10px] font-bold ${colorClass.replace('bg-', 'text-')}`}>{label}</span>
                              <span className="text-[9px] text-slate-500">{score}/5 معیار برآورده شده</span>
                            </div>
                            {score < 5 && (
                              <div className="text-[9px] text-slate-400 flex flex-wrap gap-x-2 gap-y-1 mt-1">
                                {passwordInput.length < 8 && <span className="flex items-center gap-1 text-rose-400"><span className="w-1 h-1 rounded-full bg-current"></span>8+ نویسه</span>}
                                {!/[A-Z]/.test(passwordInput) && <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-current"></span>حرف بزرگ</span>}
                                {!/[a-z]/.test(passwordInput) && <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-current"></span>حرف کوچک</span>}
                                {!/[0-9]/.test(passwordInput) && <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-current"></span>عدد</span>}
                                {!/[^A-Za-z0-9]/.test(passwordInput) && <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-current"></span>نویسه خاص</span>}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">تکرار رمز عبور</label>
                    <div className="relative">
                      <span className="absolute right-3 top-3 text-slate-400">
                        <Lock className="w-4 h-4" />
                      </span>
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="تکرار رمز عبور"
                        value={repeatPasswordInput}
                        onChange={(e) => setRepeatPasswordInput(e.target.value)}
                        className={`w-full py-2.5 pl-10 pr-10 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">ایمیل / نام کاربری / شماره تلفن</label>
                  <div className="relative">
                    <span className="absolute right-3 top-3 text-slate-400">
                      <User className="w-4 h-4" />
                    </span>
                    <input
                      type="text"
                      required
                      placeholder="ایمیل / نام کاربری / شماره تلفن"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      className={`w-full py-2.5 pr-10 pl-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase font-black text-slate-400 block text-left">رمز عبور</label>
                  <div className="relative">
                    <span className="absolute right-3 top-3 text-slate-400">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="رمز عبور را وارد کنید"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className={`w-full py-2.5 pl-10 pr-10 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-violet-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-violet-500"}`}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-3 text-slate-400 hover:text-violet-500">
                      <Search className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-black/25 border-slate-700 text-violet-500 focus:ring-violet-500 focus:ring-offset-slate-900"
                  />
                  <label htmlFor="rememberMe" className="text-[10px] uppercase font-black font-mono text-slate-400">مرا به خاطر بسپار</label>
                </div>
              </>
            )}

            {authMode === "register" && (
              <label className="flex items-start gap-3 text-left text-xs text-slate-400">
                <input type="checkbox" required checked={acceptedRules} onChange={(e) => setAcceptedRules(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
                <span>قوانین و شرایط استفاده را <button type="button" onClick={onOpenRules} className="font-bold text-violet-500 hover:underline">می‌پذیرم</button>.</span>
              </label>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-black uppercase tracking-wider hover:from-violet-500 hover:to-purple-500 active:scale-98 transition-all cursor-pointer shadow-lg disabled:opacity-50"
            >
              {authLoading ? "در حال پردازش..." : authMode === "login" ? "ورود" : "ثبت‌نام"}
            </button>
          </form>

          {authMode !== "2fa" && (
            <div className="mt-4 relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <span className={`h-px flex-1 ${isDark ? "bg-slate-700/40" : "bg-stone-200"}`} />
                <span className="text-[10px] uppercase font-bold text-slate-500">یا</span>
                <span className={`h-px flex-1 ${isDark ? "bg-slate-700/40" : "bg-stone-200"}`} />
              </div>
              <button
                type="button"
                onClick={() => api.startGoogleAuth("login")}
                className="w-full py-2.5 rounded-xl border border-stone-200 bg-white text-slate-900 text-xs font-extrabold transition-colors inline-flex items-center justify-center gap-2 hover:bg-stone-50"
              >
                <GoogleLogo /> ادامه با گوگل
              </button>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500 text-center">
                برای ورود یا ساخت حساب جدید با گوگل ادامه دهید.
              </p>
            </div>
          )}

          {/* Quick guest bypass back */}
          <div className="text-center mt-6">
            <button
              onClick={onBackToDashboard}
              className="text-[10.5px] font-mono font-black uppercase text-violet-500 dark:text-violet-400 hover:underline cursor-pointer"
            >
              → بازگشت به کتابخانه حالت مهمان
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // Calculate stats based on real database-backed metrics
  const userId = String(currentUser.id || "");
  const userCreatedNovels = novels.filter(n => String(n.author_id || "") === userId);
  const totalNovelsAuthored = userCreatedNovels.length;
  
  // Calculate total words authored dynamically from drafts or database record
  const dynamicWordsAuthored = userCreatedNovels.reduce((sum, n) => {
    const chapterWords = n.chapters?.reduce((cSum, c) => cSum + (c.wordCount || 0), 0) || 0;
    return sum + chapterWords;
  }, 0);

  const totalWordsAuthored = Math.max(dynamicWordsAuthored, currentUser.words_authored || 0);

  // Active statistics loaded directly from user profile
  const realReadingHours = currentUser.hours_read || 0.0;
  const totalChaptersReadCount = currentUser.chapters_logged || 0;
  const userRanking = currentUser.user_ranking || "بدون رتبه";
  const rankingLabel = currentUser.ranking_basis === "author" ? "رتبه نویسنده" : "رتبه خواننده";
  const currentStreakDays = Math.max(0, Number(currentUser.streak || 0));
  
  // Real dynamic calculation of the user's actual reading / authoring subgenre focus
  const subgenreCountMap: Record<string, number> = {};
  SUB_CATEGORIES.forEach(cat => {
    subgenreCountMap[cat] = 0;
  });

  let totalMapped = 0;
  novels.forEach(n => {
    if (bookmarkedIds.includes(n.id) || String(n.author_id || "") === userId) {
      // Look at subCategories
      const subs = n.subCategories || [];
      subs.forEach((s: string) => {
        const match = SUB_CATEGORIES.find(c => c.toLowerCase() === s.toLowerCase());
        if (match) {
          subgenreCountMap[match]++;
          totalMapped++;
        }
      });
    }
  });

  const savedPreferenceSubgenres = (subgenrePreferences || [])
    .map((item: string) => SUB_CATEGORIES.find((cat) => cat.toLowerCase() === String(item).toLowerCase()))
    .filter((item): item is string => Boolean(item));

  const activeSubgenres = savedPreferenceSubgenres.length > 0
    ? savedPreferenceSubgenres.slice(0, 10)
    : Object.keys(subgenreCountMap)
        .filter(k => subgenreCountMap[k] > 0)
        .sort((a, b) => subgenreCountMap[b] - subgenreCountMap[a])
        .slice(0, 10); // Show top 10

  const chartGenreData = savedPreferenceSubgenres.length > 0
    ? savedPreferenceSubgenres.slice(0, 6).map((sub, index) => ({
        name: sub,
        value: 35 - index * 4
      }))
    : totalMapped > 0
      ? activeSubgenres.map(key => ({
          name: key,
          value: subgenreCountMap[key] * 25
        }))
      : [];

  const COLORS = ["#8b5cf6", "#a855f7", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b"];

  // Weekly Reading Intensity (Minutes) dynamically calculated
  const daysOfWeek = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"];
  const readingIntensityData = daysOfWeek.map(day => ({ day, reading: 0, writing: 0 }));

  readingProgress.forEach(progress => {
    if (progress.updatedAt) {
      const date = new Date(progress.updatedAt);
      const dayIndex = (date.getDay() + 6) % 7;
      const trackedSeconds = Number((progress as any).readSeconds || 0);
      readingIntensityData[dayIndex].reading += Math.max(1, Math.round(trackedSeconds / 60) || 1);
    }
  });

  userCreatedNovels.forEach(novel => {
    (novel.chapters || []).forEach(chapter => {
      if (chapter.createdAt) {
        const date = new Date(chapter.createdAt);
        const dayIndex = (date.getDay() + 6) % 7;
        readingIntensityData[dayIndex].writing += Math.max((chapter.wordCount || 1000) / 20, 20); // Average 20 words per minute writing
      }
    });
  });

  // Achievements milestones
  const iconMap: Record<string, any> = {
    BookOpen, BookMarked, Book, Flame, Moon, Library,
    MessageSquare, Star, PenTool, TrendingUp, Eye, Activity,
    Calendar, Award, Heart, Crown, Compass, Trophy, ThumbsUp,
    CheckCircle
  };

  const achievements = dbAchievements.map(ach => ({
    id: ach.id,
    title: ach.title,
    desc: ach.description,
    unlocked: false, // Automated claiming, so it skips straight to isClaimed when backend unlocks it
    icon: iconMap[ach.icon] || Trophy,
    tier: ach.category === "Community" ? "Gold" : (ach.category === "Authors" ? "Silver" : "Bronze"),
    xpReward: ach.reward_xp,
    claimedCount: ach.claimedCount || 0,
    claimedByUser: ach.claimedByUser || false
  }));

  const filteredAchievements = achievements
    .filter((ach) => {
      const isClaimed = ach.claimedByUser || claimedAchievements.includes(ach.id);
      if (achFilterStatus === "done" && !isClaimed) return false;
      if (achFilterStatus === "not_done" && isClaimed) return false;

      if (achFilterXp === "low" && ach.xpReward >= 200) return false;
      if (achFilterXp === "mid" && (ach.xpReward < 200 || ach.xpReward > 500)) return false;
      if (achFilterXp === "high" && ach.xpReward <= 500) return false;

      return true;
    })
    .sort((a, b) => {
      if (achSortBy === "hardest") return b.xpReward - a.xpReward;
      if (achSortBy === "easiest") return a.xpReward - b.xpReward;
      if (achSortBy === "most_common") return b.claimedCount - a.claimedCount;
      if (achSortBy === "rarest") return a.claimedCount - b.claimedCount;
      return 0;
    });

  // Activity grid dynamically mapped to recent 48 days
  const activityHexes = Array.from({ length: 48 }).map((_, i) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - (47 - i));
    const targetDayStr = targetDate.toISOString().split("T")[0];

    let activityScore = 0;
    readingProgress.forEach(progress => {
      if (progress.updatedAt && progress.updatedAt.startsWith(targetDayStr)) activityScore += 1;
    });

    userCreatedNovels.forEach(novel => {
      (novel.chapters || []).forEach(cap => {
        if (cap.createdAt && cap.createdAt.startsWith(targetDayStr)) activityScore += 2;
      });
    });

    if (activityScore >= 4) return 4;
    if (activityScore >= 2) return 2;
    if (activityScore >= 1) return 1;
    return 0;
  });

  const getHexOpacity = (level: number) => {
    switch (level) {
      case 4: return "bg-violet-600 dark:bg-violet-500 scale-102 shadow-[0_0_8px_rgba(139,92,246,0.5)]";
      case 2: return "bg-violet-600/60 dark:bg-violet-500/50";
      case 1: return "bg-violet-600/30 dark:bg-violet-500/20";
      default: return "bg-stone-200 dark:bg-slate-800/40 border border-slate-700/5";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -30, filter: "blur(8px)" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      {avatarCropOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
          <div className={`w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border p-4 sm:p-5 shadow-2xl ${
            isDark ? "bg-[#05060f] border-violet-900/30 text-white" : "bg-white border-stone-200 text-stone-900"
          }`}>
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800/10 dark:border-violet-950/25">
              <div className="text-left">
                <h3 className="text-sm font-black tracking-tight">برش تصویر نمایه پروفایل</h3>
                <p className="text-[10px] text-slate-500 mt-1">برش مربعی، بارگذاری بهینه و به‌روزرسانی فوری پروفایل.</p>
              </div>
              <button
                type="button"
                onClick={closeAvatarCrop}
                disabled={avatarUploading}
                className={`p-2 rounded-lg border transition ${isDark ? "border-slate-800 text-slate-400 hover:text-white" : "border-stone-200 text-stone-500 hover:text-stone-900"} disabled:opacity-50`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 rounded-xl overflow-hidden border border-slate-800/20 bg-black/20 flex justify-center">
              {avatarPreviewSrc && (
                <ReactCrop
                  crop={avatarCrop}
                  onChange={(nextCrop) => setAvatarCrop(nextCrop)}
                  onComplete={(nextCrop) => setAvatarCompletedCrop(nextCrop)}
                  aspect={1}
                  circularCrop
                  keepSelection
                  minWidth={80}
                  minHeight={80}
                >
                  <img
                    ref={avatarImageRef}
                    src={avatarPreviewSrc}
                    alt="پیش‌نمایش برش تصویر نمایه"
                    className="max-h-[56vh] w-auto object-contain"
                    onLoad={(event) => {
                      avatarImageRef.current = event.currentTarget;
                      setAvatarCrop({ unit: "%", x: 10, y: 10, width: 80, height: 80 });
                    }}
                  />
                </ReactCrop>
              )}
            </div>

            {avatarError && (
              <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                {avatarError}
              </div>
            )}

            <div className="mt-4 flex flex-col sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={closeAvatarCrop}
                disabled={avatarUploading}
                className={`px-4 py-2 rounded-lg border text-xs font-bold ${isDark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-stone-200 text-stone-700 hover:bg-stone-100"} disabled:opacity-50`}
              >
                لغو
              </button>
              <button
                type="button"
                onClick={uploadCroppedAvatar}
                disabled={avatarUploading || !avatarPreviewSrc}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-black disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {avatarUploading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>{avatarUploading ? "در حال بارگذاری..." : "ذخیره تصویر نمایه"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return button and Top section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button
          onClick={onBackToDashboard}
          className={`flex items-center gap-2 text-xs font-bold uppercase font-mono px-4 py-2 border rounded-xl transition-all ${
            isDark 
              ? "border-violet-900/30 bg-[#0e0a1c]/35 text-violet-400 hover:text-violet-300 hover:bg-violet-500/5" 
              : "border-stone-200 bg-stone-50 text-stone-600 hover:text-stone-900 hover:bg-stone-100"
          } cursor-pointer self-start`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>بازگشت به کتابخانه</span>
        </button>

        {/* Custom Tab Toggles built into responsive tier capsule */}
        <div className={`p-1 rounded-xl border ${isDark ? "bg-[#0e0a1c]/60 border-violet-950/25" : "bg-stone-100 border-stone-200"} flex flex-wrap xs:flex-nowrap items-center justify-center gap-1 select-none w-full sm:w-auto overflow-x-auto shrink-0 max-w-full`}>
          {[
            { id: "overview", label: "عمومی", icon: BarChart3 },
            { id: "achievements", label: "دستاوردها", icon: Trophy },
            { id: "social", label: "ارتباط‌ها", icon: Users },
            { id: "exchange", label: "دفتر تبادل", icon: MessageSquare },
            { id: "security", label: "امنیت و نشست‌ها", icon: Shield },
            { id: "preferences", label: "ترجیحات", icon: Settings }
          ].map(tab => {
            const TabIcon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all duration-200 cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? "bg-violet-600 text-white shadow-md shadow-violet-600/10"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "overview" && currentUser?.username && (
        <AuthorSocialLinksPanel username={currentUser.username} theme={theme} />
      )}

      {/* Main Container Layout */}
      <div className={`grid grid-cols-1 ${activeTab === "overview" ? "lg:grid-cols-12" : "lg:grid-cols-1"} gap-6 items-start`}>
        
        {/* LEFT COLUMN: User Card, XP path, Daily Streaks, and Achievements (4 cols) */}
        {activeTab === "overview" && (
        <div className="order-2 lg:order-1 lg:col-span-4 space-y-6 w-full">
          
          {/* Identity & Progress Ring card */}
          <div className={`p-6 rounded-3xl border relative overflow-hidden ${
            isDark 
              ? "bg-[#05060f] border-violet-900/15 text-white shadow-[0_15px_45px_rgba(139,92,246,0.03)]" 
              : "bg-white border-stone-200 text-stone-900 shadow-lg shadow-stone-100"
          }`}>
            <span className="absolute -right-16 -top-16 w-32 h-32 rounded-full bg-violet-500/10 blur-3xl" />
            <span className="absolute -left-16 -bottom-16 w-32 h-32 rounded-full bg-purple-500/10 blur-3xl" />

            <div className="flex flex-col items-center text-center space-y-4">
              {/* Profile Avatar Badge with Upload */}
              <div className="relative group">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-500 via-purple-600 to-purple-600 font-mono font-black text-white text-3xl flex items-center justify-center shadow-xl border border-white/10 relative z-10 transition-transform hover:scale-105 duration-300">
                  {getSafeAvatarUrl(currentUser.avatar) ? (
                    <SafeImage
                      src={getSafeAvatarUrl(currentUser.avatar) || ""} 
                      alt={currentUser.username}
                      className="w-full h-full rounded-3xl object-cover"
                    />
                  ) : (
                    currentUser.username.substring(0, 2).toUpperCase()
                  )}
                </div>
                {/* Rotating ring highlight */}
                <div className="absolute -inset-1.5 rounded-[22px] border border-violet-500/30 border-dashed animate-[spin_12s_linear_infinite]" />
                <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-emerald-500 border-4 border-white dark:border-[#05060f] flex items-center justify-center z-20" title="سامانه آنلاین" />
                
                {/* Upload Button - appears on hover */}
                <button
                  onClick={() => document.getElementById("avatar-upload-input")?.click()}
                  disabled={avatarUploading}
                  className="absolute inset-0 rounded-3xl bg-black/0 hover:bg-black/50 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 z-30 cursor-pointer disabled:cursor-not-allowed"
                  title="برای بارگذاری تصویر نمایه کلیک کنید"
                >
                  {avatarUploading ? (
                    <div className="animate-spin">
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full" />
                    </div>
                  ) : (
                    <User className="w-6 h-6 text-white" />
                  )}
                </button>
              </div>

              {/* Hidden file input */}
              <input
                id="avatar-upload-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarFileSelected}
                disabled={avatarUploading}
                className="hidden"
              />

              {/* Avatar upload error */}
              {avatarError && (
                <div className="text-xs text-rose-500 font-medium">
                  {avatarError}
                </div>
              )}

              {/* Name and Level badge */}
              <div className="space-y-1">
                <h2 className="text-2xl font-black tracking-tight leading-none flex justify-center items-center gap-2">
                  {currentUser.username}
                  {currentUser.verified_author && (
                    <span title="نویسنده تأییدشده (رسمی)">
                      <CheckCircle className="w-5 h-5 text-violet-500" fill="currentColor" opacity={0.9} />
                    </span>
                  )}
                  {currentUser.verified_role && (
                    <span title="نقش تأییدشده">
                      <CheckCircle className="w-5 h-5 text-emerald-500" fill="currentColor" opacity={0.9} />
                    </span>
                  )}
                </h2>
                <p className="text-[10px] font-bold font-mono tracking-widest text-slate-500 uppercase mt-1">{({ owner: "مالک", admin: "مدیر", moderator: "ناظم", writer: "نویسنده", reader: "خواننده" } as Record<string, string>)[String(currentUser.role || "writer")] || String(currentUser.role || "writer")} · راوی رپتوک</p>
                
                <div className="flex items-center gap-1 justify-center pt-2">
                  <span className="text-[10px] font-extrabold uppercase font-mono px-2 py-0.5 rounded bg-violet-500/10 text-violet-500 dark:text-violet-400 border border-violet-500/20 leading-none">سطح {userLevelState.level}</span>
                  {(currentUser.has_reader_premium || currentUser.has_writer_premium || currentUser.is_premium) && (
                    <span className="text-[10px] font-black uppercase font-mono px-2 py-0.5 rounded bg-yellow-400 text-yellow-950 border border-yellow-300 shadow-sm leading-none">پریمیوم</span>
                  )}
                  {(currentUser.has_reader_premium || currentUser.is_premium) && (
                    <span className="text-[10px] font-extrabold uppercase font-mono px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-600 dark:text-yellow-300 border border-yellow-400/50 leading-none">خواننده پریمیوم</span>
                  )}
                  {currentUser.has_writer_premium && (
                    <span className="text-[10px] font-extrabold uppercase font-mono px-2 py-0.5 rounded bg-yellow-400/20 text-yellow-600 dark:text-yellow-300 border border-yellow-400/50 leading-none">نویسنده پریمیوم</span>
                  )}
                </div>
              </div>

              <form onSubmit={handleProfileSave} className="w-full pt-3 border-t border-slate-700/10 dark:border-violet-950/20 space-y-3 text-left">
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">نام</span>
                    <input
                      value={profileFields.firstName}
                      onChange={(e) => setProfileFields((fields) => ({ ...fields, firstName: e.target.value }))}
                      maxLength={80}
                      autoComplete="given-name"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-violet-500"
                      placeholder="نام"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">نام خانوادگی</span>
                    <input
                      value={profileFields.lastName}
                      onChange={(e) => setProfileFields((fields) => ({ ...fields, lastName: e.target.value }))}
                      maxLength={80}
                      autoComplete="family-name"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-violet-500"
                      placeholder="نام خانوادگی"
                    />
                  </label>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">نام کاربری · هر 14 روز یکبار</span>
                  <div className="flex gap-2">
                    <input
                      value={usernameDraft}
                      onChange={(event) => setUsernameDraft(event.target.value)}
                      minLength={3}
                      maxLength={30}
                      pattern="[A-Za-z0-9_]{3,30}"
                      autoComplete="username"
                      disabled={usernameChanging || usernameCooldownActive}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-violet-500 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={handleUsernameChange}
                      disabled={usernameChanging || usernameCooldownActive || usernameDraft.trim().toLowerCase() === String(currentUser.username || "").toLowerCase()}
                      className="rounded-lg bg-violet-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"
                    >
                      {usernameChanging ? "در حال تغییر..." : "تغییر"}
                    </button>
                  </div>
                  {usernameCooldownActive && (
                    <p className="text-[10px] text-slate-500">
                      تغییر بعدی از {usernameAvailableAt!.toLocaleString("fa-IR")} امکان‌پذیر است.
                    </p>
                  )}
                  {usernameFeedback && (
                    <p className={`text-[10px] font-bold ${usernameFeedback.type === "success" ? "text-emerald-500" : "text-rose-500"}`}>
                      {usernameFeedback.message}
                    </p>
                  )}
                </div>
                <label className="block space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">ایمیل</span>
                  <input
                    type="email"
                    value={profileFields.email}
                    onChange={(e) => setProfileFields((fields) => ({ ...fields, email: e.target.value }))}
                    autoComplete="email"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-violet-500"
                    placeholder="نشانی ایمیل"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">تلفن</span>
                  <input
                    type="tel"
                    value={profileFields.phone}
                    onChange={(e) => setProfileFields((fields) => ({ ...fields, phone: e.target.value }))}
                    autoComplete="tel"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-violet-500"
                    placeholder="شماره تلفن"
                  />
                </label>
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">شناسه یکتای کاربری</span>
                  <button type="button" onClick={copyUserId} className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-2.5 py-2 text-left hover:border-violet-500 transition-colors" title="کپی شناسه یکتای کاربری">
                    <span className="font-mono text-[10px] truncate select-all">{currentUser.id}</span>
                    {userIdCopied ? <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 shrink-0 text-violet-500" />}
                  </button>
                </div>
                {profileFeedback && <p className={`text-[10px] font-bold ${profileFeedback.type === "success" ? "text-emerald-500" : "text-rose-500"}`}>{profileFeedback.message}</p>}
                <button type="submit" disabled={profileSaving} className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white transition-colors font-black text-xs uppercase flex items-center justify-center gap-1.5">
                  <Save className="w-3.5 h-3.5" />
                  {profileSaving ? "در حال ذخیره..." : "ذخیره پروفایل"}
                </button>
              </form>

              {/* Level XP Tracker */}
              <div className="w-full space-y-1.5 pt-3 border-t border-slate-700/10 dark:border-violet-950/20">
                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 font-bold">
                  <span>پیشرفت سطح</span>
                  <span>{userLevelState.xp}% امتیاز تجربه</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div className="bg-gradient-to-r from-violet-500 to-purple-600 h-full rounded-full transition-all duration-500" style={{ width: `${userLevelState.xp}%` }} />
                </div>
                <span className="block text-[9px] text-left text-slate-500 font-medium font-sans">برای ارتقای سطح و باز شدن نشان‌های جدید پروفایل به 100% امتیاز تجربه برسید.</span>

                {/* Log Out Button linked to real SQL session drop */}
                <button
                  onClick={onLogout}
                  className="w-full mt-4 py-2 rounded-xl border border-rose-550/20 bg-rose-500/5 text-rose-500 hover:bg-rose-500 hover:text-white transition-all cursor-pointer font-black text-xs uppercase flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>خروج</span>
                </button>
              </div>
            </div>
          </div>

          {/* Reading Streak consistency widget */}
          <div className={`p-5 rounded-3xl border ${
            isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
          } space-y-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-500 animate-bounce" />
                <span className="font-mono text-xs font-black uppercase text-slate-400">پایش زنجیره مطالعه</span>
              </div>
              <span className="text-[10px] font-mono font-bold bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">فعال</span>
            </div>

            <div className="flex items-center gap-4 py-2">
              <span className="text-3xl font-extrabold font-mono text-amber-500">{currentStreakDays} روز</span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-normal">
                اخیراً فصل‌هایی خوانده‌اید یا نگاشته‌اید! این زنجیره را حفظ کنید تا نشان‌های تقویتی ویژه باز شوند.
              </p>
            </div>

            {/* Streak Grid Days indicator */}
            <div className="grid grid-cols-7 gap-1.5 leading-none pt-1">
              {["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"].map((day, idx) => (
                <div key={day} className="text-center space-y-1">
                  <div className={`aspect-square sm:aspect-auto sm:h-6 rounded-lg flex items-center justify-center font-mono font-black text-[9px] border ${
                    idx < Math.min(7, currentStreakDays)
                      ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                      : "bg-slate-500/5 text-slate-500 border-slate-500/15"
                  }`}>
                    {idx < Math.min(7, currentStreakDays) ? "*" : "-"}
                  </div>
                  <span className="text-[9px] font-mono font-bold text-slate-500">{day}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
        )}

        {/* RIGHT COLUMN: Switching Tab Area */}
        <div className={`order-1 lg:order-2 ${activeTab === "overview" ? "lg:col-span-8" : "lg:col-span-12"} space-y-6 w-full`}>
          
          {/* TAB 1: OVERVIEW & COMPREHENSIVE CHARTS */}
          {activeTab === "overview" && (
            <motion.div
              key="overview-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="space-y-6"
            >
              {/* Analytics Numeric Cards Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "ساعت مطالعه", val: parseFloat(realReadingHours.toFixed(1)), suffix: " ساعت", icon: Clock, color: "text-violet-500" },
                  { label: "فصل‌های خوانده‌شده", val: totalChaptersReadCount, suffix: "", icon: BookOpen, color: "text-purple-500" },
                  { label: "واژه‌های نگاشته‌شده", val: totalWordsAuthored, suffix: "", icon: Milestone, color: "text-purple-500" },
                  { label: rankingLabel, val: userRanking, suffix: "", icon: TrendingUp, color: "text-emerald-500" }
                ].map((stat, i) => {
                  const StatIcon = stat.icon;
                  return (
                    <div 
                      key={i} 
                      className={`p-4 rounded-3xl border ${
                        isDark ? "bg-[#05060f] border-violet-900/15 text-slate-100" : "bg-white border-stone-200 text-stone-950"
                      } space-y-2`}
                    >
                      <div className="flex justify-between items-center">
                        <span className={`text-[9px] font-mono font-black uppercase tracking-wider leading-none ${isDark ? "text-slate-400" : "text-slate-500"}`}>{stat.label}</span>
                        <StatIcon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                      <div className="flex items-baseline gap-0.5">
                        <span className={`text-lg md:text-xl font-black font-sans tracking-tight ${isDark ? "text-white" : "text-stone-950"}`}>{stat.val}</span>
                        {stat.suffix && <span className={`text-[10px] font-bold ${isDark ? "text-slate-400" : "text-slate-500"}`}>{stat.suffix}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Weekly Density & Chapter Progress Charts Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Chart 1: Activity Intensity Chart */}
                <div className={`p-5 rounded-3xl border ${
                  isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
                } space-y-4`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-mono font-black uppercase text-slate-400">پیشرفت هفتگی (دقیقه)</h4>
                      <p className="text-[10px] text-slate-500">مقایسه عادت مطالعه و نگارش شما</p>
                    </div>
                    <span className="text-[9px] font-mono text-violet-500 bg-violet-500/5 px-2 py-0.5 rounded leading-none border border-violet-500/10">ردیابی فعال</span>
                  </div>

                  <div className="h-56 w-full text-xs">
                    <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                      <AreaChart data={readingIntensityData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorRead" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorWrite" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="day" stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} />
                        <YAxis stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} />
                        <Tooltip 
                          contentStyle={{ 
                            background: isDark ? "#0b0716" : "#ffffff", 
                            borderColor: isDark ? "#1e293b" : "#e2e8f0",
                            color: isDark ? "#f1f5f9" : "#1e293b",
                            fontSize: 10,
                            borderRadius: 12
                          }} 
                        />
                        <Area type="monotone" dataKey="reading" stroke="#8b5cf6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRead)" name="دقیقه مطالعه" />
                        <Area type="monotone" dataKey="writing" stroke="#8b5cf6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorWrite)" name="دقیقه نگارش" />
                        <Legend wrapperStyle={{ fontSize: 9, paddingTop: 10 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Chart 2: Subgenre Reading Profile Affinity */}
                <div className={`p-5 rounded-3xl border ${
                  isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
                } space-y-4`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-mono font-black uppercase text-slate-400">ترجیحات زیرژانر</h4>
                      <p className="text-[10px] text-slate-500">تمرکز زیرژانری پروفایل خوانندگی شما</p>
                    </div>
                  </div>

                  <div className="h-56 w-full flex items-center justify-center relative">
                    <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                      <PieChart>
                        <Pie
                          data={chartGenreData}
                          cx="50%"
                          cy="45%"
                          innerRadius={52}
                          outerRadius={75}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {chartGenreData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend 
                          layout="vertical" 
                          verticalAlign="middle" 
                          align="right" 
                          wrapperStyle={{ fontSize: 9, maxWidth: "50%", paddingBottom: 15 }} 
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Ring overlay label */}
                    <div className="absolute top-[41%] left-[30.5%] md:left-[30.5%] lg:left-[30.5%] -translate-x-[50%] -translate-y-[50%] pointer-events-none flex flex-col items-center">
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-500 leading-none">علاقه</span>
                      <span className="text-lg font-black mt-0.5 leading-none font-mono">100%</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* GitHub Style Contribution Board / Heatmap */}
              <div className={`p-5 rounded-3xl border ${
                isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
              } space-y-4`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-mono font-black uppercase text-slate-400">تقویم مشارکت و رویدادهای مطالعه</h4>
                    <p className="text-[10px] text-slate-500">نمایش بصری نقاط عطف سجل مطالعه و بارگذاری پیش‌نویس‌های نویسنده</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[8px] font-mono text-slate-500 uppercase">
                    <span>کمتر</span>
                    <div className="w-2 h-2 rounded-xs bg-slate-800" />
                    <div className="w-2 h-2 rounded-xs bg-violet-600/30" />
                    <div className="w-2 h-2 rounded-xs bg-violet-600/60" />
                    <div className="w-2 h-2 rounded-xs bg-violet-600" />
                    <span>بیشتر</span>
                  </div>
                </div>

                <div className="grid grid-cols-12 md:grid-cols-24 gap-1.5 md:gap-1 p-2 bg-black/10 dark:bg-black/25 rounded-2xl border border-slate-700/5 overflow-hidden">
                  {activityHexes.map((lvl, idx) => (
                    <motion.div
                      whileHover={{ scale: 1.25, rotate: 5 }}
                      transition={{ type: "spring", stiffness: 400 }}
                      key={idx}
                      className={`aspect-square w-full rounded-md cursor-pointer transition-all ${getHexOpacity(lvl)}`}
                      title={`شاخص فعالیت: سطح ${lvl}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-500">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> همگام‌سازی سامانه در {new Date().toISOString().slice(0, 10)}</span>
                  <span>146 تعامل در مجموع ثبت شد</span>
                </div>
              </div>

            </motion.div>
          )}

          {/* TAB: ACHIEVEMENTS */}
          {activeTab === "achievements" && (
            <motion.div
              key="achievements-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className={`p-6 rounded-3xl border ${isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"} space-y-6 shadow-lg relative`}
            >
              <div className="flex items-center gap-3 pb-3 border-b border-slate-750/10 dark:border-slate-800/40">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <Trophy className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight">همه دستاوردها</h3>
                  <p className="text-[11px] text-slate-500 font-medium">مشاهده همه دستاوردهای موجود</p>
                </div>
              </div>

              {/* Filter and Sort Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-150/10 dark:bg-black/20 border border-slate-200/10 dark:border-slate-800/40 text-xs">
                <div className="flex flex-wrap gap-4">
                  {/* Status Filter */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block">وضعیت</span>
                    <select
                      value={achFilterStatus}
                      onChange={(e) => setAchFilterStatus(e.target.value as any)}
                      className={`px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500 font-medium ${
                        isDark ? "bg-[#0b0c16] border-slate-800 text-slate-300" : "bg-white border-stone-200 text-stone-700"
                      }`}
                    >
                      <option value="all">همه وضعیت‌ها</option>
                      <option value="done">تکمیل‌شده / دریافت‌شده</option>
                      <option value="not_done">قفل / دریافت‌نشده</option>
                    </select>
                  </div>

                  {/* XP Filter */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block">جایزه امتیاز تجربه</span>
                    <select
                      value={achFilterXp}
                      onChange={(e) => setAchFilterXp(e.target.value as any)}
                      className={`px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500 font-medium ${
                        isDark ? "bg-[#0b0c16] border-slate-800 text-slate-300" : "bg-white border-stone-200 text-stone-700"
                      }`}
                    >
                      <option value="all">همه سطوح امتیاز</option>
                      <option value="low">کم (&lt; 200 XP)</option>
                      <option value="mid">متوسط (200 تا 500 XP)</option>
                      <option value="high">زیاد (&gt; 500 XP)</option>
                    </select>
                  </div>
                </div>

                {/* Sort By */}
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block">مرتب‌سازی بر اساس</span>
                  <select
                    value={achSortBy}
                    onChange={(e) => setAchSortBy(e.target.value as any)}
                    className={`px-3 py-1.5 rounded-lg border focus:outline-none focus:border-violet-500 font-medium w-full sm:w-48 ${
                      isDark ? "bg-[#0b0c16] border-slate-800 text-slate-300" : "bg-white border-stone-200 text-stone-700"
                    }`}
                  >
                    <option value="hardest">سخت‌ترین (بیشترین امتیاز تجربه)</option>
                    <option value="easiest">آسان‌ترین (کمترین امتیاز تجربه)</option>
                    <option value="most_common">پرتکرارترین (بیشترین دریافت)</option>
                    <option value="rarest">کمیاب‌ترین (کمترین دریافت)</option>
                  </select>
                </div>
              </div>

              {filteredAchievements.length === 0 ? (
                <div className="p-12 text-center text-slate-500 border-2 border-dashed border-slate-800/20 dark:border-slate-850 rounded-2xl">
                  <p className="text-xs font-medium">هیچ دستاوردی با معیارهای فیلتر انتخابی شما مطابقت ندارد.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredAchievements.map((item) => {
                  const AchieveIcon = item.icon;
                  const isClaimed = item.claimedByUser || claimedAchievements.includes(item.id);
                  return (
                    <div 
                      key={item.id} 
                      className={`flex flex-col gap-3 p-4 rounded-2xl border transition-all ${
                        isClaimed
                          ? (isDark ? "bg-emerald-500/5 border-emerald-900/30 text-emerald-200" : "bg-emerald-50 border-emerald-100 text-stone-800")
                          : item.unlocked
                          ? (isDark ? "bg-violet-500/10 border-violet-800/40 text-slate-100 animate-pulse" : "bg-violet-50 border-violet-200 text-stone-900")
                          : isDark ? "bg-black/20 border-slate-800/50 text-slate-500" : "bg-stone-50 border-stone-200 opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-xl border shrink-0 ${
                          isClaimed
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                            : item.unlocked 
                            ? (item.tier === "Gold" ? "bg-amber-500/10 border-amber-500/20 text-amber-500" : "bg-purple-500/10 border-purple-500/20 text-purple-400")
                            : "bg-transparent border-transparent text-slate-400"
                        }`}>
                          <AchieveIcon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 leading-none mb-1">
                            <span className={`font-bold text-sm truncate ${isDark ? "text-white" : "text-stone-900"}`}>{item.title}</span>
                            <span className={`text-[8px] font-mono font-black uppercase px-2 py-0.5 rounded-sm ${
                                item.tier === 'Gold' ? 'bg-amber-500/20 text-amber-500' :
                                item.tier === 'Silver' ? 'bg-slate-400/20 text-slate-300' :
                                'bg-orange-500/20 text-orange-400'
                            }`}>{item.tier === 'Gold' ? 'طلا' : item.tier === 'Silver' ? 'نقره' : 'برنز'}</span>
                          </div>
                          <p className={`text-[11px] ${isDark ? "text-slate-400" : "text-slate-600"} leading-snug`}>{item.desc}</p>
                          <div className="mt-2 text-[10px] font-mono font-bold text-slate-500 flex items-center gap-1.5">
                            <Users className={`w-3 h-3 ${isDark ? "text-slate-600" : "text-slate-400"}`}/>
                            {item.claimedCount.toLocaleString()} {item.claimedCount === 1 ? 'کاربر این را دریافت کرده است' : 'کاربر این را دریافت کرده‌اند'}
                          </div>
                        </div>
                      </div>

                      <div className={`flex items-center justify-between pt-2 mt-auto font-mono text-[10px] border-t ${isDark ? "border-white/5" : "border-slate-200"}`}>
                        <span className={`${isDark ? "text-slate-400" : "text-slate-500"} font-bold`}>جایزه: <span className={item.tier === 'Gold' ? 'text-amber-500': 'text-violet-500'}>+{item.xpReward} امتیاز تجربه</span></span>
                        {isClaimed ? (
                          <span className="text-emerald-500 font-black uppercase tracking-wider flex items-center gap-1.5">
                            <CheckCircle className="w-3 h-3" />
                            دریافت شد
                          </span>
                        ) : item.unlocked ? (
                          <button
                            onClick={() => onClaimAchievement(item.id, item.xpReward)}
                            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 active:scale-95 transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer shadow-sm border border-violet-500"
                          >
                            دریافت جایزه
                          </button>
                        ) : (
                          <span className={`${isDark ? "text-slate-500" : "text-slate-400"} font-bold uppercase tracking-wider flex items-center gap-1.5`}>
                            <Lock className="w-3 h-3" />
                            قفل
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 2: SOCIAL CONNECTIONS (FOLLOWERS & FOLLOWING MANAGER) */}
          {activeTab === "social" && (
            <motion.div
              key="social-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="space-y-6"
            >
              {exchangeStats && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ["دریافتی", exchangeStats.reviewsReceived || 0],
                    ["ثبت‌شده", exchangeStats.reviewsGiven || 0],
                    ["رمان‌های شما", exchangeStats.totalNovelsByUser || 0]
                  ].map(([label, value]) => (
                    <div key={label} className={`p-4 rounded-2xl border ${isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"}`}>
                      <p className="text-[10px] font-mono uppercase font-black text-slate-400">{label}</p>
                      <p className="text-2xl font-black tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                
                {/* Followers column */}
                <div className={`p-5 rounded-3xl border ${
                  isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
                } space-y-4`}>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <h4 className="text-xs font-mono font-black uppercase text-slate-400">دنبال‌کنندگان</h4>
                      <span className="text-[10px] font-mono text-violet-500 font-extrabold bg-violet-500/5 px-2 py-0.5 rounded leading-none border border-violet-500/10">
                        {followers.length} پروفایل
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">اعضایی که به‌روزرسانی رمان‌های شما را دنبال می‌کنند</p>
                  </div>

                  {/* Search bar inside followers list to keep it interactive */}
                  <div className={`flex items-center gap-2 p-2 rounded-xl border ${isDark ? "bg-black/25 border-slate-900/80" : "bg-stone-50 border-stone-200"} text-xs`}>
                    <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <input 
                      type="text"
                      placeholder="جستجوی دنبال‌کنندگان..."
                      value={followerFilter}
                      onChange={(e) => setFollowerFilter(e.target.value)}
                      className="w-full bg-transparent focus:outline-none font-bold"
                    />
                  </div>

                  <div className="space-y-2.5 max-h-[50vh] overflow-y-auto">
                    {followers
                      .filter(f => f.username.toLowerCase().includes(followerFilter.toLowerCase()))
                      .map((val) => (
                        <div 
                          key={val.id} 
                          className={`flex items-center justify-between p-3.5 rounded-2xl bg-black/5 dark:bg-black/20 border border-slate-700/5 dark:border-slate-900/40 text-xs transition-colors hover:border-violet-500/20`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 text-white font-mono font-black flex items-center justify-center text-xs shadow-md overflow-hidden">
                              {getSafeAvatarUrl(val.avatar) ? (
                                <SafeImage src={getSafeAvatarUrl(val.avatar) || ""} alt={val.displayName || val.username} className="w-full h-full object-cover" />
                              ) : (
                                String(val.displayName || val.username || "U").slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="text-left leading-none space-y-1">
                              <span className="font-extrabold text-slate-700 dark:text-slate-300 font-mono text-xs">{val.displayName || val.username}</span>
                              <span className="block text-[9px] text-slate-500 font-medium">@{val.username}</span>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => handleSocialFollowToggle(val, !val.followed)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-mono font-black uppercase tracking-wider shrink-0 border cursor-pointer transition-all ${
                              val.followed
                                ? "bg-slate-700/20 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-700/30 hover:bg-rose-500 hover:text-white hover:border-rose-400"
                                : "bg-violet-600 text-white border-violet-500 hover:bg-violet-500"
                            }`}
                          >
                            {val.followed ? "لغو دنبال" : "دنبال متقابل"}
                          </button>
                        </div>
                      ))}
                    {followers.filter(f => f.username.toLowerCase().includes(followerFilter.toLowerCase())).length === 0 && (
                      <div className="text-center py-12 text-slate-550 font-mono text-xs italic">
                        هیچ دنبال‌کننده‌ای مطابق جستجوی شما یافت نشد
                      </div>
                    )}
                  </div>
                </div>

                {/* Following column */}
                <div className={`p-5 rounded-3xl border ${
                  isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
                } space-y-4`}>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <h4 className="text-xs font-mono font-black uppercase text-slate-400">دنبال‌شده‌ها</h4>
                      <span className="text-[10px] font-mono text-purple-500 font-extrabold bg-[#a855f7]/5 px-2 py-0.5 rounded leading-none border border-purple-500/10">
                        {following.length} نویسنده
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">نویسندگان و قلم‌هایی که دنبال می‌کنید</p>
                  </div>

                  {/* Search bar inside following list */}
                  <div className={`flex items-center gap-2 p-2 rounded-xl border ${isDark ? "bg-black/25 border-slate-900/80" : "bg-stone-50 border-stone-200"} text-xs`}>
                    <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <input 
                      type="text"
                      placeholder="جستجوی نویسندگان..."
                      value={followingFilter}
                      onChange={(e) => setFollowingFilter(e.target.value)}
                      className="w-full bg-transparent focus:outline-none font-bold"
                    />
                  </div>

                  <div className="space-y-2.5 max-h-[50vh] overflow-y-auto">
                    {following
                      .filter(g => g.username.toLowerCase().includes(followingFilter.toLowerCase()))
                      .map((val) => (
                        <div 
                          key={val.id} 
                          className={`flex items-center justify-between p-3.5 rounded-2xl bg-black/5 dark:bg-black/20 border border-slate-700/5 dark:border-slate-900/40 text-xs transition-colors hover:border-purple-500/20`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white font-mono font-black flex items-center justify-center text-xs shadow-md overflow-hidden">
                              {getSafeAvatarUrl(val.avatar) ? (
                                <SafeImage src={getSafeAvatarUrl(val.avatar) || ""} alt={val.displayName || val.username} className="w-full h-full object-cover" />
                              ) : (
                                String(val.displayName || val.username || "U").slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="text-left leading-none space-y-1">
                              <span className="font-extrabold text-slate-700 dark:text-slate-300 font-mono text-xs">{val.displayName || val.username}</span>
                              <span className="block text-[9px] text-slate-500 font-medium">@{val.username}</span>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => handleSocialFollowToggle(val, !val.followed)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-mono font-black uppercase tracking-wider shrink-0 border cursor-pointer transition-all ${
                              val.followed
                                ? "bg-slate-700/20 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-700/30 hover:bg-rose-500 hover:text-white hover:border-rose-400"
                                : "bg-purple-600 text-white border-purple-500 hover:bg-purple-500"
                            }`}
                          >
                            {val.followed ? "لغو دنبال" : "دنبال کردن"}
                          </button>
                        </div>
                      ))}
                    {following.filter(g => g.username.toLowerCase().includes(followingFilter.toLowerCase())).length === 0 && (
                      <div className="text-center py-12 text-slate-550 font-mono text-xs italic">
                        هیچ نویسنده‌ای برای دنبال کردن یافت نشد
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          )}

          {/* TAB 3: EXCHANGE LEDGER (RATINGS & COMMENTS REVIEWS LOGGER) */}
          {activeTab === "exchange" && (
            <motion.div
              key="exchange-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                
                {/* List 1: Comments Received on Your Works */}
                <div className={`p-5 rounded-3xl border ${
                  isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
                } space-y-4`}>
                  <div className="space-y-1">
                    <h4 className="text-xs font-mono font-black uppercase text-slate-400">نظرات دریافتی روی آثار شما</h4>
                    <p className="text-[10px] text-slate-500 font-sans">بررسی‌هایی که خوانندگان مستقیماً روی کتاب‌های نوشته‌شده شما ثبت کرده‌اند</p>
                  </div>

                  <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                    {exchangeReceived.length > 0 ? (
                        exchangeReceived.map((review) => (
                          <div 
                            key={review.id} 
                            className="p-3.5 bg-black/10 dark:bg-black/25 rounded-2xl border border-slate-700/5 dark:border-slate-900/40 space-y-2.5 transition-all hover:border-violet-500/10"
                          >
                            <div className="flex justify-between items-center text-[10px]">
                              <div className="flex items-center gap-1.5">
                                <span className="font-extrabold text-violet-500 dark:text-violet-400 font-mono text-xs leading-none">{review.username}</span>
                                <span className="text-[8px] font-mono bg-violet-500/10 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded leading-none block">در {review.novelTitle}</span>
                              </div>
                              <span className="text-slate-500 font-medium font-mono text-[9px]">{review.createdAt}</span>
                            </div>
                            
                            <div className="flex items-center gap-0.5 text-amber-500 leading-none">
                              {Array.from({ length: 5 }).map((_, idx) => (
                                <Star 
                                  key={idx} 
                                  className={`w-3.5 h-3.5 ${
                                    idx < (review.rating || 5) 
                                      ? "fill-amber-500 text-amber-500" 
                                      : "text-slate-600"
                                  }`} 
                                />
                              ))}
                            </div>
                            
                            <p className="text-slate-600 dark:text-slate-430 italic text-xs leading-relaxed font-sans pt-1">
                              "{review.comment}"
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-12 text-slate-550 italic font-mono text-xs">
                          هنوز نظری دریافت نکرده‌اید. به نوشتن ادامه دهید!
                        </div>
                      )}
                  </div>
                </div>

                {/* List 2: Comments & Reviews You Left */}
                <div className={`p-5 rounded-3xl border ${
                  isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"
                } space-y-4`}>
                  <div className="space-y-1">
                    <h4 className="text-xs font-mono font-black uppercase text-slate-400">نظرات و بررسی‌هایی که ثبت کرده‌اید</h4>
                    <p className="text-[10px] text-slate-500 font-sans">آرشیوی مرکزی از امتیازهایی که در رپتوک ثبت کرده‌اید</p>
                  </div>

                  <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                    {exchangeGiven.length > 0 ? (
                      exchangeGiven.map((myCom) => (
                        <div 
                          key={myCom.id} 
                          className="p-3.5 bg-black/10 dark:bg-black/25 rounded-2xl border border-slate-700/5 dark:border-slate-900/40 space-y-2.5 transition-all hover:border-purple-500/10"
                        >
                          <div className="flex justify-between items-center text-[10px]">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-purple-500 dark:text-purple-400 font-mono tracking-tight text-xs">در {myCom.novelTitle}</span>
                            </div>
                            <span className="text-slate-500 font-medium font-mono text-[9px]">{myCom.createdAt}</span>
                          </div>
                          
                          <div className="flex items-center gap-0.5 text-amber-500 leading-none">
                            {Array.from({ length: 5 }).map((_, idx) => (
                              <Star 
                                key={idx} 
                                className={`w-3.5 h-3.5 ${
                                  idx < myCom.rating 
                                    ? "fill-amber-500 text-amber-500" 
                                    : "text-slate-600"
                                }`} 
                              />
                            ))}
                          </div>
                          
                          <p className="text-slate-600 dark:text-slate-430 italic text-xs leading-relaxed font-sans pt-1">
                            "{myCom.comment}"
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-slate-550 italic font-mono text-xs">
                        هنوز بررسی‌ای نوشته‌اید. به کاوش داستان‌های بیشتر بپردازید!
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          )}

          {activeTab === "security" && (
            <motion.div
              key="security-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="space-y-6"
            >
              <div className={`p-6 rounded-3xl border ${isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"} space-y-5 shadow-lg`}>
                <div className="flex items-center gap-3 pb-3 border-b border-slate-750/10 dark:border-slate-800/40">
                  <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black tracking-tight flex items-center gap-2">
                      امنیت حساب
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">{currentUser?.password_set === false ? "رمز عبوری تنظیم کنید تا بدون گوگل هم بتوانید وارد شوید" : "رمز عبور خود را به‌روزرسانی کنید"}</p>
                  </div>
                </div>

                <form onSubmit={handlePasswordChange} className="space-y-4">
                  {secFeedback && (
                    <div className={`p-3 rounded-xl border text-xs font-black text-center ${secFeedback.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-rose-500/10 border-rose-500/20 text-rose-500"}`}>
                      {secFeedback.message}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={`space-y-1 ${currentUser?.password_set === false ? "hidden" : ""}`}>
                      <label className="text-[10px] font-mono uppercase font-black text-slate-400">رمز عبور فعلی</label>
                      <input 
                        type="password" 
                        required={currentUser?.password_set !== false}
                        value={secCurrentPassword}
                        onChange={e => setSecCurrentPassword(e.target.value)}
                        className={`w-full py-2.5 px-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-purple-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-purple-500"}`}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase font-black text-slate-400">رمز عبور جدید</label>
                      <input 
                        type="password" 
                        required
                        value={secNewPassword}
                        onChange={e => setSecNewPassword(e.target.value)}
                        className={`w-full py-2.5 px-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-purple-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-purple-500"}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase font-black text-slate-400">تکرار رمز عبور جدید</label>
                      <input 
                        type="password" 
                        required
                        value={secRepeatPassword}
                        onChange={e => setSecRepeatPassword(e.target.value)}
                        className={`w-full py-2.5 px-4 text-xs font-extrabold rounded-xl border focus:outline-none transition-all ${isDark ? "bg-black/25 border-slate-800 text-white focus:border-purple-500" : "bg-stone-50 border-stone-200 text-stone-900 focus:border-purple-500"}`}
                      />
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={secLoading}
                    className="py-2.5 px-6 rounded-xl bg-purple-600 text-white text-xs font-black uppercase tracking-wider hover:bg-purple-500 active:scale-95 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                  >
                    {secLoading ? "در حال به‌روزرسانی..." : (currentUser?.password_set === false ? "تنظیم رمز عبور" : "به‌روزرسانی رمز عبور")}
                  </button>
                </form>
              </div>

              <div className={`p-6 rounded-3xl border ${isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"} space-y-4 shadow-lg`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm"><GoogleLogo className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-lg font-black tracking-tight">حساب گوگل</h3>
                      <p className="text-xs text-slate-500 font-medium mt-1">
                        {googleConnected
                          ? `متصل به ${googleAccountEmail || "ایمیل گوگل شما"}`
                          : <>ایمیل گوگل باید دقیقاً با ایمیل حساب شما یکی باشد: <strong className="text-slate-700 dark:text-slate-300">{googleAccountEmail || "بدون ایمیل حساب"}</strong>.</>}
                      </p>
                    </div>
                  </div>
                  {googleConnected ? (
                    <button type="button" disabled={googleLoading} onClick={handleGoogleDisconnect} className="py-2.5 px-6 rounded-xl border border-rose-500/30 text-rose-500 text-xs font-black hover:bg-rose-500 hover:text-white disabled:opacity-50">
                      {googleLoading ? "در حال قطع اتصال..." : "قطع اتصال گوگل"}
                    </button>
                  ) : (
                    <button type="button" disabled={googleLoading || !googleAccountEmail} onClick={() => api.startGoogleAuth("link")} className="inline-flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl bg-white text-slate-900 border border-slate-200 text-xs font-black hover:bg-slate-100 disabled:opacity-50">
                      <GoogleLogo /> اتصال گوگل
                    </button>
                  )}
                </div>
                {googleConnected && currentUser?.password_set === false && (
                  <p className="text-xs font-bold text-amber-500">پیش از قطع اتصال گوگل، ابتدا در بالا رمز عبور تنظیم کنید.</p>
                )}
              </div>

              <div className={`p-6 rounded-3xl border ${isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"} space-y-4 shadow-lg`}>
                <div className="flex justify-between items-center pb-3 border-b border-slate-750/10 dark:border-slate-800/40">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-500 border border-violet-500/20">
                      <Laptop className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black tracking-tight">نشست‌های فعال</h3>
                      <p className="text-xs text-slate-500 font-medium">مدیریت دستگاه‌هایی که در آن‌ها وارد شده‌اید</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className={`p-4 rounded-2xl border ${isDark ? 'bg-black/25' : 'bg-white'} text-left`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold">احراز هویت دومرحله‌ای (2FA)</div>
                        <div className="text-xs text-slate-500">افزودن امنیت بیشتر با TOTP (Google Authenticator, Authy)</div>
                      </div>
                      <div>
                        {twoFaEnabled ? (
                          <button onClick={async () => {
                            const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                            const code = prompt('برای غیرفعال‌سازی، کد فعلی 2FA را وارد کنید:');
                            if (!code) return;
                            setTwoFaLoading(true);
                            const ok = await api.disable2FA(token, code);
                            setTwoFaLoading(false);
                            if (ok) { setTwoFaEnabled(false); alert('2FA غیرفعال شد'); }
                            else alert('غیرفعال‌سازی 2FA ناموفق بود');
                          }} className="px-3 py-1 rounded bg-rose-600 text-white text-xs">غیرفعال‌سازی</button>
                        ) : (
                          <button onClick={async () => {
                            const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                            setTwoFaLoading(true);
                            const data = await api.get2FASetup(token);
                            setTwoFaLoading(false);
                            if (data && data.secret) { setTwoFaSetupSecret(data.secret); setTwoFaOtpUrl(data.otpauth || null); alert('راه‌اندازی 2FA ایجاد شد. برای فعال‌سازی کد را وارد کنید.'); }
                            else alert('دریافت اطلاعات راه‌اندازی 2FA ناموفق بود');
                          }} className="px-3 py-1 rounded bg-emerald-600 text-white text-xs">فعال‌سازی</button>
                        )}
                      </div>
                    </div>

                    {!twoFaEnabled && twoFaSetupSecret && (
                      <div className="mt-3 space-y-2 text-xs">
                        <div>این QR را در اپلیکیشن احراز هویت خود اسکن کنید یا کلید مخفی را دستی وارد کنید:</div>
                        <div className="font-mono p-2 bg-slate-800 text-white rounded text-[13px]">{twoFaSetupSecret}</div>
                        <div className="flex gap-2">
                          <input value={twoFaTokenInput} onChange={e => setTwoFaTokenInput(e.target.value)} placeholder="کد را از اپلیکیشن وارد کنید" className="p-2 text-xs rounded border flex-1" />
                          <button onClick={async () => {
                            const token = api.getToken(); if (!token) return alert('احراز هویت نشده است');
                            if (!twoFaSetupSecret) return alert('کلید مخفی موجود نیست');
                            setTwoFaLoading(true);
                            const ok = await api.enable2FA(token, twoFaSetupSecret, twoFaTokenInput);
                            setTwoFaLoading(false);
                            if (ok) { setTwoFaEnabled(true); setTwoFaSetupSecret(null); setTwoFaTokenInput(''); alert('2FA فعال شد'); }
                            else alert('فعال‌سازی 2FA ناموفق بود (کد نامعتبر)');
                          }} className="px-3 py-1 bg-purple-600 text-white rounded text-xs">تأیید</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {sessions.length > 0 ? sessions.map(session => (
                    <div key={session.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-black/5 dark:bg-black/25 border border-slate-200 dark:border-slate-800 gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-800 dark:text-slate-200">{session.meta?.os || 'سیستم‌عامل ناشناخته'}</span>
                          {session.isCurrent && (
                            <span className="px-2 py-0.5 rounded text-[9px] font-mono font-black uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">فعلی</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 font-mono">
                           <span>IP: {session.meta?.ip || 'نامشخص'}</span>
                           <span>•</span>
                           <span>{session.meta?.browser || 'مرورگر ناشناخته'}</span>
                           <span>•</span>
                           <span>{session.meta?.device || 'دسکتاپ/نامشخص'}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono pt-0.5">شروع: {new Date(session.createdAt).toLocaleDateString("fa-IR")} {new Date(session.createdAt).toLocaleTimeString("fa-IR")}</p>
                      </div>
                      <button 
                        onClick={() => handleEndSession(session.id, session.isCurrent)}
                        className={`px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                          session.isCurrent ? "border-rose-500/20 bg-rose-500/5 text-rose-500 hover:bg-rose-500 hover:text-white" : "border-slate-300 dark:border-slate-700 bg-transparent text-slate-600 dark:text-slate-400 hover:bg-rose-500 hover:text-white hover:border-transparent"
                        }`}
                      >
                        {session.isCurrent ? "پایان نشست (خروج)" : "پایان نشست از راه دور"}
                      </button>
                    </div>
                  )) : (
                     <div className="text-center py-6 text-slate-500 text-xs font-mono">در حال بارگذاری نشست‌ها...</div>
                  )}
                </div>
              </div>

              <section className={`rounded-3xl border p-6 ${isDark ? "border-rose-500/25 bg-rose-950/10" : "border-rose-200 bg-rose-50"} space-y-4`}>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-2.5 text-rose-500"><Trash2 className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-black text-rose-500">حذف حساب</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">این عمل دائمی است. از همه‌جا خارج می‌شوید و امکان بازیابی این حساب وجود ندارد.</p>
                  </div>
                </div>
                {!deleteAccountOpen ? (
                  <button type="button" onClick={() => setDeleteAccountOpen(true)} className="rounded-xl border border-rose-500/30 px-4 py-2 text-xs font-black text-rose-500 hover:bg-rose-500 hover:text-white">
                    مشاهده جزئیات حذف
                  </button>
                ) : (
                  <form onSubmit={handleDeleteAccount} className="space-y-4">
                    <div className={`rounded-2xl border p-4 text-xs leading-relaxed ${isDark ? "border-slate-800 bg-black/25" : "border-rose-100 bg-white"}`}>
                      <p className="font-black">حذف حساب چه چیزی را پاک می‌کند</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-500">
                        <li>رمان‌های منتشرشده و پیش‌نویس، فصل‌های آن‌ها، تصاویر بارگذاری‌شده، نظرات، نظرات پاراگراف، پسندها، واکنش‌ها، نشانک‌ها و تاریخچه مطالعه حذف می‌شوند.</li>
                        <li>پروفایل، ترجیحات، اطلاعات ورود پیوند‌شده، نشست‌ها و دسترسی نوسازی شما حذف می‌شود.</li>
                        <li>اشتراک‌های تمدیدشونده فعال پیش از حذف لغو می‌شوند. تنظیمات ذخیره‌شده نمایش پریمیوم همراه با رمان‌های حذف‌شده از بین می‌رود.</li>
                        <li>سوابق پرداخت و صورت‌حساب مورد نیاز برای امور مالی، بدون شناسه کاربری شما نگهداری می‌شوند؛ سوابق سرویس‌دهنده تابع سیاست نگهداری پردازنده پرداخت است.</li>
                      </ul>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-500">رمز عبور فعلی</span>
                      <input type="password" autoComplete="current-password" required value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} className={`w-full rounded-xl border px-3 py-2.5 text-xs ${isDark ? "border-slate-800 bg-black/30" : "border-stone-200 bg-white"}`} />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-500">برای تأیید DELETE را تایپ کنید</span>
                      <input required value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" className={`w-full rounded-xl border px-3 py-2.5 font-mono text-xs ${isDark ? "border-slate-800 bg-black/30" : "border-stone-200 bg-white"}`} />
                    </label>
                    {deleteAccountError && <p role="alert" className="text-xs font-bold text-rose-500">{deleteAccountError}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={deleteAccountBusy || deleteConfirmation !== "DELETE" || !deletePassword} className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                        {deleteAccountBusy ? "در حال حذف ایمن..." : "حذف دائمی حساب"}
                      </button>
                      <button type="button" disabled={deleteAccountBusy} onClick={() => { setDeleteAccountOpen(false); setDeleteConfirmation(""); setDeletePassword(""); setDeleteAccountError(""); }} className="rounded-xl border border-slate-500/25 px-4 py-2.5 text-xs font-bold">
                        لغو
                      </button>
                    </div>
                  </form>
                )}
              </section>

            </motion.div>
          )}

          {activeTab === "preferences" && (
            <motion.div
              key="preferences-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className={`p-6 rounded-3xl border ${isDark ? "bg-[#05060f] border-violet-900/15" : "bg-white border-stone-200"} space-y-6 shadow-lg relative`}
            >
              <div className="flex items-center gap-3 pb-3 border-b border-slate-750/10 dark:border-slate-800/40">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <Heart className="w-5 h-5" />
                </div>
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black tracking-tight">ترجیحات زیرژانر</h3>
                    <p className="text-[11px] text-slate-500 font-medium">زیرژانرهای مورد علاقه خود را برای شخصی‌سازی تجربه مطالعه انتخاب کنید</p>
                  </div>
                  <button
                    onClick={handleSavePreferences}
                    disabled={preferencesLoading}
                    className="px-4 py-2 bg-amber-500 text-white text-xs font-black uppercase rounded-lg hover:bg-amber-600 transition-colors cursor-pointer"
                  >
                    {preferencesLoading ? "در حال ذخیره..." : "ذخیره ترجیحات"}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-black tracking-tight">اعلان‌ها</h3>
                  <p className="text-[11px] text-slate-500">انتخاب کنید کدام رویدادهای حساب و نویسنده بتوانند به شما اعلان بدهند.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    ["notify_comments", "نظرات جدید روی رمان‌های من"],
                    ["notify_ratings", "امتیازهای جدید روی رمان‌های من"],
                    ["notify_likes", "پسندهای جدید روی رمان‌های من"],
                    ["notify_defaults", "اعلان‌های پیش‌فرض سیستم"],
                    ["notify_replies", "پاسخ‌ها به نظرات من"],
                    ["notify_logins", "هشدارهای امنیتی ورود جدید به حساب"]
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-black/[0.02] dark:bg-black/20 cursor-pointer">
                      <span className="text-xs font-bold">{label}</span>
                      <input type="checkbox" checked={notificationPrefs[key] !== false} onChange={(event) => setNotificationPrefs((prefs) => ({ ...prefs, [key]: event.target.checked }))} className="w-4 h-4" />
                    </label>
                  ))}
                </div>
                <div className="flex flex-col gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-violet-500" />
                    <div>
                      <p className="text-xs font-black">Push Notification این دستگاه</p>
                      <p className="mt-1 text-[10px] text-slate-500">فصل جدید، پاسخ دیدگاه/انجمن و نتیجهٔ چالش حتی وقتی سایت بسته است.</p>
                      {pushMessage && <p role="status" className="mt-1 text-[10px] font-bold text-violet-500">{pushMessage}</p>}
                    </div>
                  </div>
                  <button type="button" onClick={togglePush} disabled={pushState === "loading" || pushState === "unsupported" || pushState === "denied"} className={`min-w-28 rounded-xl px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 ${pushState === "enabled" ? "bg-rose-600 hover:bg-rose-500" : "bg-violet-600 hover:bg-violet-500"}`}>
                    {pushState === "loading" ? "در حال بررسی…" : pushState === "enabled" ? "غیرفعال‌سازی" : pushState === "denied" ? "مسدودشده" : pushState === "unsupported" ? "پشتیبانی نمی‌شود" : "فعال‌سازی"}
                  </button>
                </div>
              </div>

              {preferencesSaved && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-bold rounded-xl text-center">
                  ترجیحات با موفقیت ذخیره شد!
                </div>
              )}

              <div className="flex flex-wrap gap-2.5 max-h-[60vh] overflow-y-auto px-1 pb-4 custom-scrollbar">
                {SUB_CATEGORIES.map(sub => {
                  const isSelected = subgenrePreferences.includes(sub);
                  return (
                    <button
                      key={sub}
                      onClick={() => {
                         if (isSelected) {
                            setSubgenrePreferences(subgenrePreferences.filter(x => x !== sub));
                         } else {
                            setSubgenrePreferences([...subgenrePreferences, sub]);
                         }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                        isSelected 
                          ? "bg-amber-500 text-white border-amber-500" 
                          : isDark ? "bg-black/30 text-slate-400 border-slate-800 hover:border-slate-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:border-stone-400"
                      }`}
                    >
                      {sub}
                    </button>
                  );
                })}
              </div>

            </motion.div>
          )}

        </div>

      </div>

    </motion.div>
  );
}

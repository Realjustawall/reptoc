import React, { useState, useEffect, useLayoutEffect, lazy } from "react";
import { Novel, Chapter, Review, ReadingProgress } from "./types";
import { normalizeBrandName } from "./utils/brandName";
import { CONTRAST_THEMES, updateDynamicCategories } from "./data";
import Dashboard from "./components/Dashboard";
import ThemeCustomizer from "./components/ThemeCustomizer";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_CUSTOM_THEME,
  accentThemeCssVariables,
  appearanceCssVariables,
  normalizeAccentTheme,
  normalizeAppearance,
  normalizeCustomTheme,
  readBrowserPreference,
  writeBrowserPreference,
  type AccentThemeId,
  type AppearanceSettings,
  type CustomThemeColors,
} from "./theme";

import SafeImage from "./components/SafeImage";
import LazyRouteBoundary from "./components/LazyRouteBoundary";
const EventStatus = lazy(() => import("./components/EventStatus"));
const DailyChallenges = lazy(() => import("./components/DailyChallenges"));
const NovelDetails = lazy(() => import("./components/NovelDetails"));
const Reader = lazy(() => import("./components/Reader"));
const Forums = lazy(() => import("./components/Forums"));
const Support = lazy(() => import("./components/Support"));
const Premium = lazy(() => import("./components/Premium"));
const UserProfile = lazy(() => import("./components/UserProfile"));
const AuthorProfile = lazy(() => import("./components/AuthorProfile"));
const Writer = lazy(() => import("./components/Writer"));
const AuthorityCenter = lazy(() => import("./components/AuthorityCenter"));
const EditorPanel = lazy(() => import("./components/EditorPanel"));
const Bookmarks = lazy(() => import("./components/Bookmarks"));
const OfflineDownloads = lazy(() => import("./components/OfflineDownloads"));
const NotFound = lazy(() => import("./components/NotFound"));
import ReportButton from "./components/ReportButton";
const WorldbuildingWorkspace = lazy(() => import("./components/worldbuilding/WorldbuildingWorkspace"));
import { api } from "./utils/api";
import { searchNovelsLocal } from "./utils/search";
import { isNovelApprovedForDiscovery } from "./utils/novelVisibility";
import { BookOpen, Feather, Bookmark, BookMarked, HelpCircle, Star, Sparkles, LogOut, Menu, X, ChevronLeft, ChevronRight, Award, Compass, History, Trophy, Flame, MessageSquare, Search, Users, Bell, Mail, ShieldAlert, User, Home, PenTool, Target, Download, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const DiscoverFeed = lazy(() => import("./components/Discover"));
import { normalizeIranianMobile } from "./utils/phone";
import { getRegistrationErrors } from "./utils/registrationValidation";
import {
  findNewAchievementNotification,
  readSeenAchievementNotificationIds,
  rememberAchievementNotificationIds,
} from "./utils/achievementNotifications";
import { ABOUT_US_HTML, AUTHOR_RULES_HTML, CONTACT_US_HTML, DMCA_POLICY_HTML, PRIVACY_POLICY_HTML, TERMS_OF_SERVICE_HTML } from "./legalContent";
import { applyChapterLikeToNovel } from "./utils/novelEngagement";
import { canonicalNotificationPath } from "./utils/notificationNavigation";
import { isSafeUrl } from "./utils/safeUrl";
import { hasNovelModerationUpdate } from "./utils/novelModerationNotifications";
import { haveSameNotificationSnapshot, mergeReadingProgressSnapshots, shouldPublishReadingProgress } from "./utils/renderStability";

import { initSocket, disconnectSocket, getSocket } from "./utils/socket";
import { disablePushNotifications } from "./utils/pushNotifications";

type AppView = "dashboard" | "ranking" | "event-status" | "notifications" | "challenges" | "offline" | "novel-details" | "reader" | "writer" | "worldbuilding" | "forums" | "support" | "premium" | "profile" | "author-profile" | "authority-center" | "editor-panel" | "bookmarks" | "discover" | "rules" | "terms-of-service" | "privacy-policy" | "dmca" | "contact-us" | "about-us" | "not-found";
type UserRole = "writer" | "editor" | "publisher" | "owner";

const NAV_STATE_STORAGE_KEY = "reptoc-navigation-state";
/**
 * Build stamp shown on the splash screen.
 *
 * Derived from the current date rather than hard-coded, so the number on screen
 * can never claim a build older (or newer) than the one being served.
 */
const BUILD_STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const APP_VIEWS = new Set<AppView>(["dashboard", "ranking", "event-status", "notifications", "challenges", "offline", "novel-details", "reader", "writer", "worldbuilding", "forums", "support", "premium", "profile", "author-profile", "authority-center", "editor-panel", "bookmarks", "discover", "rules", "terms-of-service", "privacy-policy", "dmca", "contact-us", "about-us", "not-found"]);

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

function getEffectiveUserRole(user: any): UserRole {
  const baseRole = String(user?.role || "").toLowerCase();
  if (baseRole === "owner") return "owner";

  const permissions = Array.isArray(user?.custom_permissions) ? user.custom_permissions : [];
  const hasAny = (...items: string[]) => items.some((item) => permissions.includes(item));
  const hasWildcard = (prefix: string) => permissions.includes(`${prefix}:*`);

  if (hasAny("admin:*", "user:promote", "user:delete", "user:ban")) return "owner";
  if (baseRole === "publisher" || hasWildcard("moderate") || hasAny("report:moderate", "novel:approve", "ticket:read_all", "ticket:update")) return "publisher";
  if (baseRole === "editor" || hasAny("novel:edit_all", "forum:edit", "forum:moderate")) return "editor";
  return "writer";
}

function getAccessLabel(role: UserRole): string {
  if (role === "owner") return "دسترسی مالک";
  if (role === "publisher") return "دسترسی مدیر";
  if (role === "editor") return "دسترسی ویراستار";
  return "دسترسی نویسنده";
}

function readSavedNavigationState() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NAV_STATE_STORAGE_KEY) || "null");
    if (!parsed || !APP_VIEWS.has(parsed.activeView)) return null;
    return parsed as {
      activeView: AppView;
      selectedNovelId?: string;
      selectedChapterId?: string;
      selectedAuthorName?: string;
      profileTab?: "overview" | "social" | "exchange" | "security";
    };
  } catch {
    return null;
  }
}

function readInitialNavigationState() {
  if (typeof window === "undefined") return null;
  const routeState = parseRouteNavigationState(window.location.pathname, window.location.search);
  if (routeState) return routeState;
  return readSavedNavigationState();
}

function parseRouteNavigationState(pathname: string, search: string) {
  const normalized = canonicalNotificationPath(pathname).replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);
  const profileTab = params.get("tab") as "overview" | "social" | "exchange" | "security" | null;

  if (normalized === "/") return { activeView: "dashboard" as AppView, profileTab: profileTab || "overview" };
  if (normalized === "/ranking") return { activeView: "ranking" as AppView };
  if (normalized === "/eventstatus") return { activeView: "event-status" as AppView };
  if (normalized === "/notifications") return { activeView: "notifications" as AppView };
  if (normalized === "/challenges") return { activeView: "challenges" as AppView };
  if (normalized === "/offline") return { activeView: "offline" as AppView };
  if (normalized === "/discover") return { activeView: "discover" as AppView };
  if (normalized === "/writer") return { activeView: "writer" as AppView };
  if (normalized === "/forums") return { activeView: "forums" as AppView };
  if (normalized === "/support") return { activeView: "support" as AppView };
  if (normalized === "/premium") return { activeView: "premium" as AppView };
  if (normalized === "/profile") return { activeView: "profile" as AppView, profileTab: profileTab || "overview" };
  if (normalized === "/editor-panel") return { activeView: "editor-panel" as AppView };
  if (normalized === "/authority-center") return { activeView: "authority-center" as AppView };
  if (normalized === "/bookmarks") return { activeView: "bookmarks" as AppView };
  if (normalized === "/rules") return { activeView: "rules" as AppView };
  if (normalized === "/terms-of-service") return { activeView: "terms-of-service" as AppView };
  if (normalized === "/privacy-policy") return { activeView: "privacy-policy" as AppView };
  if (normalized === "/dmca") return { activeView: "dmca" as AppView };
  if (normalized === "/contact-us") return { activeView: "contact-us" as AppView };
  if (normalized === "/about-us") return { activeView: "about-us" as AppView };
  if (normalized === "/not-found") return { activeView: "not-found" as AppView };

  const worldbuildingMatch = normalized.match(/^\/novels\/([^\/]+)\/worldbuilding(?:\/[^\/]*)?$/);
  if (worldbuildingMatch) return { activeView: "worldbuilding" as AppView, selectedNovelId: decodeURIComponent(worldbuildingMatch[1]), selectedChapterId: params.get("resource") || "" };
  const novelMatch = normalized.match(/^\/novels\/([^\/]+)(?:\/chapters\/([^\/]+))?$/);
  if (novelMatch) {
    const novelId = decodeURIComponent(novelMatch[1]);
    const chapterId = novelMatch[2] ? decodeURIComponent(novelMatch[2]) : "";
    return {
      activeView: chapterId ? "reader" as AppView : "novel-details" as AppView,
      selectedNovelId: novelId,
      selectedChapterId: chapterId,
    };
  }

  // Older notifications used /author/:name; keep those links functional while
  // the canonical public route remains /authors/:name.
  const authorMatch = normalized.match(/^\/authors?\/([^\/]+)$/);
  if (authorMatch) {
    return {
      activeView: "author-profile" as AppView,
      selectedAuthorName: decodeURIComponent(authorMatch[1]),
    };
  }

  return { activeView: "not-found" as AppView };
}

function buildNavigationUrl(state: {
  activeView: AppView;
  selectedNovelId?: string;
  selectedChapterId?: string;
  selectedAuthorName?: string;
  profileTab?: "overview" | "social" | "exchange" | "security";
}) {
  switch (state.activeView) {
    case "dashboard":
      return "/";
    case "ranking":
      return "/ranking";
    case "event-status":
      return "/eventstatus";
    case "notifications":
      return "/notifications";
    case "challenges":
      return "/challenges";
    case "offline":
      return "/offline";
    case "discover":
      return "/discover";
    case "writer":
      return "/writer";
    case "worldbuilding":
      return state.selectedNovelId ? `/novels/${encodeURIComponent(state.selectedNovelId)}/worldbuilding${state.selectedChapterId?`?resource=${encodeURIComponent(state.selectedChapterId)}`:""}` : "/";
    case "forums":
      return "/forums";
    case "support":
      return "/support";
    case "premium":
      return "/premium";
    case "profile":
      return state.profileTab ? `/profile?tab=${encodeURIComponent(state.profileTab)}` : "/profile";
    case "editor-panel":
      return "/editor-panel";
    case "authority-center":
      return "/authority-center";
    case "bookmarks":
      return "/bookmarks";
    case "rules":
      return "/rules";
    case "terms-of-service":
      return "/terms-of-service";
    case "privacy-policy":
      return "/privacy-policy";
    case "dmca":
      return "/dmca";
    case "contact-us":
      return "/contact-us";
    case "about-us":
      return "/about-us";
    case "novel-details":
      return state.selectedNovelId ? `/novels/${encodeURIComponent(state.selectedNovelId)}` : "/";
    case "reader":
      return state.selectedNovelId && state.selectedChapterId
        ? `/novels/${encodeURIComponent(state.selectedNovelId)}/chapters/${encodeURIComponent(state.selectedChapterId)}`
        : state.selectedNovelId
        ? `/novels/${encodeURIComponent(state.selectedNovelId)}`
        : "/";
    case "author-profile":
      return state.selectedAuthorName ? `/authors/${encodeURIComponent(state.selectedAuthorName)}` : "/";
    case "not-found":
      return "/not-found";
    default:
      return "/";
  }
}

function sanitizeInjectedHtml(html: string) {
  if (typeof window === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html || "";
  
  // Blocked tags - completely remove
  const blockedTags = new Set(["script", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "style", "svg", "video", "audio", "source", "track"]);
  
  // Safe tags that can be used
  const safeTags = new Set(["div", "span", "p", "a", "img", "br", "strong", "em", "u", "s", "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li"]);
  
  // Recursive sanitization
  const sanitizeNode = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      
      if (blockedTags.has(tagName)) {
        element.remove();
        return;
      }
      
      if (!safeTags.has(tagName)) {
        // Replace with children
        while (element.firstChild) {
          element.parentNode?.insertBefore(element.firstChild, element);
        }
        element.remove();
        return;
      }
      
      // Remove ALL attributes except for safe ones
      const safeAttrs: {[key: string]: string} = {};
      if (tagName === 'a') {
        const href = element.getAttribute('href') || '';
        if (href && isSafeUrl(href)) {
          safeAttrs['href'] = href;
          safeAttrs['target'] = '_blank';
          safeAttrs['rel'] = 'noopener noreferrer';
        }
      } else if (tagName === 'img') {
        const src = element.getAttribute('src') || '';
        if (src && src.toLowerCase().startsWith('https:')) {
          safeAttrs['src'] = src;
          safeAttrs['alt'] = element.getAttribute('alt') || 'تصویر';
          const width = element.getAttribute('width');
          const height = element.getAttribute('height');
          if (width && /^\d+$/.test(width)) safeAttrs['width'] = width;
          if (height && /^\d+$/.test(height)) safeAttrs['height'] = height;
        }
      }
      
      // Clear all attributes
      Array.from(element.attributes).forEach(attr => element.removeAttribute(attr.name));
      
      // Re-add safe attributes only
      Object.entries(safeAttrs).forEach(([key, value]) => {
        element.setAttribute(key, value);
      });
      
      // Sanitize children
      Array.from(element.childNodes).forEach(sanitizeNode);
    } else if (node.nodeType === Node.TEXT_NODE) {
      // Keep text nodes as-is
    } else {
      // Remove comments and other nodes
      node.parentNode?.removeChild(node);
    }
  };
  
  Array.from(template.content.childNodes).forEach(sanitizeNode);
  return template.innerHTML;
}

export default function App() {
  const savedNavigationState = React.useMemo(() => readInitialNavigationState(), []);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const authHydrationRequestRef = React.useRef(0);
  const [readingProgress, setReadingProgress] = useState<ReadingProgress[]>([]);
  // The shell no longer waits for startup API requests; route-specific effects
  // that previously waited for the splash may run immediately.
  const loadingInitial = false;
  
  // Navigation states
  const [activeView, setActiveView] = useState<AppView>(savedNavigationState?.activeView || "dashboard");
  const [profileTab, setProfileTab] = useState<"overview" | "social" | "exchange" | "security">(savedNavigationState?.profileTab || "overview");
  const [selectedNovelId, setSelectedNovelId] = useState<string>(savedNavigationState?.selectedNovelId || "");
  const [selectedChapterId, setSelectedChapterId] = useState<string>(savedNavigationState?.selectedChapterId || "");
  const [writerEditNovelId, setWriterEditNovelId] = useState<string>("");
  
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return readBrowserPreference("reptoc-theme") === "light" ? "light" : "dark";
  });
  const [accentTheme, setAccentTheme] = useState<AccentThemeId>(() => {
    return normalizeAccentTheme(readBrowserPreference("reptoc-accent-theme"));
  });
  const [customThemeColors, setCustomThemeColors] = useState<CustomThemeColors>(() => {
    try { return normalizeCustomTheme(JSON.parse(readBrowserPreference("reptoc-custom-theme") || "null")); } catch { return DEFAULT_CUSTOM_THEME; }
  });
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => {
    try { return normalizeAppearance(JSON.parse(readBrowserPreference("reptoc-appearance") || "null")); } catch { return DEFAULT_APPEARANCE; }
  });

  const handleViewLink = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>, view: AppView) => {
    // Preserve native link behaviour for a new tab/window and only intercept a
    // normal primary click for fast client-side navigation.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (view === "writer") setWriterEditNovelId("");
    setActiveView(view);
    setMobileMenuOpen(false);
  }, []);

  // Sidebar states
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [searchModalOpen, setSearchModalOpen] = useState<boolean>(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>("");
  const [globalSearchResults, setGlobalSearchResults] = useState<Novel[]>([]);

  // Interactive notifications & inbox dropdown states
  const [notificationOpen, setNotificationOpen] = useState<boolean>(false);
  const [inboxOpen, setInboxOpen] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [achievementToast, setAchievementToast] = useState<any | null>(null);
  const notificationIdsRef = React.useRef<Set<string> | null>(null);
  const seenAchievementNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const achievementToastSessionStartedAtRef = React.useRef(Date.now());
  const [dismissedLoginAlerts, setDismissedLoginAlerts] = useState<string[]>([]);
  const [emails, setEmails] = useState<any[]>([]);

  // A new route must start at its own top. Retaining a deep homepage scroll
  // position made mobile navigation look as if the destination never opened.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [activeView]);

  // Product chrome always uses the canonical spelling. This targeted update
  // avoids the expensive whole-document observer used by older builds.
  useLayoutEffect(() => {
    document.querySelectorAll<HTMLElement>(".app-brand-name").forEach((element) => {
      element.textContent = "رپتوک";
    });
  }, [activeView, mobileMenuOpen]);

  const [profileModalOpen, setProfileModalOpen] = useState<boolean>(false);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [myComments, setMyComments] = useState<any[]>([]);

  // Full-Stack integrated states
  const [selectedAuthorName, setSelectedAuthorName] = useState<string>(savedNavigationState?.selectedAuthorName || "");
  const [claimedAchievements, setClaimedAchievements] = useState<string[]>([]);
  const [userLevelState, setUserLevelState] = useState<{ level: number; xp: number }>({ level: 1, xp: 0 });
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>({
    maintenanceMode: false,
    announcement: "به سیستم‌های رپتوک خوش آمدید! نسخه 2.4.6 سیستم اکنون به‌طور کامل مستقر شده است.",
    allowRegistration: true
  });
  const [userRole, setUserRole] = useState<UserRole>("writer"); 
  const hydratedNovelIdsRef = React.useRef<Set<string>>(new Set());
  const [authToken, setAuthToken] = useState<string | null>(api.getToken());
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const progressSyncRef = React.useRef<Record<string, { at: number; percent: number }>>({});
  const renderedProgressRef = React.useRef<Record<string, number>>({});
  const countedNovelViewsRef = React.useRef<Set<string>>(new Set());

  // Real SQL Relational Authentication Form States
  const [authUsername, setAuthUsername] = useState<string>("");
  const [authEmail, setAuthEmail] = useState("");
const [authPhone, setAuthPhone] = useState("");
  const [authNickname, setAuthNickname] = useState("");
  const [authRepeatPassword, setAuthRepeatPassword] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [authShowPassword, setAuthShowPassword] = useState(false);
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authFormRole, setAuthFormRole] = useState<"writer" | "publisher" | "owner">("writer");
  const [isSignup, setIsSignup] = useState<boolean>(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [passwordResetStep, setPasswordResetStep] = useState<"request" | "confirm">("request");
  const [passwordResetEmail, setPasswordResetEmail] = useState("");
  const [passwordResetCode, setPasswordResetCode] = useState("");
  const [passwordResetNewPassword, setPasswordResetNewPassword] = useState("");
  const [passwordResetRepeatPassword, setPasswordResetRepeatPassword] = useState("");
  const [passwordResetMessage, setPasswordResetMessage] = useState("");
  const [authError, setAuthError] = useState<string>("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationMessage, setVerificationMessage] = useState("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [supportIssuePreset, setSupportIssuePreset] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleResult = params.get("google");
    if (!googleResult) return;
    if (googleResult === "error" || googleResult === "link_required") {
      setAuthError(params.get("message") || "ورود با گوگل کامل نشد.");
      setShowAuthModal(true);
    } else if (googleResult === "link_error" || googleResult === "linked") {
      const message = params.get("message") || (googleResult === "linked" ? "حساب گوگل با موفقیت متصل شد." : "اتصال حساب گوگل ممکن نشد.");
      window.sessionStorage.setItem("reptoc-google-link-feedback", JSON.stringify({ type: googleResult === "linked" ? "success" : "error", message }));
      setProfileTab("security");
      setActiveView("profile");
      if (googleResult === "linked") {
        api.getMe().then((authData) => {
          if (!authData?.success || !authData.user) return;
          if (authData.csrfToken) {
            api.setToken(authData.csrfToken, true);
            setAuthToken(authData.csrfToken);
          }
          setCurrentUser(authData.user);
          setUserRole(getEffectiveUserRole(authData.user));
          setUserLevelState({ level: authData.user.level || 1, xp: authData.user.xp || 0 });
        }).catch(() => {});
      }
    }
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }, []);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_STATE_STORAGE_KEY, JSON.stringify({
        activeView,
        selectedNovelId,
        selectedChapterId,
        selectedAuthorName,
        profileTab
      }));
    } catch {}
  }, [activeView, selectedNovelId, selectedChapterId, selectedAuthorName, profileTab]);

  const navigationSyncRef = React.useRef({ initialized: false });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncUrl = () => {
      // A missing resource renders the 404 view at the originally requested
      // URL. Rewriting it to /not-found made crawlers canonicalize unrelated
      // public URLs to the error page.
      if (activeView === "not-found") {
        navigationSyncRef.current.initialized = true;
        return;
      }
      const url = buildNavigationUrl({
        activeView,
        selectedNovelId,
        selectedChapterId,
        selectedAuthorName,
        profileTab
      });
      const current = window.location.pathname + window.location.search;
      if (current !== url) {
        if (navigationSyncRef.current.initialized) {
          window.history.pushState(null, "", url);
        } else {
          window.history.replaceState(null, "", url);
          navigationSyncRef.current.initialized = true;
        }
      } else {
        navigationSyncRef.current.initialized = true;
      }
    };

    syncUrl();
  }, [activeView, selectedNovelId, selectedChapterId, selectedAuthorName, profileTab]);

  useEffect(() => {
    if (activeView !== "author-profile" || !selectedAuthorName) return;
    let cancelled = false;
    api.resolveUsername(selectedAuthorName).then((resolved) => {
      if (cancelled || !resolved?.username || resolved.username === selectedAuthorName) return;
      const canonicalPath = `/authors/${encodeURIComponent(resolved.username)}`;
      window.history.replaceState(null, "", canonicalPath);
      setSelectedAuthorName(resolved.username);
    });
    return () => {
      cancelled = true;
    };
  }, [activeView, selectedAuthorName]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const routeState = parseRouteNavigationState(window.location.pathname, window.location.search);
      if (routeState) {
        setActiveView(routeState.activeView);
        setSelectedNovelId(routeState.selectedNovelId || "");
        setSelectedChapterId(routeState.selectedChapterId || "");
        setSelectedAuthorName(routeState.selectedAuthorName || "");
        setProfileTab(routeState.profileTab || "overview");
      } else {
        setActiveView("not-found");
        setSelectedNovelId("");
        setSelectedChapterId("");
        setSelectedAuthorName("");
        setProfileTab("overview");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openNotificationLink = React.useCallback((rawLink: unknown) => {
    const link = String(rawLink || "").trim();
    if (!link || typeof window === "undefined") return;

    try {
      const target = new URL(link, window.location.origin);
      if (target.origin !== window.location.origin) return;
      const targetPathname = canonicalNotificationPath(target.pathname);
      const routeState = parseRouteNavigationState(targetPathname, target.search);
      if (!routeState) return;

      setActiveView(routeState.activeView);
      setSelectedNovelId(routeState.selectedNovelId || "");
      setSelectedChapterId(routeState.selectedChapterId || "");
      setSelectedAuthorName(routeState.selectedAuthorName || "");
      setProfileTab(routeState.profileTab || "overview");
      setNotificationOpen(false);

      // Preserve notification-specific targets such as ?review=<id> and
      // ?session=<id>. The normal navigation synchronizer will subsequently
      // keep the canonical application route in step with the selected view.
      window.history.pushState(null, "", targetPathname + target.search + target.hash);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // Ignore malformed or unsupported notification links.
    }
  }, []);

  useEffect(() => {
    if (authToken) {
      const socket = initSocket(authToken);
      socket.on("receive_direct_message", (msg) => {
        setEmails((prev) => [msg, ...prev]);
        setNotifications((prev) => [{
          id: "dm-" + Date.now(),
          title: "💬 پیام مستقیم جدید",
          text: `پیامی از ${msg.sender} دریافت کردید: ${msg.subject}`,
          time: "همین حالا",
          read: false
        }, ...prev]);
      });
      // Realtime social notifications (comments, reviews, likes...). A
      // low-frequency poll remains only as a safety net for missed deliveries.
      socket.on("notification_new", (payload: any) => {
        if (!payload || !payload.id) return;
        setNotifications((prev) => {
          if (prev.some((item: any) => item.id === payload.id)) return prev;
          return [{
            id: String(payload.id),
            title: String(payload.title || "اعلان جدید"),
            text: String(payload.text || ""),
            time: "همین حالا",
            type: String(payload.type || "system"),
            link: String(payload.link || ""),
            read: false,
          }, ...prev];
        });
      });
      return () => {
        socket.off("receive_direct_message");
        socket.off("notification_new");
        disconnectSocket();
      };
    } else {
      disconnectSocket();
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !currentUser) {
      notificationIdsRef.current = null;
      seenAchievementNotificationIdsRef.current = new Set();
      setAchievementToast(null);
      return;
    }
    notificationIdsRef.current = null;
    seenAchievementNotificationIdsRef.current = readSeenAchievementNotificationIds(String(currentUser.id));
    let active = true;
    let hideTimer: number | undefined;

    const playAchievementSound = () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const context = new AudioContextClass();
        const now = context.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = index === 3 ? "sine" : "triangle";
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, now + index * 0.11);
          gain.gain.linearRampToValueAtTime(0.1, now + index * 0.11 + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.11 + 0.55);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(now + index * 0.11);
          oscillator.stop(now + index * 0.11 + 0.6);
        });
        window.setTimeout(() => context.close().catch(() => {}), 1300);
      } catch {}
    };

    const refresh = async () => {
      let fresh: any[];
      try {
        fresh = await api.getNotifications(authToken);
      } catch (error) {
        console.warn("Notification refresh failed; preserving the current notification baseline.", error);
        return;
      }
      if (!active) return;
      const knownNotificationIds = notificationIdsRef.current;
      const nextIds = new Set<string>(fresh.map((item: any) => item.id));
      const shouldRevalidateNovels = hasNovelModerationUpdate(fresh, knownNotificationIds);
      const unlocked = findNewAchievementNotification(
        fresh,
        knownNotificationIds,
        seenAchievementNotificationIdsRef.current,
        achievementToastSessionStartedAtRef.current,
      );
      const achievementIds = fresh
        .filter((item: any) => item.type === "achievement")
        .map((item: any) => String(item.id || ""))
        .filter(Boolean);
      achievementIds.forEach((id) => seenAchievementNotificationIdsRef.current.add(id));
      rememberAchievementNotificationIds(
        String(currentUser.id),
        seenAchievementNotificationIdsRef.current,
      );
      if (unlocked) {
        setAchievementToast(unlocked);
        playAchievementSound();
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => setAchievementToast(null), 10000);
      }
      notificationIdsRef.current = nextIds;
      // Polling should not invalidate the entire application tree when the
      // server returned the same notification snapshot. This is particularly
      // important in the chapter reader, where browser translation tools own
      // temporary mutations inside otherwise-static text nodes.
      setNotifications((current) => haveSameNotificationSnapshot(current, fresh) ? current : fresh);
      if (shouldRevalidateNovels) {
        void api.getNovels().then((freshNovels) => {
          if (active && freshNovels.length > 0) setNovels(freshNovels.filter(Boolean));
        }).catch((error) => {
          console.warn("Novel status refresh failed after moderation notification.", error);
        });
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [authToken, currentUser?.id]);

  // Render the application shell immediately and hydrate independent data in
  // parallel. None of these optional network requests should hold the visitor
  // behind a full-screen loading gate.
  useEffect(() => {
    let active = true;

    void api.getMe(api.getToken()).then((authData) => {
      if (!active) return;
      if (authData?.success && authData.user) {
        if (authData.csrfToken) {
          api.setToken(authData.csrfToken);
          setAuthToken(authData.csrfToken);
        }
        setCurrentUser(authData.user);
        setUserRole(getEffectiveUserRole(authData.user));
        setUserLevelState({ level: authData.user.level || 1, xp: authData.user.xp || 0 });
        if (authData.userData) {
          if (authData.userData.readingProgress) setReadingProgress(authData.userData.readingProgress);
          if (authData.userData.bookmarkedIds) setBookmarkedIds(authData.userData.bookmarkedIds);
          if (authData.userData.notifications?.length) setNotifications(authData.userData.notifications);
          if (authData.userData.emails?.length) setEmails(authData.userData.emails);
          if (authData.userData.myComments?.length) setMyComments(authData.userData.myComments);
        }
        // Social data is private and irrelevant to signed-out visitors. Fetch
        // it only after a session is confirmed, without delaying first paint.
        void api.getSocial().then((socialResult) => {
          if (!active) return;
          setFollowers(socialResult.followers || []);
          setFollowing(socialResult.following || []);
          setBlockedUsers(socialResult.blockedUsers || []);
        }).catch((error) => console.warn("Failed to fetch social data:", error));
      } else if (authData?.unauthorized) {
        setAuthToken(null);
        setCurrentUser(null);
        setBookmarkedIds([]);
      }
    }).catch((error) => console.error("Failed to authenticate user:", error));

    void api.getNovels().then((fetchedNovels) => {
      if (active) React.startTransition(() => setNovels(fetchedNovels.filter(Boolean)));
    }).catch((error) => console.error("Failed to fetch novels:", error));

    void api.getSettings().then((settingsResult) => {
      if (!active) return;
      setClaimedAchievements(settingsResult.claimedAchievements || []);
      if (settingsResult.systemSettings) updateDynamicCategories(settingsResult.systemSettings);
      setSystemSettings(settingsResult.systemSettings || {
        maintenanceMode: false,
        announcement: "به سیستم‌های رپتوک خوش آمدید!",
        allowRegistration: true
      });
      // Contest data affects one badge only and is deliberately non-critical.
      void api.getActiveContest().then((contest) => {
        if (active && contest) {
          setSystemSettings((previous: any) => ({
            ...previous,
            activeContest: contest,
            activeContestsCount: Math.max(1, previous?.activeContestsCount || 0)
          }));
        }
      }).catch((error) => console.warn("Failed to fetch active contest:", error));
    }).catch((error) => console.error("Failed to fetch settings:", error));

    return () => { active = false; };
  }, []);

  // A lightweight progress-only refresh keeps an already-open desktop tab in
  // sync after the same account reads on another device. Newer local updates
  // win while their final keepalive request is still reaching the server.
  useEffect(() => {
    if (!authToken || !currentUser?.id) return;
    let active = true;
    let lastRefreshAt = 0;
    const refreshProgress = async () => {
      if (Date.now() - lastRefreshAt < 5000) return;
      lastRefreshAt = Date.now();
      try {
        const remoteProgress = await api.getReadingProgress(authToken);
        if (active) setReadingProgress((localProgress) => mergeReadingProgressSnapshots(localProgress, remoteProgress));
      } catch {}
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshProgress();
    };
    void refreshProgress();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [authToken, currentUser?.id]);

  // Full-Stack and Administration Action callbacks
  const handleClaimAchievement = (id: string, xpReward: number) => {
    api.claimAchievement(id).then((claimedList) => {
      // Re-fetch accurate database XP and Level stats
      if (authToken) {
        api.getMe(authToken).then(authData => {
           if (authData && authData.user) {
             const prevLevel = userLevelState.level;
             setUserLevelState({ level: authData.user.level || 1, xp: authData.user.xp || 0 });
             setCurrentUser(authData.user);
             if (authData.userData && authData.userData.bookmarkedIds) {
                 setClaimedAchievements(authData.userData.claimedAchievements || claimedList); // keep fallback compatible
             }
             if (authData.user.level > prevLevel) {
                  const newNotif = {
                   id: "lvl-up-" + Date.now(),
                   title: "✨ ارتقای کاتب اعظم!",
                   text: `ارتقا یافتید! اکنون شما «کاتب اعظم» در سطح ${authData.user.level} هستید. مزایای جدید باز شد!`,
                   time: "همین حالا",
                   read: false
                 };
                 setNotifications(prevNotifs => [newNotif, ...prevNotifs]);
             }
           }
        });
      } else {
        setClaimedAchievements(claimedList);
      }
    });
  };

  const handleToggleFollow = async (id: string, state: boolean, username?: string) => {
    const isFollower = followers.some(f => f.id === id);
    const type = isFollower ? "follower" : "following";
    const result = await api.saveSocialRelation(id, type, state, username);
    if (!result) throw new Error("درخواست دنبال‌کردن ناموفق بود");
    setFollowers(result.followers || []);
    setFollowing(result.following || []);
    return result;
  };

  const handleToggleBlockUser = (username: string, block: boolean) => {
    api.saveBlockedUsers(username, block).then((updatedList) => {
      setBlockedUsers(updatedList || []);
    });
  };

  const handleAuthSuccess = (token: string, user: any) => {
    const requestId = ++authHydrationRequestRef.current;
    const isAccountSwitch = String(currentUser?.id || "") !== String(user?.id || "");
    const publicIdentityChanged = !isAccountSwitch
      && String(currentUser?.id || "") === String(user?.id || "")
      && (currentUser?.username !== user?.username
        || currentUser?.nickname !== user?.nickname
        || currentUser?.avatar !== user?.avatar);
    if (isAccountSwitch) {
      // Private account state must never survive an account change while the
      // new session is being hydrated.
      setBookmarkedIds([]);
      setReadingProgress([]);
      setMyComments([]);
    }
    setAuthToken(token);
    setCurrentUser(user);
    setUserRole(getEffectiveUserRole(user));
    setUserLevelState({ level: user.level || 1, xp: user.xp || 0 });

    if (publicIdentityChanged) {
      const userId = String(user.id);
      const displayName = user.nickname || user.username || "خواننده";
      // Update the visible library immediately, then rehydrate it from the
      // server so review cards never retain a pre-change username snapshot.
      setNovels((items) => items.map((novel) => ({
        ...novel,
        reviews: (novel.reviews || []).map((review) => String(review.userId || "") === userId
          ? { ...review, username: user.username, displayName, avatar: user.avatar || "" }
          : review),
      })));
      void api.getNovels().then((freshNovels) => {
        if (freshNovels.length > 0) setNovels(freshNovels.filter(Boolean));
      }).catch(() => {});
    }

    const newNotif = {
      id: "auth-success-" + Date.now(),
      title: `خوش آمدی، ${user.username}!`,
      text: `شما با موفقیت وارد سایت شدید`,
      time: "همین حالا",
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);

    // UserProfile owns additional login/2FA entry points. Always hydrate those
    // sessions here so they cannot inherit the preceding account's library.
    if (token && isAccountSwitch) {
      api.getMe(token).then((authData) => {
        if (requestId !== authHydrationRequestRef.current || !authData?.success || !authData.user) return;
        setCurrentUser(authData.user);
        setUserRole(getEffectiveUserRole(authData.user));
        setUserLevelState({ level: authData.user.level || 1, xp: authData.user.xp || 0 });
        setReadingProgress(authData.userData?.readingProgress || []);
        setBookmarkedIds(authData.userData?.bookmarkedIds || []);
        setMyComments(authData.userData?.myComments || []);
      }).catch(() => {
        if (requestId === authHydrationRequestRef.current) setBookmarkedIds([]);
      });
    }
  };

  const handleLogout = async () => {
    ++authHydrationRequestRef.current;
    try {
       if (authToken) await disablePushNotifications(authToken).catch(() => {});
       const response = await fetch("/api/auth/logout", { 
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            ...(authToken && { "X-CSRF-Token": authToken }),
            ...(authToken && {})
         },
         credentials: "same-origin"
       });
       if (!response.ok) {
         setNotifications((previous) => [{
           id: "auth-logout-error-" + Date.now(),
           title: "خروج انجام نشد",
           text: "نشست روی سرور حذف نشد؛ دوباره تلاش کنید.",
           time: "همین حالا",
           read: false
         }, ...previous]);
         return;
       }
    } catch {
      return;
    }

    api.clearToken();
    setAuthToken(null);
    setCurrentUser(null);
    setBookmarkedIds([]);
    setReadingProgress([]);
    setUserRole("writer");
    setUserLevelState({ level: 1, xp: 0 });
    setActiveView("dashboard");

    const newNotif = {
      id: "auth-logout-" + Date.now(),
      title: "🚪 خارج شدید",
      text: "نشست شما با موفقیت پایان یافت و اطلاعات قفل شد.",
      time: "همین حالا",
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  // Handle Log-in or Registration Submission via PostgreSQL-backed API
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignup) {
      const errors = getRegistrationErrors({ nickname: authNickname, username: authUsername, email: authEmail, phone: authPhone, password: authPassword, repeatPassword: authRepeatPassword, acceptedRules });
      if (errors.length) {
        setAuthError(errors.join(" "));
        return;
      }
    } else if (!authUsername.trim() || !authPassword) {
      setAuthError(!authUsername.trim() ? "ورود: نام کاربری، ایمیل یا شماره تلفن خود را وارد کنید." : "رمز عبور: این فیلد الزامی است.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");

    try {
      if (isSignup) {
        // Register brand new user online with database
        const normalizedPhone = normalizeIranianMobile(authPhone);
        const result = await api.register(authUsername.trim(), authPassword.trim(), authNickname.trim(), authEmail.trim(), normalizedPhone);
        if (result.success && result.user) {
          const token = result.token || result.csrfToken || api.getToken() || "";
          setAuthToken(token);
          const fullData = token ? await api.getMe(token) : null;
          const resolvedUser = fullData?.user || result.user;
          setCurrentUser(resolvedUser);
          setUserRole(getEffectiveUserRole(fullData?.user || result.user));
          setUserLevelState({ level: resolvedUser.level || 1, xp: resolvedUser.xp || 0 });
          if (fullData && fullData.userData) {
            setReadingProgress(fullData.userData.readingProgress || []);
            setBookmarkedIds(fullData.userData.bookmarkedIds || []);
            setNotifications(fullData.userData.notifications || []);
            setEmails(fullData.userData.emails || []);
            setMyComments(fullData.userData.myComments || []);
          }
          
          setNotifications(prev => [{
            id: "auth-" + Date.now(),
            title: "🛡️ نویسنده ثبت‌نام شد",
            text: `خوش آمدید! حساب شما به‌عنوان ${result.user.role.toUpperCase()} مجاز شد.`,
            time: "همین حالا",
            read: false
          }, ...prev]);

          if (result.emailVerificationRequired) {
            setVerificationMessage(
              result.verificationEmailSent === false
                ? "حساب ساخته شد. ایمیل تأیید ارسال نشده است؛ از دوباره‌ارسال استفاده کنید یا با پشتیبانی تماس بگیرید."
                : "کدی برای تأیید به ایمیل شما ارسال شد."
            );
          }
          setShowAuthModal(false);
          setActiveView("profile");
        } else {
          setAuthError(result.error || "نام کاربری قبلاً گرفته شده یا ثبت‌نام در پایگاه داده ناموفق بود.");
        }
      } else {
        // Log in with database credentials
        setBookmarkedIds([]);
        const result = await api.login(authUsername.trim(), authPassword.trim());
        if (result.success && result.user) {
          const token = result.token || result.csrfToken || api.getToken() || "";
          setAuthToken(token);
          const fullData = token ? await api.getMe(token) : null;
          const resolvedUser = fullData?.user || result.user;
          setCurrentUser(resolvedUser);
          setUserRole(getEffectiveUserRole(fullData?.user || result.user));
          setUserLevelState({ level: resolvedUser.level || 1, xp: resolvedUser.xp || 0 });
          if (fullData && fullData.userData) {
            setReadingProgress(fullData.userData.readingProgress || []);
            setBookmarkedIds(fullData.userData.bookmarkedIds || []);
            setNotifications(fullData.userData.notifications || []);
            setEmails(fullData.userData.emails || []);
            setMyComments(fullData.userData.myComments || []);
          }
          
          setNotifications(prev => [{
            id: "auth-" + Date.now(),
            title: "🛡️ خوش برگشتی",
            text: `اعتبارنامه تأیید شد! به‌عنوان ${result.user.username} (${result.user.role.toUpperCase()}) وارد شدید.`,
            time: "همین حالا",
            read: false
          }, ...prev]);

          setShowAuthModal(false);
          setActiveView("profile");
        } else {
          setAuthError(result.error || "اعتبارنامه مطابقت ندارد. آیا اطلاعات را درست وارد کرده‌اید؟");
        }
      }
    } catch (err) {
      setAuthError("برقراری ارتباط با سرور ناموفق بود.");
    } finally {
      setAuthLoading(false);
    }
  };

  const openPasswordReset = () => {
    setShowPasswordReset(true);
    setIsSignup(false);
    setAuthError("");
    setPasswordResetMessage("");
    setPasswordResetStep("request");
    if (authUsername.includes("@")) setPasswordResetEmail(authUsername.trim());
  };

  const closePasswordReset = () => {
    setShowPasswordReset(false);
    setPasswordResetStep("request");
    setPasswordResetCode("");
    setPasswordResetNewPassword("");
    setPasswordResetRepeatPassword("");
    setPasswordResetMessage("");
    setAuthError("");
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setPasswordResetMessage("");

    if (!passwordResetEmail.trim()) {
      setAuthError("ایمیل مرتبط با حساب خود را وارد کنید.");
      return;
    }

    if (passwordResetStep === "confirm") {
      if (!/^\d{6}$/.test(passwordResetCode.trim())) {
        setAuthError("کد بازیابی 6 رقمی را وارد کنید.");
        return;
      }
      if (passwordResetNewPassword.length < 12 || !/[a-z]/.test(passwordResetNewPassword) || !/[A-Z]/.test(passwordResetNewPassword) || !/[0-9]/.test(passwordResetNewPassword) || !/[^a-zA-Z0-9]/.test(passwordResetNewPassword)) {
        setAuthError("رمز عبور باید حداقل 12 نویسه باشد و شامل حرف بزرگ، حرف کوچک، عدد و نویسهٔ ویژه باشد.");
        return;
      }
      if (passwordResetNewPassword !== passwordResetRepeatPassword) {
        setAuthError("رمزهای عبور مطابقت ندارند.");
        return;
      }
    }

    setAuthLoading(true);
    try {
      if (passwordResetStep === "request") {
        const result = await api.requestPasswordReset(passwordResetEmail.trim());
        if (result.success) {
          setPasswordResetMessage(result.message || "اگر حسابی با آن ایمیل وجود داشته باشد، کد بازیابی رمز عبور ارسال شده است.");
          setPasswordResetStep("confirm");
        } else {
          setAuthError(result.error || "شروع بازیابی رمز عبور ممکن نشد. لطفاً بعداً دوباره تلاش کنید.");
        }
      } else {
        const result = await api.confirmPasswordReset(passwordResetEmail.trim(), passwordResetCode.trim(), passwordResetNewPassword);
        if (result.success) {
          setPasswordResetMessage(result.message || "رمز عبور شما بازنشانی شد. لطفاً با رمز عبور جدید وارد شوید.");
          setAuthUsername(passwordResetEmail.trim());
          setAuthPassword("");
          setPasswordResetCode("");
          setPasswordResetNewPassword("");
          setPasswordResetRepeatPassword("");
          setTimeout(() => {
            closePasswordReset();
          }, 1200);
        } else {
          setAuthError(result.error || "بازیابی رمز عبور ناموفق بود. لطفاً کد جدید درخواست کنید.");
        }
      }
    } catch {
      setAuthError("بازیابی رمز عبور ناموفق بود؛ سرور در دسترس نیست.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaveSettings = async (settings: any) => {
    await api.saveSystemSettings(settings);
    setSystemSettings((prev) => ({ ...prev, ...settings }));
    updateDynamicCategories(settings);
  };

  const handleApproveNovel = (id: string) => {
    const updated = novels.map((n) => {
      if (n.id === id) {
        return { ...n, isUserCreated: false, approvalStatus: "approved" as const, editorNote: "" }; 
      }
      return n;
    });
    setNovels(updated);
    if (authToken) {
      api.moderateNovel(authToken, id, "approved", "برای کتابخانهٔ عمومی تأیید شد");
    }
    setNotifications(prev => [
      {
        id: "appr-" + Date.now(),
        title: "✓ سری رمان تأیید شد",
        text: `سری انتخاب‌شده تأیید شد و با موفقیت در کتابخانه ثبت گردید.`,
        time: "همین حالا",
        read: false
      },
      ...prev
    ]);
  };

  const handleRejectNovel = (id: string, reason: string) => {
    // Keep it in array but update status
    const updated = novels.map(n => n.id === id ? { ...n, approvalStatus: "rejected" as const, editorNote: reason } : n);
    setNovels(updated);
    if (authToken) {
      api.moderateNovel(authToken, id, "rejected", reason);
    }
    setNotifications(prev => [
      {
        id: "rej-" + Date.now(),
        title: "☒ رمان پیش‌نویس رد شد",
        text: `دلیل: ${reason}`,
        time: "همین حالا",
        read: false
      },
      ...prev
    ]);
  };

  const handleDeleteNovel = async (id: string) => {
    const previousNovels = novels;
    const updated = novels.filter((n) => n.id !== id);
    setNovels(updated);
    if (selectedNovelId === id) {
      setSelectedNovelId("");
      setSelectedChapterId("");
      setActiveView("dashboard");
    }
    const result = await api.deleteNovel(id);
    if (!result.success) {
      setNovels(previousNovels);
      throw new Error(result.error || "حذف رمان ناموفق بود.");
    }
  };



  // Global search keyboard shortcuts (Ctrl+K and Ctrl+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K" || e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchModalOpen(true);
      }
      if (e.key === "Escape") {
        setSearchModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close notifications or inbox dropdowns when clicking anywhere outside of them on the screen
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#notification-container") && !target.closest("#inbox-container")) {
        setNotificationOpen(false);
        setInboxOpen(false);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  const INITIAL_ROLES_DEFAULT = () => {
    return [];
  };

  // Sync utilities with storage
  const saveNovelsToStorage = (updatedNovels: Novel[]) => {
    setNovels(updatedNovels);
    // Never mock to localStorage, API sync handled externally per-item
  };

  const handleToggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    writeBrowserPreference("reptoc-theme", nextTheme);
  };

  const handleThemeModeChange = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    writeBrowserPreference("reptoc-theme", nextTheme);
  };

  const handleAccentThemeChange = (nextAccent: AccentThemeId) => {
    const normalized = normalizeAccentTheme(nextAccent);
    setAccentTheme(normalized);
    writeBrowserPreference("reptoc-accent-theme", normalized);
  };

  const handleCustomThemeChange = (colors: CustomThemeColors) => {
    const normalized = normalizeCustomTheme(colors);
    setCustomThemeColors(normalized);
    setAccentTheme("custom");
    writeBrowserPreference("reptoc-custom-theme", JSON.stringify(normalized));
    writeBrowserPreference("reptoc-accent-theme", "custom");
  };

  const handleAppearanceChange = (settings: AppearanceSettings) => {
    const normalized = normalizeAppearance(settings);
    setAppearance(normalized);
    writeBrowserPreference("reptoc-appearance", JSON.stringify(normalized));
  };

  const handleResetAppearance = () => {
    setTheme("dark");
    setAccentTheme("orange");
    setCustomThemeColors(DEFAULT_CUSTOM_THEME);
    setAppearance(DEFAULT_APPEARANCE);
    writeBrowserPreference("reptoc-theme", "dark");
    writeBrowserPreference("reptoc-accent-theme", "orange");
    writeBrowserPreference("reptoc-custom-theme", JSON.stringify(DEFAULT_CUSTOM_THEME));
    writeBrowserPreference("reptoc-appearance", JSON.stringify(DEFAULT_APPEARANCE));
  };

  useEffect(() => {
    const isDark = theme === "dark";
    const cssVariables = {
      ...accentThemeCssVariables(accentTheme, customThemeColors),
      ...appearanceCssVariables(appearance, theme),
    };
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accentTheme = accentTheme;
    document.documentElement.dataset.uiMotion = appearance.motion;
    document.documentElement.dataset.uiContrast = appearance.contrast;
    document.documentElement.dataset.uiRadius = appearance.radius;
    document.documentElement.dataset.uiSurfaces = appearance.customSurfaces ? "custom" : "preset";
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.fontSize = `${16 * appearance.fontScale / 100}px`;
    Object.entries(cssVariables).forEach(([property, value]) => {
      document.documentElement.style.setProperty(property, value);
    });
  }, [accentTheme, appearance, customThemeColors, theme]);

  // Bookmark Toggle Callback
  const handleBookmarkNovel = async (novelId: string, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    if (!authToken) {
      setShowAuthModal(true);
      return;
    }
    const previousBookmarkedIds = bookmarkedIds;
    const previousNovels = novels;
    let updated: string[];
    const isBookmark = !bookmarkedIds.includes(novelId);
    if (!isBookmark) {
      updated = bookmarkedIds.filter((id) => id !== novelId);
    } else {
      updated = [...bookmarkedIds, novelId];
    }
    setBookmarkedIds(updated);
    setNovels((prevNovels) => prevNovels.map((novel) => (
      novel.id === novelId
        ? { ...novel, bookmarksCount: Math.max(0, Number(novel.bookmarksCount || 0) + (isBookmark ? 1 : -1)) }
        : novel
    )));

    try {
      const serverBookmarks = await api.toggleBookmark(authToken, novelId, isBookmark);
      if (serverBookmarks) {
        setBookmarkedIds(serverBookmarks);
      } else {
        setBookmarkedIds(previousBookmarkedIds);
        setNovels(previousNovels);
        setNotifications(prev => [{
          id: "bookmark-failed-" + Date.now(),
          title: "نشانک ذخیره نشد",
          text: "به‌روزرسانی کتابخانه ناموفق بود. لطفاً دوباره تلاش کنید.",
          time: "همین حالا",
          read: false
        }, ...prev]);
      }
    } catch {
      setBookmarkedIds(previousBookmarkedIds);
      setNovels(previousNovels);
    }
  };

  const updateNovelCounts = React.useCallback((novelId: string, patch: Partial<Pick<Novel, "viewsCount" | "likesCount" | "bookmarksCount">>) => {
    setNovels((prevNovels) => prevNovels.map((novel) => (
      novel.id === novelId ? { ...novel, ...patch } : novel
    )));
  }, []);

  const handleChapterLikeChange = React.useCallback((
    novelId: string,
    chapterId: string,
    liked: boolean,
    chapterLikesCount: number,
    novelLikesCount: number,
  ) => {
    setNovels((prevNovels) => {
      let changed = false;
      const nextNovels = prevNovels.map((novel) => {
        if (novel.id !== novelId) return novel;
        const nextNovel = applyChapterLikeToNovel(novel, chapterId, liked, chapterLikesCount, novelLikesCount);
        if (nextNovel !== novel) changed = true;
        return nextNovel;
      });
      return changed ? nextNovels : prevNovels;
    });
  }, []);

  useEffect(() => {
    if (loadingInitial || activeView !== "novel-details" || !selectedNovelId) return;
    const viewerKey = currentUser?.id || currentUser?.username || "anon";
    const countedKey = `${viewerKey}:${selectedNovelId}`;
    if (countedNovelViewsRef.current.has(countedKey)) return;
    countedNovelViewsRef.current.add(countedKey);

    api.logAnalyticsEvent(api.getToken(), selectedNovelId, "view", { source: "novel_details" })
      .then((result) => {
        if (!result?.countedView) return;
        setNovels((prevNovels) => prevNovels.map((novel) => (
          novel.id === selectedNovelId
            ? { ...novel, viewsCount: Number(novel.viewsCount || 0) + 1 }
            : novel
        )));
      })
      .catch(() => {});
  }, [activeView, selectedNovelId, loadingInitial, currentUser?.id, currentUser?.username]);

  const renderUserAvatar = (className: string, textClassName: string) => {
    const avatarUrl = getSafeAvatarUrl(currentUser?.avatar);
    if (avatarUrl) {
      return (
        <SafeImage
          src={avatarUrl}
          alt={currentUser.username || "آواتار کاربر"}
          className={`${className} object-cover bg-slate-900`}
        />
      );
    }
    return (
      <div className={`${className} bg-gradient-to-br from-violet-500 to-purple-600 text-white font-mono font-black flex items-center justify-center ${textClassName} shadow`}>
        {currentUser?.username?.substring(0, 2).toUpperCase()}
      </div>
    );
  };

  // Reading Scroll / Chapter Progress updater
  const handleUpdateScroll = React.useCallback((chapterId: string, percent: number, options?: { forceSync?: boolean; keepalive?: boolean }) => {
    if (!selectedNovelId) return;
    const targetNovel = novels.find((n) => n.id === selectedNovelId);
    const targetChapter = targetNovel?.chapters?.find((c) => c.id === chapterId);

    if (!targetNovel || !targetChapter) return;

    const normalizedPercent = Math.max(0, Math.min(100, Math.round(Number(percent) * 10) / 10));
    const progressKey = `${selectedNovelId}:${chapterId}`;
    const lastRenderedPercent = renderedProgressRef.current[progressKey];
    if (shouldPublishReadingProgress(lastRenderedPercent, normalizedPercent)) {
      renderedProgressRef.current[progressKey] = normalizedPercent;
      setReadingProgress((currentProgress) => {
        const existingProgress = [...currentProgress];
        const matchIdx = existingProgress.findIndex((item) => item.novelId === selectedNovelId);
        const updatedRecord: ReadingProgress = {
          novelId: selectedNovelId,
          novelTitle: targetNovel.title,
          novelCover: targetNovel.coverUrl || "",
          novelGenre: targetNovel.genre,
          novelAuthor: targetNovel.author,
          chapterId,
          chapterTitle: targetChapter.title,
          chapterNumber: targetChapter.chapterNumber || 1,
          scrollPercent: normalizedPercent,
          updatedAt: new Date().toISOString(),
        };
        if (matchIdx >= 0) existingProgress[matchIdx] = updatedRecord;
        else existingProgress.unshift(updatedRecord);
        return existingProgress;
      });
    }

    if (authToken) {
      const lastSync = progressSyncRef.current[progressKey];
      const shouldSync = options?.forceSync || !lastSync || Date.now() - lastSync.at > 15000 || Math.abs(normalizedPercent - lastSync.percent) >= 10 || normalizedPercent >= 95;
      if (!shouldSync) return;
      progressSyncRef.current[progressKey] = { at: Date.now(), percent: normalizedPercent };
      void api.syncReadingProgress(authToken, {
        novelId: selectedNovelId,
        novelTitle: targetNovel.title,
        chapterId: chapterId,
        chapterNumber: targetChapter.chapterNumber || 1,
        scrollPercentage: normalizedPercent,
        source: "reader"
      }, { keepalive: options?.keepalive }).catch(() => {
        const lastSync = progressSyncRef.current[progressKey];
        if (lastSync?.percent === normalizedPercent) delete progressSyncRef.current[progressKey];
      });
    }
  }, [authToken, novels, selectedNovelId]);

  // Review Appending Hook - Database backed
  const refreshNovels = async () => {
    try {
      const fetchedNovels = await api.getNovels();
      const cleanNovels = fetchedNovels.filter((n) => n);
      setNovels(cleanNovels.length > 0 ? cleanNovels : []);
    } catch (err) {
      console.error("Failed to refresh novels library:", err);
    }
  };

  const refreshMe = async () => {
    if (authToken) {
      try {
        const authData = await api.getMe(authToken);
        if (authData && authData.success && authData.user) {
          setCurrentUser(authData.user);
          setUserRole(getEffectiveUserRole(authData.user));
          setUserLevelState({ level: authData.user.level || 1, xp: authData.user.xp || 0 });
          if (authData.userData) {
            if (authData.userData.readingProgress) setReadingProgress(authData.userData.readingProgress);
            if (authData.userData.bookmarkedIds) setBookmarkedIds(authData.userData.bookmarkedIds);
            if (authData.userData.notifications) setNotifications(authData.userData.notifications);
            if (authData.userData.emails) setEmails(authData.userData.emails);
            if (authData.userData.myComments) setMyComments(authData.userData.myComments);
          }
        }
      } catch (err) {
        console.error("Failed to refresh user profile data:", err);
      }
    }
  };

  const handleAddReview = async (novelId: string, review: Review) => {
    if (authToken) {
      try {
        const res = await api.addReview(novelId, review);
        if (res && res.success) {
          await refreshNovels();
          await refreshMe();
        }
      } catch (err) {
        console.error("Failed to append review:", err);
      }
    }
  };

  // Vote Rating Hook - Database backed without faked review strings
  const handleRateNovel = async (novelId: string, rating: number, comment: string) => {
    if (authToken) {
      try {
        // Ratings can include a reader note, displayed with the rating everywhere reviews appear.
        const simpleRatingReview: Review = {
          id: "rating-rev-" + Date.now(),
          userId: currentUser?.id,
          username: currentUser ? currentUser.username : "خوانندهٔ تأییدشده",
          displayName: currentUser?.nickname || currentUser?.username || "خوانندهٔ تأییدشده",
          avatar: currentUser?.avatar || "",
          role: currentUser?.role || "reader",
          rating: rating,
          comment,
          createdAt: new Date().toISOString().split("T")[0],
        };
        const res = await api.addReview(novelId, simpleRatingReview);
        if (res && res.success) {
          await refreshNovels();
          await refreshMe();
        }
      } catch (err) {
        console.error("Failed to submit rating:", err);
      }
    }
  };

  // Add Newly Written Series
  const handleAddNewNovel = async (newNovel: Novel) => {
    if (!authToken) throw new Error("لطفاً پیش از ساخت رمان وب وارد شوید.");
    await api.saveNovel(newNovel);
    setNovels((prevNovels) => [newNovel, ...prevNovels.filter((novel) => novel.id !== newNovel.id)]);
    await refreshNovels();
  };

  // Create chapters inside active webnovel
  const handleUpdateNovelChapters = async (novelId: string, updatedChapters: Chapter[]) => {
    setNovels((prevNovels) => prevNovels.map((novel) => (
      novel.id === novelId ? { ...novel, chapters: updatedChapters } : novel
    )));
  };

  // General update for entire novel (metadata edits, characters, reviews)
  const handleUpdateNovel = async (updatedNovel: Novel) => {
    if (!authToken) throw new Error("لطفاً پیش از به‌روزرسانی جزئیات داستان وارد شوید.");
    await api.updateNovel(updatedNovel);
    const updatedNovels = novels.map((novel) => {
      if (novel.id === updatedNovel.id) {
        return updatedNovel;
      }
      return novel;
    });
    setNovels(updatedNovels);
    saveNovelsToStorage(updatedNovels);
    await refreshNovels();
  };

  const handleUpdateNovelCover = async (novelId: string, coverUrl: string) => {
    if (!authToken) throw new Error("لطفاً پیش از به‌روزرسانی جلد کتاب وارد شوید.");
    await api.updateNovelCover(novelId, coverUrl);
    setNovels((currentNovels) => currentNovels.map((novel) => (
      novel.id === novelId ? { ...novel, cover: coverUrl, coverUrl } : novel
    )));
  };

  // Navigate to standard index components
  const activeNovel = novels.find((n) => n.id === selectedNovelId);
  const getReadableChapters = React.useCallback((novel?: Novel | null) => {
    return [...(novel?.chapters || [])]
      .filter((chapter) => String((chapter as any).status || "Published").toLowerCase() === "published")
      .sort((a, b) => Number(a.chapterNumber || 0) - Number(b.chapterNumber || 0));
  }, []);
  const openNovelReader = React.useCallback(async (novelId: string, preferredChapterId?: string) => {
    let targetNovel = novels.find((novel) => novel.id === novelId) || null;
    const preferredIsLoaded = preferredChapterId
      ? getReadableChapters(targetNovel).some((chapter) => chapter.id === preferredChapterId)
      : true;
    if (!targetNovel || getReadableChapters(targetNovel).length === 0 || !preferredIsLoaded) {
      const loadedNovel = await api.getNovel(novelId).catch(() => null);
      if (loadedNovel) {
        targetNovel = loadedNovel;
        setNovels((prevNovels) => {
          const exists = prevNovels.some((novel) => novel.id === loadedNovel.id);
          return exists
            ? prevNovels.map((novel) => novel.id === loadedNovel.id ? loadedNovel : novel)
            : [...prevNovels, loadedNovel];
        });
      }
    }
    const chapters = getReadableChapters(targetNovel);
    const targetChapter = preferredChapterId
      ? chapters.find((chapter) => chapter.id === preferredChapterId)
      : chapters[0];
    setSelectedNovelId(novelId);
    if (targetChapter) {
      setSelectedChapterId(targetChapter.id);
      setActiveView("reader");
    } else {
      setSelectedChapterId(preferredChapterId || "");
      setActiveView("novel-details");
    }
  }, [getReadableChapters, novels]);
  const activeChapter = activeNovel?.chapters?.find((c) => c.id === selectedChapterId) || getReadableChapters(activeNovel)[0];
  const closeReader = React.useCallback(() => setActiveView("novel-details"), []);
  const navigateReaderChapter = React.useCallback((chapterId: string) => setSelectedChapterId(chapterId), []);
  const selectReaderUser = React.useCallback((username: string) => {
    setSelectedAuthorName(username);
    setActiveView("author-profile");
  }, []);

  useEffect(() => {
    const staticSeo: Partial<Record<AppView, [string, string]>> = {
      // The home page title is the bare brand: a tagline here would be
      // duplicated by the description meta tag right below it.
      dashboard: ["رپتوک", "رمان‌های وب اورجینال را کشف و بخوانید، نویسندگان را دنبال کنید و به جامعهٔ خوانندگان رپتوک بپیوندید."],
      ranking: ["رتبه‌بندی همهٔ رمان‌ها | رپتوک", "مرور همهٔ رمان‌های تأییدشدهٔ رپتوک بر اساس امتیاز و بازدید خوانندگان."],
      "event-status": ["رویداد بازدیدهای اوت 2026 | رپتوک", "جدول امتیازهای رویداد بازدیدهای اوت رپتوک را دنبال کنید و پربازدیدترین رمان‌های واجد شرایط اوت 2026 را ببینید."],
      notifications: ["اعلان‌ها | رپتوک", "همهٔ اعلان‌ها و به‌روزرسانی‌های حساب رپتوک شما در یک صفحه."],
      challenges: ["چالش‌های روزانه | رپتوک", "در چالش‌های ادامهٔ داستان و نام‌گذاری داستان از روی تصویر در رپتوک شرکت کنید."],
      offline: ["مطالعه آفلاین | رپتوک", "فصل‌های دانلودشدهٔ رپتوک را بدون اینترنت مطالعه کنید."],
      discover: ["کاوش رمان‌های وب | رپتوک", "در رپتوک رمان‌های وب اورجینال را بر اساس ژانر، امتیاز، محبوبیت و وضعیت مطالعه مرور کنید."],
      forums: ["انجمن خوانندگان و نویسندگان | رپتوک", "در گفتگوهای رپتوک دربارهٔ داستان‌های اورجینال، خواندن، نوشتن و رمان‌های وب شرکت کنید."],
      premium: ["پریمیوم رپتوک", "طرح‌های پریمیوم رپتوک و امکانات پیشرفتهٔ خواندن و نوشتن را بررسی کنید."],
      support: ["پشتیبانی | رپتوک", "برای حساب کاربری، مطالعه، انتشار یا تجربهٔ اجتماعی خود در رپتوک کمک بگیرید."],
      rules: ["قوانین انجمن | رپتوک", "قوانین انجمن و نویسندگان رپتوک را بخوانید."],
      "terms-of-service": ["شرایط خدمات | رپتوک", "شرایط استفاده از خدمات رپتوک را بخوانید."],
      "privacy-policy": ["سیاست حفظ حریم خصوصی | رپتوک", "سیاست حفظ حریم خصوصی رپتوک را بخوانید."],
      dmca: ["سیاست DMCA | رپتوک", "سیاست کپی‌رایت و DMCA رپتوک را بخوانید."],
      "contact-us": ["تماس با ما | رپتوک", "با تیم رپتوک در تماس باشید."],
      "about-us": ["دربارهٔ رپتوک", "با رپتوک آشنا شوید؛ جامعه‌ای برای رمان‌های وب اورجینال، خوانندگان و نویسندگان."],
      "not-found": ["صفحه پیدا نشد | رپتوک", "صفحهٔ درخواستی رپتوک پیدا نشد."],
    };
    const privateViews = new Set<AppView>(["writer", "worldbuilding", "profile", "authority-center", "editor-panel", "bookmarks", "not-found"]);
    const novelDescription = String(activeNovel?.description || "").replace(/\s+/g, " ").trim().slice(0, 160);
    let title = staticSeo[activeView]?.[0] || "رپتوک";
    let description = staticSeo[activeView]?.[1] || "خواندن رمان‌های وب اورجینال در رپتوک.";
    if (activeView === "novel-details" && activeNovel) {
      title = `${activeNovel.title} اثر ${activeNovel.author} | رپتوک`;
      description = novelDescription || `${activeNovel.title} اثر ${activeNovel.author} را در رپتوک بخوانید.`;
    } else if (activeView === "reader" && activeNovel && activeChapter) {
      title = `${activeChapter.title} — ${activeNovel.title} | رپتوک`;
      description = `${activeChapter.title} از ${activeNovel.title} اثر ${activeNovel.author} را در رپتوک بخوانید.`;
    } else if (activeView === "author-profile" && selectedAuthorName) {
      title = `${selectedAuthorName} — نویسنده در رپتوک`;
      description = `رمان‌های وب اورجینال و به‌روزرسانی‌های ${selectedAuthorName} را در رپتوک بخوانید.`;
    }

    const setMeta = (selector: string, attribute: "name" | "property", key: string, content: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
      }
      element.content = content;
    };
    // Titles may include user/admin-authored text. Normalize legacy brand
    // spellings in the browser tab and social metadata as well as in the body.
    title = normalizeBrandName(title);
    description = normalizeBrandName(description);
    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[name="robots"]', "name", "robots", privateViews.has(activeView) ? "noindex,nofollow" : "index,follow,max-image-preview:large");
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    let canonicalOrigin = window.location.origin;
    if (canonical?.href) {
      try {
        canonicalOrigin = new URL(canonical.href).origin;
      } catch {}
    }
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    const canonicalPath = window.location.pathname.replace(/\/+$/, "") || "/";
    const canonicalUrl = canonicalOrigin + canonicalPath;
    let socialImage = `${canonicalOrigin}/logo.png`;
    try {
      socialImage = new URL(activeNovel?.coverUrl || activeNovel?.cover || "/logo.png", `${canonicalOrigin}/`).href;
    } catch {}
    canonical.href = canonicalUrl;
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[property="og:type"]', "property", "og:type", activeView === "novel-details" || activeView === "reader" ? "book" : activeView === "author-profile" ? "profile" : "website");
    setMeta('meta[property="og:image"]', "property", "og:image", socialImage);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", socialImage);
  }, [activeView, activeNovel, activeChapter, selectedAuthorName]);
  const ownedNovels = React.useMemo(() => {
    if (!currentUser) return [];
    const userId = String(currentUser.id || "").trim();
    return novels.filter((novel) => String(novel.author_id || "").trim() === userId);
  }, [novels, currentUser]);

  useEffect(() => {
    if (!bookmarkedIds.length) return;
    const missingIds = bookmarkedIds.filter((id) => id && !novels.some((novel) => novel.id === id));
    if (missingIds.length === 0) return;

    let cancelled = false;
    Promise.all(missingIds.map((id) => api.getNovel(id).catch(() => null))).then((loadedNovels) => {
      if (cancelled) return;
      const cleanLoadedNovels = loadedNovels.filter((novel): novel is Novel => Boolean(novel));
      if (cleanLoadedNovels.length === 0) return;
      setNovels((prevNovels) => {
        const seen = new Set(prevNovels.map((novel) => novel.id));
        const additions = cleanLoadedNovels.filter((novel) => !seen.has(novel.id));
        return additions.length ? [...prevNovels, ...additions] : prevNovels;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [bookmarkedIds, novels]);

  // The catalogue feed (`/api/novels?view=catalog`) deliberately omits chapter
  // bodies so the homepage stays small. The writing workspace edits those
  // bodies, so an author arriving from the catalogue would otherwise open a
  // blank canvas and overwrite a real chapter with empty text. Hydrate every
  // owned novel with the full payload before the workspace can be used.
  useEffect(() => {
    if (loadingInitial || activeView !== "writer" || !currentUser) return;
    const pending = ownedNovels.filter((novel) => {
      if (hydratedNovelIdsRef.current.has(novel.id)) return false;
      return (novel as any).catalogueOnly === true || (novel.chapters || []).length === 0;
    });
    if (pending.length === 0) return;

    let cancelled = false;
    for (const novel of pending) hydratedNovelIdsRef.current.add(novel.id);
    Promise.all(pending.map((novel) => api.getNovel(novel.id).catch(() => {
      hydratedNovelIdsRef.current.delete(novel.id);
      return null;
    }))).then((loadedNovels) => {
      if (cancelled) return;
      const hydrated = loadedNovels.filter((novel): novel is Novel => Boolean(novel));
      if (hydrated.length === 0) return;
      const hydratedById = new Map(hydrated.map((novel) => [novel.id, novel] as const));
      setNovels((prevNovels) => prevNovels.map((novel) => hydratedById.get(novel.id) || novel));
    });

    return () => {
      cancelled = true;
    };
  }, [activeView, currentUser, loadingInitial, ownedNovels]);

  useEffect(() => {
    if (loadingInitial || !activeNovel || !["novel-details", "reader"].includes(activeView)) return;
    if ((activeNovel.chapters || []).length > 0 && !(activeNovel as any).catalogueOnly) return;
    if (hydratedNovelIdsRef.current.has(activeNovel.id)) return;
    hydratedNovelIdsRef.current.add(activeNovel.id);

    api.getNovel(activeNovel.id).then((loadedNovel) => {
      if (!loadedNovel) {
        hydratedNovelIdsRef.current.delete(activeNovel.id);
        return;
      }
      setNovels((prevNovels) => prevNovels.map((novel) => novel.id === loadedNovel.id ? loadedNovel : novel));
    }).catch(() => {
      hydratedNovelIdsRef.current.delete(activeNovel.id);
    });
  }, [activeNovel, activeView, loadingInitial]);

  /**
   * Route guard for the staff panels.
   *
   * The admin and editor panels are reachable by URL (/authority-center,
   * /editor-panel) and by a restored navigation state, so a reader who saved the
   * link — or who was demoted since their last visit — would otherwise land on a
   * panel that renders empty and floods the console with 403s. They are sent
   * home instead.
   *
   * This waits for `loadingInitial` because `userRole` is "writer" until
   * `api.getMe()` resolves; guarding earlier would bounce a genuine owner who
   * deep-linked to the panel. The server is still the real boundary — every
   * admin endpoint checks the role independently — this only keeps the UI honest.
   */
  useEffect(() => {
    if (loadingInitial) return;
    const requiredRoles: Partial<Record<AppView, UserRole[]>> = {
      "authority-center": ["publisher", "owner"],
      "editor-panel": ["editor", "publisher", "owner"],
    };
    const allowed = requiredRoles[activeView];
    if (!allowed) return;
    if (currentUser && allowed.includes(userRole)) return;
    setActiveView("dashboard");
  }, [activeView, currentUser, loadingInitial, userRole]);

  useEffect(() => {
    if (loadingInitial) return;
    if ((activeView === "novel-details" || activeView === "reader") && selectedNovelId && !activeNovel) {
      const fetchRouteNovel = async () => {
        const novel = await api.getNovel(selectedNovelId);
        if (novel) {
          setNovels((prevNovels) => {
            if (prevNovels.some((n) => n.id === novel.id)) return prevNovels;
            return [...prevNovels, novel];
          });
          return;
        }

        setSelectedNovelId("");
        setSelectedChapterId("");
        setActiveView("not-found");
      };

      fetchRouteNovel().catch((error) => {
        // Preserve the valid, self-canonical route during a temporary API
        // failure. A transient network problem is not evidence of a 404.
        console.error("Could not load routed novel:", error);
      });
      return;
    }
    if (activeView === "reader" && selectedChapterId && activeNovel && !activeChapter) {
      const fetchRouteChapter = async () => {
        const novel = await api.getNovel(selectedNovelId);
        if (novel) {
          setNovels((prevNovels) => prevNovels.map((item) => item.id === novel.id ? novel : item));
          if (novel.chapters?.some((chapter) => chapter.id === selectedChapterId)) return;
        }
        setSelectedChapterId("");
        setActiveView("not-found");
      };

      fetchRouteChapter().catch((error) => {
        console.error("Could not load routed chapter:", error);
      });
    }
  }, [loadingInitial, activeView, selectedNovelId, selectedChapterId, activeNovel, activeChapter]);

  // Resume readings
  const handleResumeReading = (progress: ReadingProgress) => {
    void openNovelReader(progress.novelId, progress.chapterId);
  };

  const activeTheme = CONTRAST_THEMES[theme];

  const handleVerifyEmailCode = async () => {
    if (!authToken || !verificationCode.trim()) return;
    const result = await api.verifyEmail(authToken, verificationCode.trim());
    if (result?.success) {
      setCurrentUser((prev: any) => prev ? { ...prev, email_verified: true } : prev);
      setVerificationCode("");
      setVerificationMessage("ایمیل با موفقیت تأیید شد.");
    } else {
      setVerificationMessage(result?.error || "تأیید ناموفق بود.");
    }
  };

  const handleResendVerificationCode = async () => {
    if (!authToken) return;
    const result = await api.resendVerification(authToken);
    setVerificationMessage(result?.success ? "کد تأیید جدید ارسال شد." : result?.error || "ارسال کد جدید ممکن نشد.");
  };

  useEffect(() => {
    let active = true;
    const query = globalSearchQuery.trim();
    if (!searchModalOpen || query.length < 2) {
      setGlobalSearchResults([]);
      return;
    }
    const localResults = searchNovelsLocal(novels.filter(isNovelApprovedForDiscovery), query, 80);
    setGlobalSearchResults(localResults);
    const timer = window.setTimeout(() => {
      api.searchNovels(query).then((results) => {
        if (!active) return;
        const merged = new Map<string, Novel>();
        [...(results || []), ...localResults].forEach((novel) => {
          if (novel?.id && isNovelApprovedForDiscovery(novel)) merged.set(novel.id, novel);
        });
        const ranked = searchNovelsLocal([...merged.values()], query, 80);
        setGlobalSearchResults(ranked.length > 0 ? ranked : (results || []));
      }).catch(() => {
        if (active) setGlobalSearchResults(localResults);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [globalSearchQuery, searchModalOpen, novels]);

  // Helper arrays for user details
  const visibleGlobalSearchResults = globalSearchQuery.trim().length >= 2 ? globalSearchResults : [];

  const activeLoginAlert = notifications.find((notification) =>
    notification.type === "login_alert" && !notification.read && !dismissedLoginAlerts.includes(notification.id)
  );
  const encodedLoginSessionId = activeLoginAlert?.link?.match(/[?&]session=([^&]+)/)?.[1] || "";
  const loginAlertSessionId = encodedLoginSessionId ? decodeURIComponent(encodedLoginSessionId) : "";
  const dismissLoginAlert = () => {
    if (!activeLoginAlert) return;
    setDismissedLoginAlerts((ids) => [...ids, activeLoginAlert.id]);
    setNotifications((items) => items.map((item) => item.id === activeLoginAlert.id ? { ...item, read: true } : item));
    if (authToken) api.readNotifications(authToken, activeLoginAlert.id);
  };
  const removeSuspiciousSession = async () => {
    if (!authToken || !loginAlertSessionId) return;
    const result = await api.deleteSession(authToken, loginAlertSessionId);
    if (result?.success) dismissLoginAlert();
  };

  return (
    <div
      data-app-theme={theme}
      data-accent-theme={accentTheme}
      data-ui-motion={appearance.motion}
      data-ui-contrast={appearance.contrast}
      data-ui-radius={appearance.radius}
      data-ui-surfaces={appearance.customSurfaces ? "custom" : "preset"}
      data-ui-book-mode={appearance.bookMode ? "true" : "false"}
      style={{ ...accentThemeCssVariables(accentTheme, customThemeColors), ...appearanceCssVariables(appearance, theme) } as React.CSSProperties}
      className={`reptoc-app min-h-screen transition-all duration-300 font-sans relative overflow-x-hidden ${activeTheme.bg} ${activeTheme.text}`}
    >
      <AnimatePresence>
        {achievementToast && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: -80, y: 24, scale: 0.82, rotate: -2 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, x: -48, scale: 0.9, filter: "blur(5px)" }}
            transition={{ type: "spring", damping: 18, stiffness: 230 }}
            onClick={() => {
              setAchievementToast(null);
              setNotificationOpen(true);
              setInboxOpen(false);
            }}
            className="fixed bottom-5 right-3 sm:right-6 z-[100] w-[calc(50vw-1rem)] min-w-40 max-w-sm overflow-hidden rounded-2xl border border-amber-300/40 bg-slate-950/95 p-3 sm:p-4 text-right text-white shadow-[0_0_55px_rgba(245,158,11,0.28)] backdrop-blur-xl group"
            aria-label="باز کردن اعلان دستاورد"
          >
            <span className="pointer-events-none absolute -left-10 -top-12 h-32 w-32 rounded-full bg-amber-400/20 blur-3xl" />
            <span className="relative flex items-start gap-2 sm:gap-3">
              <motion.span
                animate={{ rotate: [0, -8, 8, -4, 4, 0], scale: [1, 1.12, 1] }}
                transition={{ duration: 1.2, repeat: 2, repeatDelay: 0.7 }}
                className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl border border-amber-300/30 bg-gradient-to-br from-amber-300 to-orange-500 shadow-[0_0_22px_rgba(251,191,36,0.45)]"
              >
                <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-slate-950" />
              </motion.span>
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] font-black uppercase tracking-[0.28em] text-amber-300">دستاورد کسب شد</span>
                <span className="mt-1 block text-xs sm:text-sm font-black leading-tight">{achievementToast.title?.replace(/^Achievement Unlocked:\s*/i, "")}</span>
                <span className="mt-0.5 line-clamp-2 block text-[9px] sm:text-[10px] leading-relaxed text-slate-300">{achievementToast.text}</span>
                <span className="mt-1.5 hidden sm:block text-[9px] font-bold uppercase tracking-wider text-amber-200/70">برای باز کردن اعلان‌ها کلیک کنید</span>
              </span>
            </span>
            <motion.span
              className="absolute bottom-0 right-0 h-1 w-full origin-right bg-gradient-to-l from-amber-300 via-orange-400 to-fuchsia-500"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 10, ease: "linear" }}
            />
          </motion.button>
        )}
      </AnimatePresence>
      {currentUser?.email && currentUser.email_verified === false && (
        <div className="sticky top-0 z-50 w-full border-b border-amber-500/20 bg-amber-500/10 backdrop-blur px-4 py-3">
          <div className="mx-auto max-w-5xl flex flex-col md:flex-row md:items-center gap-3 text-xs">
            <div className="flex-1">
              <strong className="text-amber-500">آدرس ایمیل خود را تأیید کنید.</strong>
              <span className="ml-2 text-slate-500">کد 6 رقمی ارسال‌شده از رپتوک را وارد کنید.</span>
              {verificationMessage && <span className="ml-2 text-violet-500">{verificationMessage}</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                maxLength={6}
                placeholder="کد"
                className="w-24 rounded-lg border border-amber-500/30 bg-white/80 px-3 py-1.5 text-slate-900 outline-none dark:bg-black/40 dark:text-white"
              />
              <button onClick={handleVerifyEmailCode} className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-white">تأیید</button>
              <button onClick={handleResendVerificationCode} className="rounded-lg border border-amber-500/30 px-3 py-1.5 font-bold text-amber-500">ارسال مجدد</button>
            </div>
          </div>
        </div>
      )}
    
      {showAuthModal && (
        <div className="fixed inset-0 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 z-50" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
          <button type="button" className="absolute inset-0 bg-[#060409]/80 backdrop-blur-sm z-0" aria-label="بستن پنجره ورود" onClick={() => { setShowAuthModal(false); closePasswordReset(); }} />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className={`auth-dialog w-full max-w-md max-h-[92vh] overflow-y-auto p-5 sm:p-8 rounded-3xl border z-10 relative ${
              theme === "dark" 
                ? "bg-[#12101b] border-[#4b435e] text-[#f8f7fb] shadow-[0_0_50px_rgba(139,92,246,0.16)]" 
                : "bg-white border-[#E7DEC8] text-stone-900 shadow-2xl"
            }`}
          >
            <button type="button" onClick={() => { setShowAuthModal(false); closePasswordReset(); }} className="absolute top-4 right-4 rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-400" aria-label="بستن پنجره ورود">
              <X className="w-5 h-5" />
            </button>
            <div className="text-center space-y-2 mb-8 animate-fade-in">
              <div className="inline-flex p-3 rounded-2xl bg-violet-500/10 text-violet-400 border border-violet-500/20 mb-2">
                <BookOpen className="w-6 h-6 animate-pulse" />
              </div>
                    <h2 id="auth-dialog-title" className="text-2xl font-extrabold tracking-tight">
                      {showPasswordReset ? "بازیابی رمز عبور" : isSignup ? "ثبت‌نام" : "ورود"}
                    </h2>
                  </div>

                  {authError && (
                    <div className="p-3 mb-4 rounded-xl text-xs font-semibold bg-rose-500/10 border border-rose-500/20 text-rose-400 text-center flex items-center justify-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form noValidate onSubmit={showPasswordReset ? handlePasswordResetSubmit : handleAuthSubmit} className="space-y-4">
              {showPasswordReset ? (
                <>
                  <div className={`rounded-2xl border p-3 text-xs leading-relaxed ${
                    theme === "dark" ? "bg-violet-500/10 border-violet-500/20 text-violet-100" : "bg-violet-50 border-violet-100 text-violet-900"
                  }`}>
                    آدرس ایمیل خود را وارد کنید. در صورت وجود حساب، یک کد امن 6 رقمی برایتان می‌فرستیم.
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                      آدرس ایمیل
                    </label>
                    <input
                      type="email"
                      required
                      value={passwordResetEmail}
                      onChange={(e) => setPasswordResetEmail(e.target.value)}
                      placeholder="you@example.com"
                      disabled={passwordResetStep === "confirm" && authLoading}
                      className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all disabled:opacity-60 ${
                        theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                      }`}
                    />
                  </div>

                  {passwordResetStep === "confirm" && (
                    <>
                      <div>
                        <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                          آدرس ایمیل
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          maxLength={6}
                          value={passwordResetCode}
                          onChange={(e) => setPasswordResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder="000000"
                          className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold tracking-[0.35em] focus:outline-none focus:border-violet-500 transition-all ${
                            theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                          }`}
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                            رمز عبور جدید
                          </label>
                          <div className="relative">
                            <input
                              type={authShowPassword ? "text" : "password"}
                              required
                              value={passwordResetNewPassword}
                              onChange={(e) => setPasswordResetNewPassword(e.target.value)}
                              placeholder="رمز عبور جدید را وارد کنید"
                              className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all pl-10 ${
                                theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                              }`}
                            />
                            <button type="button" onClick={() => setAuthShowPassword(!authShowPassword)} className="absolute right-3 top-2.5 rounded text-slate-300 hover:text-violet-400 focus-visible:outline-2 focus-visible:outline-violet-400" aria-label={authShowPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} aria-pressed={authShowPassword}>
                              {authShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="mt-2 space-y-1.5 w-full">
                            <div className="flex gap-1 h-1.5 w-full">
                              <div className={`h-full flex-1 rounded-full transition-colors ${passwordResetNewPassword.length > 0 ? (passwordResetNewPassword.length >= 12 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500") : "bg-slate-200 dark:bg-slate-800"}`} />
                              <div className={`h-full flex-1 rounded-full transition-colors ${passwordResetNewPassword.length > 0 ? (/[A-Z]/.test(passwordResetNewPassword) && /[a-z]/.test(passwordResetNewPassword) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800") : "bg-slate-200 dark:bg-slate-800"}`} />
                              <div className={`h-full flex-1 rounded-full transition-colors ${passwordResetNewPassword.length > 0 ? (/[0-9]/.test(passwordResetNewPassword) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800") : "bg-slate-200 dark:bg-slate-800"}`} />
                              <div className={`h-full flex-1 rounded-full transition-colors ${passwordResetNewPassword.length > 0 ? (/[^a-zA-Z0-9]/.test(passwordResetNewPassword) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800") : "bg-slate-200 dark:bg-slate-800"}`} />
                            </div>
                            <p className="text-[9px] font-mono text-slate-500">
                              {passwordResetNewPassword.length < 12 ? "خیلی کوتاه است (حداقل 12 نویسه)." :
                               (!( /[A-Z]/.test(passwordResetNewPassword) && /[a-z]/.test(passwordResetNewPassword) ) ? "حرف بزرگ و کوچک اضافه کنید." :
                               (!/[0-9]/.test(passwordResetNewPassword) ? "یک عدد اضافه کنید." :
                               (!/[^a-zA-Z0-9]/.test(passwordResetNewPassword) ? "نویسهٔ ویژه اضافه کنید." : "رمز عبور امن شد!")))}
                            </p>
                          </div>
                        </div>

                        <div className="flex-1">
                          <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                            تکرار رمز عبور
                          </label>
                          <input
                            type={authShowPassword ? "text" : "password"}
                            required
                            value={passwordResetRepeatPassword}
                            onChange={(e) => setPasswordResetRepeatPassword(e.target.value)}
                            placeholder="تکرار رمز عبور جدید"
                            className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all ${
                              theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                            }`}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {passwordResetMessage && (
                    <div className="p-3 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-center">
                      {passwordResetMessage}
                    </div>
                  )}
                </>
              ) : isSignup ? (
                <>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                        نام مستعار
                      </label>
                      <input
                        type="text"
                        required
                        value={authNickname}
                        onChange={(e) => setAuthNickname(e.target.value)}
                        placeholder="نام مستعار"
                        className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all ${
                          theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                        نام کاربری
                      </label>
                      <input
                        type="text"
                        required
                        value={authUsername}
                        onChange={(e) => setAuthUsername(e.target.value)}
                        placeholder="نام کاربری"
                        className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all ${
                          theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                        }`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                      ایمیل
                    </label>
                    <input
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="آدرس ایمیل"
                      className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all ${
                        theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                      }`}
                    />
                  </div>

                  <div>
                      <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                        شماره موبایل (اختیاری)
                      </label>
                    <div className="grid grid-cols-[minmax(5.5rem,0.32fr)_minmax(0,1fr)] gap-2">
                      <div
                        className={`flex items-center justify-center px-3 py-2.5 rounded-xl border text-xs font-bold select-none ${
                          theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                        }`}
                        aria-label="کد کشور ایران"
                      >
                        🇮🇷 +98
                      </div>
                      <input
                        type="tel"
                        dir="ltr"
                        value={authPhone}
                        onChange={(e) => setAuthPhone(e.target.value)}
                        placeholder="09123456789"
                        className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all ${
                          theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                        رمز عبور
                      </label>
                      <div className="relative">
                        <input
                          type={authShowPassword ? "text" : "password"}
                          required
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          placeholder="••••••••"
                          className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all pl-10 ${
                            theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                          }`}
                        />
                        <button type="button" onClick={() => setAuthShowPassword(!authShowPassword)} className="absolute right-3 top-2.5 rounded text-slate-300 hover:text-violet-400 focus-visible:outline-2 focus-visible:outline-violet-400" aria-label={authShowPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} aria-pressed={authShowPassword}>
                          {authShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="mt-2 space-y-1.5 w-full">
                        <div className="flex gap-1 h-1.5 w-full">
                          <div className={`h-full flex-1 rounded-full transition-colors ${authPassword.length > 0 ? (authPassword.length >= 12 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500") : "bg-slate-200 dark:bg-slate-800"}`} />
                          <div className={`h-full flex-1 rounded-full transition-colors ${authPassword.length > 0 ? (/[A-Z]/.test(authPassword) && /[a-z]/.test(authPassword) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800") : "bg-slate-200 dark:bg-slate-800"}`} />
                          <div className={`h-full flex-1 rounded-full transition-colors ${authPassword.length > 0 ? (/[0-9]/.test(authPassword) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800") : "bg-slate-200 dark:bg-slate-800"}`} />
                          <div className={`h-full flex-1 rounded-full transition-colors ${authPassword.length > 0 ? (/[^a-zA-Z0-9]/.test(authPassword) ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800") : "bg-slate-200 dark:bg-slate-800"}`} />
                        </div>
                        <p className="text-[9px] font-mono text-slate-500">
                          {authPassword.length < 12 ? "خیلی کوتاه است (حداقل 12 نویسه)." : 
                           (!( /[A-Z]/.test(authPassword) && /[a-z]/.test(authPassword) ) ? "حرف بزرگ و کوچک اضافه کنید." : 
                           (!/[0-9]/.test(authPassword) ? "یک عدد اضافه کنید." : 
                           (!/[^a-zA-Z0-9]/.test(authPassword) ? "نویسهٔ ویژه اضافه کنید." : "رمز عبور امن شد!")))}
                        </p>
                      </div>
                    </div>

                    <div className="flex-1">
                      <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                        تکرار رمز عبور
                      </label>
                      <div className="relative">
                        <input
                          type={authShowPassword ? "text" : "password"}
                          required
                          value={authRepeatPassword}
                          onChange={(e) => setAuthRepeatPassword(e.target.value)}
                          placeholder="••••••••"
                          className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all pl-10 ${
                            theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                      ایمیل / نام کاربری / شماره تلفن
                    </label>
                    <input
                      type="text"
                      required
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      placeholder="ایمیل / نام کاربری / شماره تلفن"
                      className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all ${
                        theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                      }`}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-mono font-bold tracking-wider opacity-60 mb-1.5 text-left">
                      رمز عبور
                    </label>
                    <div className="relative">
                      <input
                        type={authShowPassword ? "text" : "password"}
                        required
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        placeholder="••••••••"
                        className={`w-full px-4 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:border-violet-500 transition-all pl-10 ${
                          theme === "dark" ? "bg-black/40 border-slate-800 text-white" : "bg-stone-50 border-stone-200 text-stone-900"
                        }`}
                      />
                      <button type="button" onClick={() => setAuthShowPassword(!authShowPassword)} className="absolute right-3 top-2.5 rounded text-slate-300 hover:text-violet-400 focus-visible:outline-2 focus-visible:outline-violet-400" aria-label={authShowPassword ? "پنهان کردن رمز عبور" : "نمایش رمز عبور"} aria-pressed={authShowPassword}>
                        {authShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={openPasswordReset}
                        className="text-[11px] text-violet-400 hover:text-violet-300 font-bold hover:underline cursor-pointer bg-transparent border-none outline-none"
                      >
                        رمز عبور را فراموش کرده‌اید؟
                      </button>
                    </div>
                  </div>
                </>
              )}

              {isSignup && !showPasswordReset && (
                <label className="flex items-start gap-3 text-left text-xs text-slate-400">
                  <input type="checkbox" required checked={acceptedRules} onChange={(e) => setAcceptedRules(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
                  <span><button type="button" onClick={() => setShowRulesModal(true)} className="text-violet-400 hover:underline font-bold">قوانین و شرایط خدمات</button> را می‌پذیرم.</span>
                </label>
              )}

              <button
                type="submit"
                disabled={authLoading || (isSignup && !systemSettings.allowRegistration)}
                className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-95 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {authLoading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>
                    {showPasswordReset
                      ? (passwordResetStep === "request" ? "ارسال کد بازیابی" : "بازیابی رمز عبور")
                      : isSignup
                        ? (!systemSettings.allowRegistration ? "ثبت‌نام بسته است" : "ثبت‌نام")
                        : "ورود"}
                  </span>
                )}
              </button>
            </form>

            {!showPasswordReset && (
              <div className="mt-4">
                <div className="flex items-center gap-3 mb-4"><span className="h-px flex-1 bg-slate-700/30" /><span className="text-[10px] uppercase font-bold text-slate-500">یا</span><span className="h-px flex-1 bg-slate-700/30" /></div>
                <button
                  type="button"
                  onClick={() => api.startGoogleAuth("login")}
                  className={`w-full py-2.5 rounded-xl border text-xs font-extrabold transition-colors inline-flex items-center justify-center gap-2 ${theme === "dark" ? "bg-white text-slate-900 border-white hover:bg-slate-100" : "bg-white text-slate-900 border-stone-200 hover:bg-stone-50"}`}
                >
                  <GoogleLogo /> ادامه با گوگل
                </button>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">ایمیل دارید؟ ابتدا به‌صورت عادی وارد شوید و از داشبورد ← امنیت گوگل را متصل کنید.</p>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-slate-800/10 dark:border-violet-950/20 text-center">
              {showPasswordReset ? (
                <div className="flex flex-wrap justify-center gap-3">
                  {passwordResetStep === "confirm" && (
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordResetStep("request");
                        setPasswordResetCode("");
                        setPasswordResetNewPassword("");
                        setPasswordResetRepeatPassword("");
                        setPasswordResetMessage("");
                        setAuthError("");
                      }}
                      className="text-xs text-violet-400 hover:text-violet-300 font-bold hover:underline cursor-pointer bg-transparent border-none outline-none"
                    >
                      استفاده از ایمیل دیگر
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closePasswordReset}
                    className="text-xs text-violet-400 hover:text-violet-300 font-bold hover:underline cursor-pointer bg-transparent border-none outline-none"
                  >
                    بازگشت به ورود
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!isSignup && !systemSettings.allowRegistration) {
                      setAuthError("ثبت‌نام در حال حاضر توسط مالک غیرفعال شده است.");
                      return;
                    }
                    setIsSignup(!isSignup);
                    setAuthError("");
                  }}
                  className="text-xs text-violet-400 hover:text-violet-300 font-bold hover:underline cursor-pointer bg-transparent border-none outline-none disabled:opacity-50"
                >
                  {isSignup 
                    ? "قبلاً ثبت‌نام کرده‌اید؟ ورود" 
                    : (!systemSettings.allowRegistration ? "ثبت‌نام‌ها بسته است" : "حساب کاربری ندارید؟ ثبت‌نام")}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}

          {activeLoginAlert && (
            <div className="sticky top-0 z-50 flex flex-col sm:flex-row items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-slate-950 text-xs font-bold shadow-lg">
              <span>{activeLoginAlert.text || "کسی وارد حساب شما شده است. اگر این شما نبودید، نشست او را حذف کنید."}</span>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button onClick={() => { setActiveView("profile"); dismissLoginAlert(); }} className="px-3 py-1 rounded-lg bg-slate-950 text-white">مشاهده نشست‌ها</button>
                {loginAlertSessionId && <button onClick={removeSuspiciousSession} className="px-3 py-1 rounded-lg bg-rose-700 text-white">حذف نشست</button>}
                <button onClick={dismissLoginAlert} className="px-3 py-1 rounded-lg border border-slate-900/30">بستن</button>
              </div>
            </div>
          )}

          {/* Universal Desktop Navigation Header */}
          <header className={`mobile-fixed-chrome sticky top-0 z-30 border-b bg-[var(--app-header)] transition-all ${activeTheme.border} ${theme === "dark" ? "shadow-[0_4px_30px_rgba(3,7,18,0.3)]" : "shadow-sm"} backdrop-blur-md`}>
        <div className="max-w-full min-w-0 px-2 sm:px-3 2xl:px-8 py-2.5 2xl:py-4 relative">

          {/* Mobile: brand on LEFT, control buttons (menu/theme/notifications) on RIGHT */}
          <div className="flex flex-row-reverse xl:flex-row items-center justify-between gap-1.5 2xl:gap-4">

          {/* Right Side (RTL start): brand logo image + name, always visible */}
          <a
            href="/"
            onClick={(event) => handleViewLink(event, "dashboard")}
            className="app-brand flex-none flex items-center gap-2 ml-3 sm:ml-4 cursor-pointer group select-none shrink-0 border-none bg-transparent p-0 my-0"
          >
            <img
              src="/logo-128.webp"
              alt="لوگوی رپتوک"
              width="128"
              height="128"
              decoding="async"
              className={`w-9 h-9 sm:w-11 sm:h-11 xl:w-10 xl:h-10 2xl:w-12 2xl:h-12 rounded-xl object-cover shadow-md ring-1 transition-transform duration-300 group-hover:scale-105 ${theme === "dark" ? "ring-violet-500/25" : "ring-orange-500/35"}`}
            />
            <span className={`app-brand-name text-[20px] leading-none sm:text-2xl xl:text-2xl 2xl:text-4xl font-black tracking-[0.08em] sm:tracking-[0.12em] 2xl:tracking-[0.3em] font-display transition-all duration-300 ${
              theme === "dark"
                ? "bg-gradient-to-r from-[var(--accent)] via-[var(--accent-secondary)] to-white bg-clip-text text-transparent drop-shadow-sm"
                : "bg-gradient-to-r from-[var(--app-text)] via-[var(--app-text)] to-[var(--accent)] bg-clip-text text-transparent hover:opacity-90"
            }`}>
              رپتوک
            </span>
          </a>

          {/* Core Navigation Hub: floating capsule nudged toward the left of the free space */}
          <div className="hidden xl:flex flex-1 min-w-0 mr-auto ml-1 2xl:ml-6 items-center justify-center">
            <nav className="flex min-w-0 max-w-full items-center gap-0.5 2xl:gap-1.5 overflow-x-auto scrollbar-none p-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-subtle)] shadow-xs select-none">
              {[
                { id: "dashboard", label: "خانه", icon: Home },
                { id: "discover", label: "کاوش", icon: Compass },
                { id: "writer", label: "نوشتن", icon: Feather },
                { id: "forums", label: "انجمن‌ها", icon: MessageSquare },
                { id: "challenges", label: "چالش‌ها", icon: Target },
                { id: "offline", label: "آفلاین", icon: Download },
                { id: "bookmarks", label: "نشانک‌ها", icon: Bookmark },
                { id: "support", label: "پشتیبانی", icon: HelpCircle },
                { id: "premium", label: "پریمیوم", icon: Sparkles, badge: "VIP" },
                ...(["editor", "publisher", "owner"].includes(userRole) ? [{ id: "editor-panel", label: "ویراستار", icon: PenTool }] : []),
                ...(userRole === "publisher" || userRole === "owner" ? [{ id: "authority-center", label: "مدیریت", icon: ShieldAlert, badge: userRole.toUpperCase() }] : [])
              ].map((item) => {
                const IconComp = item.icon;
                const isSelected = activeView === item.id;
                return (
                  <a
                    key={item.id}
                    href={buildNavigationUrl({ activeView: item.id as AppView })}
                    onClick={(event) => handleViewLink(event, item.id as AppView)}
                    aria-current={isSelected ? "page" : undefined}
                    className={`flex shrink-0 items-center gap-1.5 2xl:gap-2 px-2 xl:px-2.5 2xl:px-3.5 py-2 rounded-xl text-[11px] 2xl:text-sm font-extrabold transition-all duration-300 cursor-pointer border ${
                      isSelected
                        ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm border border-[var(--accent)]"
                        : theme === "dark"
                          ? "text-slate-400 hover:text-slate-100 hover:bg-slate-500/5 border-transparent"
                          : "text-stone-600 hover:text-[var(--accent-text)] hover:bg-[var(--accent-soft)] border-transparent"
                    }`}
                    title={item.label}
                  >
                    <IconComp className={`w-4 h-4 shrink-0 transition-transform duration-300 ${isSelected ? "text-white scale-110" : theme === "dark" ? "text-slate-400" : "text-stone-500"}`} />
                    <span className="hidden xl:inline leading-none">{item.label}</span>
                    {item.badge && (
                      <span className={`hidden 2xl:inline-block text-[8px] font-mono font-black uppercase tracking-widest px-1 py-0.5 rounded select-none leading-none ${
                        isSelected 
                          ? "bg-white/20 text-white" 
                          : "bg-purple-600/20 text-purple-400 dark:text-purple-300 border border-purple-500/10"
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </a>
                );
              })}
            </nav>
          </div>

          {/* Right Header Controls — mobile order from right edge: menu, theme, notifications */}
          <div className="app-header-controls flex-none flex items-center justify-end gap-1 lg:gap-1.5 2xl:gap-3 shrink-0">
            {/* Hamburger Menu icon for mobile — first item from the right */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`xl:hidden p-2.5 sm:p-2 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-slate-400 hover:text-violet-400 transition-all cursor-pointer ${activeTheme.shadow}`}
              title="باز و بسته کردن منوی ناوبری"
            >
              {mobileMenuOpen ? <X className="w-[22px] h-[22px] sm:w-4.5 sm:h-4.5 text-red-500" /> : <Menu className="w-[22px] h-[22px] sm:w-4.5 sm:h-4.5 text-violet-400 scale-105 animate-pulse" />}
            </button>

            {/* Ctrl + K / Ctrl + F search shortcut trigger */}
            <button
              onClick={() => setSearchModalOpen(true)}
              className={`hidden md:flex items-center gap-2 px-2 2xl:px-3 py-2 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-slate-400 hover:text-violet-400 hover:border-violet-500/30 transition-all cursor-pointer`}
              title="جستجوی سراسری (Ctrl + K / Ctrl + F)"
            >
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="hidden 2xl:inline text-xs font-mono font-bold text-slate-400 leading-none">Ctrl + K</span>
            </button>

            {/* Notifications (Bell) with dynamic interactable panel */}
            <div className="block relative" id="notification-container">
              <button
                onClick={() => {
                  setNotificationOpen(!notificationOpen);
                  setInboxOpen(false);
                }}
                className={`p-2.5 sm:p-2 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-slate-400 hover:text-violet-400 transition-all cursor-pointer relative ${activeTheme.shadow}`}
                title="اعلان‌های سیستم"
              >
                <Bell className="w-[22px] h-[22px] sm:w-4.5 sm:h-4.5" />
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-violet-500 border border-slate-900 animate-pulse" />
                )}
              </button>

              {notificationOpen && (
                <div
                  className={`absolute right-0 xl:right-auto xl:left-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))] sm:w-80 rounded-2xl border ${theme === "dark" ? "bg-[#0b0716]/95 border-violet-900/40 text-slate-300 shadow-[0_10px_40px_rgba(3,7,18,0.8)]" : "bg-white border-stone-200 text-stone-800 shadow-xl"} p-4 z-50 transition-all`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800/40 mb-2">
                    <span className="font-mono font-black text-[10px] tracking-widest uppercase text-violet-500">اعلان‌ها</span>
                    <button 
                      onClick={() => {
                        setNotifications(notifications.map(n => ({ ...n, read: true })));
                        if (authToken) api.readNotifications(authToken, undefined, true);
                      }}
                      className="text-[9px] hover:text-violet-400 font-bold uppercase transition"
                    >
                      علامت‌گذاری همه به‌عنوان خوانده‌شده
                    </button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {notifications.map((n) => (
                      <div 
                        key={n.id} 
                        onClick={() => {
                          setNotifications(notifications.map(item => item.id === n.id ? { ...item, read: true } : item));
                          if (authToken && !n.read) api.readNotifications(authToken, n.id);
                          openNotificationLink(n.link);
                        }}
                        className={`p-2 rounded-xl border transition-all cursor-pointer text-left ${
                          n.read 
                            ? "bg-transparent border-transparent text-slate-400 dark:text-slate-500" 
                            : "bg-violet-500/5 border-violet-500/15 text-slate-800 dark:text-slate-200"
                        } hover:bg-slate-500/5`}
                      >
                        <div className="flex justify-between items-start gap-1">
                          <p className="text-[11px] font-bold leading-tight">{n.title}</p>
                          <span className="text-[8px] opacity-65 font-mono shrink-0">{n.time}</span>
                        </div>
                        <p className="text-[10px] mt-0.5 opacity-80 leading-relaxed">{n.text}</p>
                      </div>
                    ))}
                    {notifications.length === 0 && (
                      <div className="text-center py-4 text-xs opacity-55">اعلانی وجود ندارد!</div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setNotificationOpen(false);
                      setActiveView("notifications");
                    }}
                    className={`mt-2 w-full py-2 rounded-xl text-[11px] font-black bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer`}
                  >
                    دیدن همهٔ اعلان‌ها
                  </button>
                </div>
              )}
            </div>

            {/* Inbox / Email logo with interactive content panel */}
            <div className="header-inbox block relative" id="inbox-container">
              <button
                onClick={() => {
                  setInboxOpen(!inboxOpen);
                  setNotificationOpen(false);
                }}
                className={`p-2 rounded-xl border ${activeTheme.border} ${activeTheme.card} text-slate-400 hover:text-violet-400 transition-all cursor-pointer relative ${activeTheme.shadow}`}
                title="پیام‌رسان و صندوق ورودی نویسندگان"
              >
                <Mail className="w-4.5 h-4.5" />
                {emails.some(e => !e.read) && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-purple-500 border border-slate-900 animate-pulse" />
                )}
              </button>

              {inboxOpen && (
                <div
                  className={`absolute right-0 xl:right-auto xl:left-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))] sm:w-80 rounded-2xl border ${theme === "dark" ? "bg-[#0b0716]/95 border-violet-900/40 text-slate-300 shadow-[0_10px_40px_rgba(3,7,18,0.8)]" : "bg-white border-stone-200 text-stone-800 shadow-xl"} p-4 z-50 transition-all`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800/40 mb-2">
                    <span className="font-mono font-black text-[10px] tracking-widest uppercase text-purple-500">صندوق ورودی</span>
                    <button 
                      onClick={() => {
                        setEmails(emails.map(e => ({ ...e, read: true })));
                        if (authToken) api.readMessages(authToken, undefined, true);
                      }}
                      className="text-[9px] hover:text-purple-400 font-bold uppercase transition"
                    >
                      علامت‌گذاری به‌عنوان خوانده‌شده
                    </button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {emails.map((e) => (
                      <div 
                        key={e.id} 
                        onClick={() => {
                          setEmails(emails.map(item => item.id === e.id ? { ...item, read: true } : item));
                          if (authToken && !e.read) api.readMessages(authToken, e.id);
                          if ((e as any).link) {
                            setInboxOpen(false);
                            openNotificationLink((e as any).link);
                          }
                        }}
                        className={`p-2 rounded-xl border transition-all cursor-pointer text-left ${
                          e.read 
                            ? "bg-transparent border-transparent text-slate-400 dark:text-slate-500" 
                            : "bg-purple-500/5 border-purple-500/15 text-slate-800 dark:text-slate-200"
                        } hover:bg-slate-500/5`}
                      >
                        <div className="flex justify-between items-start gap-1">
                          <p className="text-[10px] font-mono font-bold leading-none text-purple-500 dark:text-purple-400">{e.sender}</p>
                          <span className="text-[8px] opacity-65 font-mono shrink-0">{e.date}</span>
                        </div>
                        <p className="text-[11px] font-extrabold mt-1 text-slate-800 dark:text-slate-200 leading-tight">{e.subject}</p>
                        <p className="text-[10px] mt-0.5 opacity-75 line-clamp-2 leading-relaxed">{e.snippet}</p>
                        {currentUser && e.sender && e.sender !== currentUser.username && !String(e.sender).toLowerCase().includes("reptoc admin") && (
                          <div onClick={(event) => event.stopPropagation()} className="mt-1.5">
                            <ReportButton targetType="message" targetId={e.id} label="گزارش پیام" className="text-[9px] text-rose-400 hover:text-rose-300" />
                          </div>
                        )}
                      </div>
                    ))}
                    {emails.length === 0 && (
                      <div className="text-center py-4 text-xs opacity-55">صندوق پستی شما خالی است!</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <ThemeCustomizer
              mode={theme}
              accentTheme={accentTheme}
              customColors={customThemeColors}
              appearance={appearance}
              onModeChange={handleThemeModeChange}
              onAccentThemeChange={handleAccentThemeChange}
              onCustomColorsChange={handleCustomThemeChange}
              onAppearanceChange={handleAppearanceChange}
              onReset={handleResetAppearance}
            />

            {/* Writer Profile Widget (replaces equivalent sidebar profile component) */}
            {currentUser ? (
              <div 
                onClick={() => setActiveView("profile")}
                className={`hidden xl:flex items-center gap-2 px-2 2xl:px-3 py-1.5 rounded-xl border ${activeTheme.border} ${activeTheme.card} ${activeTheme.shadow} relative group cursor-pointer hover:border-violet-500/20`}
              >
                <div className="relative">
                  {renderUserAvatar("w-7 h-7 rounded-lg", "text-xs")}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-slate-950 flex items-center justify-center" />
                </div>
                <div className="hidden 2xl:block text-left font-mono">
                  <div className="flex items-center gap-1 leading-none">
                    <span className="text-[11px] font-bold text-stone-900 dark:text-violet-100">{currentUser?.username}</span>
                    <span className="text-[9px] font-extrabold text-amber-500 bg-amber-500/10 px-0.5 rounded uppercase">سطح {userLevelState.level}</span>
                  </div>
                  <span className="text-[9px] font-semibold text-slate-500 uppercase block tracking-tight mt-0.5">{getAccessLabel(userRole)}</span>
                </div>

                {/* Hover Dropdown card with full gamified features */}
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-violet-900/30 bg-[#0b0716] p-4 text-xs font-medium text-slate-400 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 shadow-2xl z-50 space-y-3 animate-fade-in">
                  <div className="flex items-center gap-3 border-b border-slate-800/20 pb-2">
                    {renderUserAvatar("w-8 h-8 rounded-lg", "text-xs")}
                    <div>
                      <h4 className="font-extrabold text-xs text-white">{currentUser?.username}</h4>
                      <span className="text-[10px] text-amber-400 font-mono">{getAccessLabel(userRole)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveView("profile");
                    }}
                    className="w-full py-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90 text-white font-bold rounded-lg text-[10px] uppercase tracking-wider transition-all cursor-pointer text-center"
                  >
                    مشاهده پروفایل
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="hidden xl:block px-3 2xl:px-4 py-2 rounded-xl text-xs font-extrabold bg-violet-600 hover:bg-violet-500 text-white transition-all text-center whitespace-nowrap"
              >
                ورود / ثبت‌نام
              </button>
            )}
          </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Navigation Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop cover */}
            <motion.div
              key="mobile-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-45 xl:hidden"
            />

            {/* Slide-out Drawer Panel */}
            <motion.div
              key="mobile-drawer-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className={`fixed inset-y-0 right-0 w-full max-w-[320px] sm:max-w-xs z-50 p-5 shadow-2xl border-l flex flex-col justify-between overflow-y-auto custom-scrollbar xl:hidden ${
                theme === "dark" 
                  ? "bg-[#0b0716] border-violet-900/30 text-white" 
                  : "bg-[#FBF7ED] border-stone-300/80 text-stone-900"
              }`}
            >
              {/* Drawer Top / Header info */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 select-none">
                    <img src="/logo-128.webp" alt="لوگوی رپتوک" width="128" height="128" decoding="async" className="w-8 h-8 rounded-lg object-cover ring-1 ring-violet-500/25" />
                    <span className={`app-brand-name text-base font-black tracking-widest font-display ${
                      theme === "dark" ? "text-violet-400" : "text-violet-950"
                      }`}>
                      رپتوک
                    </span>
                  </span>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className={`p-1.5 rounded-lg border ${activeTheme.border} ${activeTheme.card} text-slate-400 hover:text-violet-400 cursor-pointer`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Mobile Gamified Profile Segment inside Drawer */}
                {currentUser ? (
                  <div className={`p-4 rounded-xl border ${theme === "dark" ? "bg-slate-950/80 border-slate-900" : "bg-stone-50 border-stone-100"} space-y-3`}>
                    <div className="flex items-center gap-3">
                      {renderUserAvatar("w-10 h-10 rounded-lg", "text-sm")}
                      <div className="text-left font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-[#111] dark:text-slate-100 text-[13px]">{currentUser?.username}</span>
                          <span className="text-[10px] font-mono font-bold text-amber-500 bg-amber-500/10 px-1 rounded uppercase">سطح {userLevelState.level}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold block mt-0.5 animate-pulse">
                          {getAccessLabel(userRole)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        handleLogout();
                        setMobileMenuOpen(false);
                      }}
                      className="w-full py-1.5 border border-red-500/30 text-rose-500 hover:bg-rose-500/10 font-bold rounded-lg text-[9px] uppercase tracking-wider transition-all cursor-pointer text-center flex items-center justify-center gap-1 mt-1"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>خروج از حساب</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setShowAuthModal(true);
                    }}
                    className="w-full px-4 py-3 rounded-xl text-sm font-extrabold bg-violet-600 hover:bg-violet-500 text-white transition-all text-center"
                  >
                    ورود / ثبت‌نام
                  </button>
                )}

                {/* Primary Section Links inside Drawer */}
                <nav className="space-y-1.5 text-left">
                  {[
                    { id: "dashboard", label: "خانه", icon: Home },
                    { id: "discover", label: "کاوش", icon: Compass },
                    { id: "ranking", label: "رتبه‌بندی", icon: Trophy },
                    { id: "writer", label: "نوشتن", icon: Feather },
                    { id: "forums", label: "انجمن‌ها", icon: MessageSquare },
                    { id: "bookmarks", label: "نشانک‌ها", icon: Bookmark },
                    { id: "offline", label: "آفلاین", icon: Download },
                    { id: "support", label: "مرکز پشتیبانی", icon: HelpCircle },
                    { id: "premium", label: "عضویت پریمیوم", icon: Sparkles, badge: "VIP" },
                    ...(["editor", "publisher", "owner"].includes(userRole) ? [{ id: "editor-panel", label: "پنل ویراستار", icon: PenTool }] : []),
                    ...(userRole === "publisher" || userRole === "owner" ? [{ id: "authority-center", label: "مدیریت", icon: ShieldAlert, badge: userRole.toUpperCase() }] : [])
                  ].map((item) => {
                    const IconComp = item.icon;
                    const isSelected = activeView === item.id;
                    return (
                      <a
                        key={item.id}
                        href={buildNavigationUrl({ activeView: item.id as AppView })}
                        onClick={(event) => handleViewLink(event, item.id as AppView)}
                        aria-current={isSelected ? "page" : undefined}
                        className={`w-full flex items-center justify-between p-3 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer border ${
                          isSelected
                            ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/20"
                            : "border-transparent text-slate-500 dark:text-slate-400 hover:text-violet-500 hover:bg-violet-500/5"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <IconComp className={`w-4.5 h-4.5 ${isSelected ? "text-white" : "text-slate-500"}`} />
                          <span className="leading-none">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className={`text-[8px] font-mono font-black uppercase tracking-widest px-1 py-0.5 rounded leading-none ${
                            isSelected 
                              ? "bg-white/20 text-white" 
                              : "bg-purple-600/10 text-purple-500 dark:text-purple-400"
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </a>
                    );
                  })}
                </nav>

                {/* Mobile Search inside Drawer */}
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setSearchModalOpen(true);
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-slate-500 dark:text-slate-400 hover:text-violet-500 hover:bg-violet-500/5 transition-all text-left text-xs font-bold cursor-pointer ${activeTheme.border}`}
                >
                  <Search className="w-4.5 h-4.5" />
                  <span>جستجو در کتابخانه...</span>
                </button>
              </div>

              {/* Drawer Bottom controls */}
              <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/30">
                {currentUser && (
                  <button
                    onClick={() => {
                      setActiveView("profile");
                      setMobileMenuOpen(false);
                    }}
                    className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all cursor-pointer text-center"
                  >
                    مشاهده پروفایل
                  </button>
                )}
                <p className="text-[9px] font-mono text-center text-slate-400/60 leading-none">
                  موتور رپتوک v2.4.6
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Container Frame holding Center-aligned Right Content panel only */}
      <div className="max-w-7xl mx-auto flex min-h-[calc(100vh-73px)] relative">
        {/* Dynamic Nav views render content column */}
        <main className={`app-view-stage flex-grow min-w-0 max-w-full ${activeView === 'discover' ? 'px-0 py-0' : 'px-3 sm:px-4 md:px-8 py-6 md:py-8'}`}>
          <LazyRouteBoundary label="صفحه" fallback={<div className="p-12 text-center text-sm text-slate-400">در حال بارگذاری صفحه…</div>}>
          <AnimatePresence mode="wait" initial={false}>
            {(activeView === "dashboard" || activeView === "ranking") && (
              <motion.div
                key={activeView}
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <Dashboard
                  novels={novels}
                  currentUser={currentUser}
                  onSelectNovel={(novel) => {
                    setNovels((current) => current.some((item) => item.id === novel.id) ? current : [...current, novel]);
                    setSelectedNovelId(novel.id);
                    setActiveView("novel-details");
                  }}
                  readingProgress={readingProgress}
                  onResumeReading={handleResumeReading}
                  onOpenWriter={() => {
                    setWriterEditNovelId("");
                    setActiveView("writer");
                  }}
                  onOpenEvent={() => setActiveView("event-status")}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  onBookmarkNovel={handleBookmarkNovel}
                  bookmarkedIds={bookmarkedIds}
                  onSelectAuthor={(author) => {
                    setSelectedAuthorName(author);
                    setActiveView("author-profile");
                  }}
                  systemSettings={systemSettings}
                  initialSection={activeView === "ranking" ? "rankings" : undefined}
                  onCloseInitialSection={activeView === "ranking" ? () => setActiveView("dashboard") : undefined}
                />
              </motion.div>
            )}

            {activeView === "discover" && (
              <motion.div
                key="discover"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="w-full relative z-30 flex justify-center"
              >
                <DiscoverFeed 
                  theme={theme}
                  activeTheme={activeTheme}
                  novels={novels}
                  currentUser={currentUser}
                  bookmarkedIds={bookmarkedIds}
                  onToggleBookmark={(id, state) => handleBookmarkNovel(id)}
                  onLikeChange={(id, likesCount) => updateNovelCounts(id, { likesCount })}
                  onNavigateToAuthor={(author) => {
                    setSelectedAuthorName(author);
                    setActiveView("author-profile");
                  }}
                  onNavigateToNovel={(id) => {
                    setSelectedNovelId(id);
                    setActiveView("novel-details");
                  }}
                />
              </motion.div>
            )}

            {activeView === "notifications" && (
              <motion.div
                key="notifications"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <div className="mx-auto max-w-2xl space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h1 className="text-2xl font-black">اعلان‌ها</h1>
                      <p className="mt-1 text-xs text-slate-500">همهٔ اعلان‌ها و به‌روزرسانی‌های حساب شما</p>
                    </div>
                    <button
                      onClick={() => {
                        setNotifications(notifications.map(n => ({ ...n, read: true })));
                        if (authToken) api.readNotifications(authToken, undefined, true);
                      }}
                      className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-bold ${activeTheme.border} text-violet-500 hover:bg-violet-500/10 cursor-pointer`}
                    >
                      خواندن همه
                    </button>
                  </div>

                  {!currentUser ? (
                    <div className={`rounded-3xl border p-12 text-center space-y-4 ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/90" : "bg-[#FBF7ED]"}`}>
                      <Bell className="w-10 h-10 mx-auto text-violet-500/50" />
                      <p className="text-sm font-bold">برای دیدن اعلان‌هایتان وارد حساب شوید.</p>
                      <button onClick={() => setShowAuthModal(true)} className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-black text-white hover:bg-violet-500 cursor-pointer">ورود / ثبت‌نام</button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className={`rounded-3xl border p-12 text-center ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716]/90" : "bg-[#FBF7ED]"}`}>
                      <Bell className="w-10 h-10 mx-auto text-violet-500/40" />
                      <p className="mt-3 text-sm font-bold">فعلاً اعلانی ندارید.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setNotifications(notifications.map(item => item.id === n.id ? { ...item, read: true } : item));
                            if (authToken && !n.read) api.readNotifications(authToken, n.id);
                            openNotificationLink(n.link);
                          }}
                          className={`w-full p-4 rounded-2xl border transition-all text-left cursor-pointer ${
                            n.read
                              ? `${activeTheme.border} ${theme === "dark" ? "bg-transparent" : "bg-white/60"} opacity-70`
                              : `border-violet-500/30 ${theme === "dark" ? "bg-violet-500/5" : "bg-violet-100/60"}`
                          } hover:border-violet-500/50`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <p className="text-xs font-black leading-tight">{n.title}</p>
                            <span className="text-[9px] opacity-60 font-mono shrink-0">{n.time}</span>
                          </div>
                          <p className="text-[11px] mt-1 opacity-85 leading-relaxed">{n.text}</p>
                          {n.link && <span className="mt-1 inline-block text-[9px] font-bold uppercase tracking-wider text-violet-400">مشاهده ←</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeView === "event-status" && (
              <EventStatus
                theme={theme}
                onBack={() => setActiveView("dashboard")}
                onSelectNovel={(novelId) => {
                  setSelectedNovelId(novelId);
                  setActiveView("novel-details");
                }}
              />
            )}

            {activeView === "challenges" && (
              <DailyChallenges
                theme={theme}
                currentUser={currentUser}
                onRequireLogin={() => setActiveView("profile")}
              />
            )}

            {activeView === "offline" && (
              <OfflineDownloads
                theme={theme}
                onRead={(novelId, chapterId) => { void openNovelReader(novelId, chapterId); }}
              />
            )}

            {activeView === "novel-details" && activeNovel && (
              <motion.div
                key="novel-details"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <NovelDetails
                  novel={activeNovel}
                  onBack={() => setActiveView("dashboard")}
                  onBookmark={(novelId) => handleBookmarkNovel(novelId)}
                  isBookmarked={bookmarkedIds.includes(activeNovel.id)}
                  onReadChapter={(chapter) => {
                    void openNovelReader(activeNovel.id, chapter.id);
                  }}
                  onAddReview={handleAddReview}
                  onRateNovel={handleRateNovel}
                  theme={theme}
                  readingProgress={
                    readingProgress.find((p) => p.novelId === activeNovel.id)?.chapterNumber || null
                  }
                  onSelectAuthor={(author) => {
                    setSelectedAuthorName(author);
                    setActiveView("author-profile");
                  }}
                  currentUser={currentUser}
                  onRequireLogin={() => setShowAuthModal(true)}
                  onEditNovel={(novelId) => {
                    setWriterEditNovelId(novelId);
                    setActiveView("writer");
                  }}
                  onOpenWorldbuilding={(novelId) => { setSelectedNovelId(novelId); setActiveView("worldbuilding"); }}
                />
              </motion.div>
            )}

            {activeView === "worldbuilding" && activeNovel && (
              <LazyRouteBoundary label="محیط جهان‌سازی" fallback={<div className="p-12 text-center text-sm text-slate-400">در حال بارگذاری محیط جهان‌سازی…</div>}>
                <WorldbuildingWorkspace novel={activeNovel} currentUser={currentUser} theme={theme} initialResourceId={selectedChapterId} onBack={() => setActiveView("novel-details")} onUpgrade={() => setActiveView("premium")} />
              </LazyRouteBoundary>
            )}

            {activeView === "reader" && activeNovel && activeChapter && (
              <motion.div
                key="reader"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <Reader
                  key={activeChapter.id}
                  novel={activeNovel}
                  chapter={activeChapter}
                  currentUser={currentUser}
                  onBackToNovel={closeReader}
                  onUpdateScroll={handleUpdateScroll}
                  onChapterLikeChange={handleChapterLikeChange}
                  onNavigateChapter={navigateReaderChapter}
                  onSelectUser={selectReaderUser}
                  theme={theme}
                  bookMode={appearance.bookMode}
                  onBookModeChange={(enabled) => handleAppearanceChange({ ...appearance, bookMode: enabled })}
                  initialProgressPercent={(() => {
                    const progress = readingProgress.find((item) => item.novelId === activeNovel.id && item.chapterId === activeChapter.id);
                    return Number(progress?.scrollPercentage ?? progress?.scrollPercent ?? 0);
                  })()}
                />
              </motion.div>
            )}

            {activeView === "writer" && (
              <motion.div
                key="writer"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                {!currentUser ? (
                  <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                    <Feather className="w-16 h-16 text-violet-500/50" />
                    <h2 className="text-2xl font-bold">بخش نویسندگان</h2>
                    <p className="text-sm opacity-60 max-w-sm">برای نوشتن و انتشار آثار خود، به جمع ما بپیوندید یا وارد حساب نویسندگی خود شوید.</p>
                    <button onClick={() => setShowAuthModal(true)} className="px-6 py-2 border border-violet-500 text-violet-500 hover:bg-violet-500 hover:text-white rounded-lg transition-all font-bold">ورود / ثبت‌نام</button>
                  </div>
                ) : (
                  <LazyRouteBoundary label="کارگاه نویسنده" fallback={<div className="p-12 text-center text-sm text-slate-400">در حال بارگذاری کارگاه نویسنده…</div>}>
                  <Writer
                    novels={ownedNovels}
                    onAddNewNovel={handleAddNewNovel}
                    onUpdateNovelChapters={handleUpdateNovelChapters}
                    onUpdateNovel={handleUpdateNovel}
                    onUpdateNovelCover={handleUpdateNovelCover}
                    onDeleteNovel={handleDeleteNovel}
                    onBackToDashboard={() => setActiveView("dashboard")}
                    theme={theme}
                    bookMode={appearance.bookMode}
                    onBookModeChange={(enabled) => handleAppearanceChange({ ...appearance, bookMode: enabled })}
                    currentUser={currentUser}
                    initialEditNovelId={writerEditNovelId}
                    onOpenWorldbuilding={(novelId) => { setSelectedNovelId(novelId); setActiveView("worldbuilding"); }}
                  />
                  </LazyRouteBoundary>
                )}
              </motion.div>
            )}

            {activeView === "forums" && (
              <motion.div
                key="forums"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <Forums
                  theme={theme}
                  currentUser={currentUser}
                  novels={novels}
                  onNavigateToNovel={(id) => {
                    setSelectedNovelId(id);
                    setActiveView("novel-details");
                  }}
                />
              </motion.div>
            )}

            {activeView === "support" && (
              <motion.div
                key="support"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                {!currentUser ? (
                  <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                    <HelpCircle className="w-16 h-16 text-violet-500/50" />
                    <h2 className="text-2xl font-bold">مرکز پشتیبانی</h2>
                    <p className="text-sm opacity-60 max-w-sm">برای ارسال تیکت پشتیبانی و تماس با مدیران، وارد شوید.</p>
                    <button onClick={() => setShowAuthModal(true)} className="px-6 py-2 border border-violet-500 text-violet-500 hover:bg-violet-500 hover:text-white rounded-lg transition-all font-bold">ورود / ثبت‌نام</button>
                  </div>
                ) : (
                  <Support theme={theme} currentUser={currentUser} systemSettings={systemSettings} initialIssue={supportIssuePreset} />
                )}
              </motion.div>
            )}

            {activeView === "premium" && (
              <motion.div
                key="premium"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <Premium
                  theme={theme}
                  onBuyVip={() => {
                    setSupportIssuePreset("VIP Purchase");
                    setActiveView("support");
                  }}
                />
              </motion.div>
            )}

            {activeView === "profile" && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <UserProfile
                  theme={theme}
                  defaultTab={profileTab}
                  novels={novels}
                  followers={followers}
                  setFollowers={setFollowers}
                  following={following}
                  setFollowing={setFollowing}
                  myComments={myComments}
                  readingProgress={readingProgress}
                  bookmarkedIds={bookmarkedIds}
                  claimedAchievements={claimedAchievements}
                  onClaimAchievement={handleClaimAchievement}
                  userLevelState={userLevelState}
                  onBackToDashboard={() => setActiveView("dashboard")}
                  currentUser={currentUser}
                  onAuthSuccess={handleAuthSuccess}
                  onLogout={handleLogout}
                  onOpenRules={() => setShowRulesModal(true)}
                />
              </motion.div>
            )}

            {activeView === "author-profile" && (
              <motion.div
                key="author-profile"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <AuthorProfile
                  authorName={selectedAuthorName}
                  novels={novels}
                  followersList={followers}
                  onToggleFollow={handleToggleFollow}
                  onBack={() => setActiveView("dashboard")}
                  onSelectNovel={(novel) => {
                    setSelectedNovelId(novel.id);
                    setActiveView("novel-details");
                  }}
                  theme={theme}
                  currentUser={currentUser}
                />
              </motion.div>
            )}

            {activeView === "editor-panel" && (
              <motion.div
                key="editor-panel"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <EditorPanel theme={theme} userRole={userRole as any} />
              </motion.div>
            )}
            {activeView === "authority-center" && (
              <motion.div
                key="authority-center"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <LazyRouteBoundary label="بخش مدیریت" fallback={<div className="p-12 text-center text-sm text-slate-400">در حال بارگذاری بخش مدیریت…</div>}><AuthorityCenter
                  theme={theme}
                  novels={novels}
                  onApproveNovel={handleApproveNovel}
                  onRejectNovel={handleRejectNovel}
                  onDeleteNovel={handleDeleteNovel}
                  blockedUsers={blockedUsers}
                  onToggleBlockUser={handleToggleBlockUser}
                  systemSettings={systemSettings}
                  onSaveSettings={handleSaveSettings}
                  userRole={userRole}
                /></LazyRouteBoundary>
              </motion.div>
            )}
            {activeView === "bookmarks" && (
              <motion.div
                key="bookmarks"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <Bookmarks
                  theme={theme}
                  novels={novels}
                  bookmarkedIds={bookmarkedIds}
                  onBookmarkedIdsChange={setBookmarkedIds}
                  onResumeReading={(id) => {
                    void openNovelReader(id);
                  }}
                  currentUser={currentUser}
                  onLoginClick={() => setShowAuthModal(true)}
                />
              </motion.div>
            )}

            {activeView === "rules" && (
              <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`max-w-4xl mx-auto rounded-2xl border p-6 md:p-10 ${activeTheme.card} ${activeTheme.border}`}>
                <button onClick={() => setActiveView("dashboard")} className="mb-6 text-xs font-bold text-violet-400 hover:underline">← بازگشت به خانه</button>
                <div className="rules-content text-sm leading-7 text-slate-400" dangerouslySetInnerHTML={{ __html: sanitizeInjectedHtml(AUTHOR_RULES_HTML) }} />
              </motion.section>
            )}

            {activeView === "terms-of-service" && (
              <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`max-w-4xl mx-auto rounded-2xl border p-6 md:p-10 ${activeTheme.card} ${activeTheme.border}`}>
                <button onClick={() => setActiveView("dashboard")} className="mb-6 text-xs font-bold text-violet-400 hover:underline">← بازگشت به خانه</button>
                <div className="rules-content text-sm leading-7 text-slate-400" dangerouslySetInnerHTML={{ __html: sanitizeInjectedHtml(TERMS_OF_SERVICE_HTML) }} />
              </motion.section>
            )}

            {(["privacy-policy", "dmca", "contact-us", "about-us"] as AppView[]).includes(activeView) && (
              <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`max-w-4xl mx-auto rounded-2xl border p-6 md:p-10 ${activeTheme.card} ${activeTheme.border}`}>
                <button onClick={() => setActiveView("dashboard")} className="mb-6 text-xs font-bold text-violet-400 hover:underline">← بازگشت به خانه</button>
                <div
                  className="rules-content text-sm leading-7 text-slate-400"
                  dangerouslySetInnerHTML={{ __html: sanitizeInjectedHtml({
                    "privacy-policy": PRIVACY_POLICY_HTML,
                    dmca: DMCA_POLICY_HTML,
                    "contact-us": CONTACT_US_HTML,
                    "about-us": ABOUT_US_HTML,
                  }[activeView] || "") }}
                />
              </motion.section>
            )}

            {activeView === "not-found" && (
              <motion.div
                key="not-found"
                initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.985, filter: "blur(6px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="w-full"
              >
                <NotFound
                  onNavigateHome={() => setActiveView("dashboard")}
                  title="صفحه پیدا نشد"
                  description="صفحه یا محتوایی که به دنبالش هستید وجود ندارد یا ممکن است حذف شده باشد."
                  searchEnabled={true}
                />
              </motion.div>
            )}

          </AnimatePresence>
          </LazyRouteBoundary>
        </main>
      </div>

      {/* Footer Branding Elements */}
      <footer className={`app-footer py-12 border-t ${activeTheme.border} bg-[var(--app-card)] text-center z-10 relative pb-24 md:pb-12`}>
        <div className="max-w-4xl mx-auto px-6">
          <p className="text-xl font-serif italic font-extrabold tracking-wide text-slate-800 dark:text-violet-300">
            © {new Date().getFullYear()} رپتوک.
          </p>
          <p className="mt-2.5 text-xs sm:text-sm font-sans font-normal tracking-wide text-stone-500 dark:text-slate-400 block break-words max-w-sm mx-auto leading-relaxed">
            خانه‌ای برای خوانندگان و نویسندگان. بخوانید، بنویسید و داستان‌های الهام‌بخش را به اشتراک بگذارید.
          </p>
          <nav className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-semibold" aria-label="اطلاعات حقوقی و شرکتی">
            {([
              ["terms-of-service", "شرایط خدمات"], ["rules", "قوانین"], ["privacy-policy", "حریم خصوصی"],
              ["dmca", "DMCA"], ["contact-us", "تماس با ما"], ["about-us", "دربارهٔ رپتوک"],
            ] as const).map(([view, label]) => (
              <a key={view} href={buildNavigationUrl({ activeView: view })} onClick={(event) => handleViewLink(event, view)} className="text-slate-500 hover:text-violet-500">{label}</a>
            ))}
          </nav>
          {/* Maker credit. The heart is decorative, so it carries an accessible
              label instead of being read out as "red heart" mid-sentence. */}
          <p className="mt-6 text-[11px] font-medium tracking-wide text-stone-500 dark:text-slate-500">
            ساخته شده با <span role="img" aria-label="عشق">❤️</span> توسط یک دیوار
          </p>
        </div>
      </footer>

      {/* Mobile Responsive Navigation Dock */}
      <div className={`mobile-fixed-chrome fixed bottom-0 left-0 w-full md:hidden border-t ${activeTheme.border} bg-[var(--app-header)] text-[var(--app-text)] z-40 px-1 pb-safe flex items-center justify-between backdrop-blur-md h-[72px] shadow-[0_-2px_12px_rgba(0,0,0,0.08)]`}>
        <div className="flex justify-evenly w-[44%] text-stone-400">
          <a
            href="/"
            onClick={(event) => handleViewLink(event, "dashboard")}
            aria-current={activeView === "dashboard" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer transition-all w-16 ${
              activeView === "dashboard" ? "text-violet-500 font-bold scale-105" : "hover:text-violet-400"
            }`}
          >
            <Home className="w-6 h-6 mb-0.5" />
            <span className="text-[10px] font-bold tracking-tight">خانه</span>
          </a>

          <a
            href="/ranking"
            onClick={(event) => handleViewLink(event, "ranking")}
            aria-current={activeView === "ranking" ? "page" : undefined}
            aria-label="مشاهده همهٔ رتبه‌بندی‌های رمان"
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer transition-all w-14 ${
              activeView === "ranking" ? "text-violet-500 font-bold scale-105" : "hover:text-violet-400"
            }`}
          >
            <Trophy className="w-6 h-6 mb-0.5" />
            <span className="text-[10px] font-bold tracking-tight">رتبه‌بندی</span>
          </a>

          <a
            href="/writer"
            onClick={(event) => handleViewLink(event, "writer")}
            aria-current={activeView === "writer" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer transition-all w-14 ${
              activeView === "writer" ? "text-violet-500 font-bold scale-105" : "hover:text-violet-400"
            }`}
          >
            <Feather className="w-6 h-6 mb-0.5" />
            <span className="text-[10px] font-bold tracking-tight">نوشتن</span>
          </a>
        </div>

        {/* Central Massive Discover Button */}
        <div className="relative flex justify-center w-[16%] mt-[-36px]">
          <a
            href="/discover"
            aria-label="کاوش"
            onClick={(event) => handleViewLink(event, "discover")}
            aria-current={activeView === "discover" ? "page" : undefined}
            className={`flex flex-col items-center justify-center w-[60px] h-[60px] rounded-full cursor-pointer transition-all shadow-[0_4px_20px_rgba(139,92,246,0.3)] bg-gradient-to-tr from-violet-600 via-purple-500 to-purple-500 text-white border-4 ${theme === 'dark' ? 'border-[#060409]' : 'border-white'} ${
              activeView === "discover" ? "scale-105 shadow-[0_4px_25px_rgba(139,92,246,0.6)]" : "hover:scale-105 active:scale-95"
            }`}
          >
            <Compass className={`w-[30px] h-[30px] ${activeView === "discover" ? "animate-pulse" : ""}`} />
          </a>
        </div>

        <div className="flex justify-evenly w-[44%] text-stone-400">
          <a
            href="/challenges"
            onClick={(event) => handleViewLink(event, "challenges")}
            aria-current={activeView === "challenges" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer transition-all w-14 ${
              activeView === "challenges" ? "text-violet-500 font-bold scale-105" : "hover:text-violet-400"
            }`}
          >
            <Target className="w-6 h-6 mb-0.5" />
            <span className="text-[10px] font-bold tracking-tight">چالش‌ها</span>
          </a>

          <a
            href="/bookmarks"
            onClick={(event) => handleViewLink(event, "bookmarks")}
            aria-current={activeView === "bookmarks" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer transition-all w-16 ${
              activeView === "bookmarks" ? "text-violet-500 font-bold scale-105" : "hover:text-violet-400"
            }`}
          >
            <BookMarked className="w-6 h-6 mb-0.5" />
            <span className="text-[10px] font-bold tracking-tight">نشانک‌ها</span>
          </a>

          <a
            href="/profile"
            onClick={(event) => handleViewLink(event, "profile")}
            aria-current={activeView === "profile" ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 cursor-pointer transition-all w-16 ${
              activeView === "profile" ? "text-violet-500 font-bold scale-105" : "hover:text-violet-400"
            }`}
          >
            <User className="w-6 h-6 mb-0.5" />
            <span className="text-[10px] font-bold tracking-tight">پروفایل</span>
          </a>
        </div>
      </div>

      {/* GLOBAL SEARCH DIALOG MODAL (Ctrl + K / Ctrl + F) */}
      {showRulesModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rules-modal-title">
          <button aria-label="بستن قوانین" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setShowRulesModal(false)} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} className={`relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716] text-white" : "bg-white text-stone-900"}`}>
            <div className="flex items-center justify-between border-b border-slate-800/20 p-5">
              <div><h2 id="rules-modal-title" className="text-xl font-black">قوانین و شرایط خدمات</h2><p className="mt-1 text-[10px] text-slate-500">لطفاً پیش از ساخت حساب، این شرایط را مطالعه کنید.</p></div>
              <button onClick={() => setShowRulesModal(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800/30 hover:text-white" aria-label="بستن"><X className="h-5 w-5" /></button>
            </div>
            <div className="rules-content overflow-y-auto p-5 text-sm leading-7 text-slate-400 md:p-7" dangerouslySetInnerHTML={{ __html: sanitizeInjectedHtml(AUTHOR_RULES_HTML) }} />
            <div className="border-t border-slate-800/20 p-4 text-right"><button onClick={() => setShowRulesModal(false)} className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-500">قوانین را خواندم</button></div>
          </motion.div>
        </div>
      )}

      {searchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
          {/* Backdrop */}
          <div 
            onClick={() => setSearchModalOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity duration-300"
          />

          {/* Modal box */}
          <div className={`w-full max-w-2xl rounded-2xl border ${activeTheme.border} ${theme === "dark" ? "bg-[#0b0716] text-white shadow-[0_0_50px_rgba(139,92,246,0.15)]" : "bg-white text-stone-900 shadow-2xl"} overflow-hidden z-10 relative flex flex-col max-h-[70vh]`}>
            {/* Head bar */}
            <div className="p-4 border-b border-slate-800/10 dark:border-violet-950/20 flex items-center justify-between gap-3 bg-black/5">
              <div className="flex items-center gap-3 flex-1">
                <Search className="w-5 h-5 text-violet-500 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  placeholder="جستجو بر اساس عنوان کتاب، نام نویسنده، ژانر یا توضیحات..."
                  value={globalSearchQuery}
                  onChange={(e) => setGlobalSearchQuery(e.target.value)}
                  className="w-full bg-transparent focus:outline-none text-xs md:text-sm font-semibold"
                />
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] font-mono font-bold text-slate-500 bg-slate-800/20 border border-slate-700/20 px-1.5 py-0.5 rounded">ESC</span>
                <button 
                  onClick={() => setSearchModalOpen(false)}
                  className="text-slate-400 hover:text-rose-500 p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search list results */}
            <div className="overflow-y-auto p-4 space-y-3 flex-grow max-h-[50vh]">
              {visibleGlobalSearchResults.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-mono text-xs">
                  <HelpCircle className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  {globalSearchQuery.trim().length < 2 ? "برای جستجو در رپتوک حداقل دو نویسه تایپ کنید." : `رمانی مطابق با «${globalSearchQuery}» پیدا نشد`}
                </div>
              ) : (
                visibleGlobalSearchResults
                  .map((novel) => (
                    <div
                      key={novel.id}
                      onClick={() => {
                        setSelectedNovelId(novel.id);
                        setActiveView("novel-details");
                        setSearchModalOpen(false);
                        setGlobalSearchQuery("");
                      }}
                      className={`flex gap-4 p-3 rounded-xl border cursor-pointer transition-all hover:border-violet-500 ${
                        theme === "dark" 
                          ? "bg-black/20 border-slate-900/60 hover:bg-black/50" 
                          : "bg-stone-50 border-stone-200 hover:bg-stone-100/50"
                      }`}
                    >
                      <SafeImage
                        src={novel.cover}
                        alt={novel.title}
                        referrerPolicy="no-referrer"
                        className="w-10 h-14 rounded object-cover border border-slate-800/10 flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-[9px] uppercase font-mono font-bold text-violet-500 tracking-wider">
                          {novel.genre}
                        </span>
                        <h4 className="font-extrabold text-xs md:text-sm truncate mt-0.5">{novel.title}</h4>
                        <p className="text-[10px] text-slate-500 leading-none mt-0.5">اثر {novel.author}</p>
                        <p className="text-[11px] text-slate-400 line-clamp-1 leading-normal mt-1.5">{novel.description}</p>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Hotkeys Footer tip */}
            <div className="p-3 bg-violet-500/5 border-t border-slate-800/10 dark:border-violet-950/20 text-[10px] font-mono text-slate-500 text-center">
              هر زمان <kbd className="font-extrabold text-violet-400">Ctrl + K</kbd> یا <kbd className="font-extrabold text-violet-400">Ctrl + F</kbd> را فشار دهید تا جستجو باز شود
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

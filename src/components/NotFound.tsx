import React from "react";
import { ArrowLeft, Home } from "lucide-react";

interface NotFoundProps {
  onNavigateHome?: () => void;
  title?: string;
  description?: string;
  searchEnabled?: boolean;
}

export function NotFound({
  onNavigateHome,
  title = "صفحه پیدا نشد",
  description = "صفحه‌ای که دنبال آن هستید وجود ندارد یا جابه‌جا شده است.",
  searchEnabled = false,
}: NotFoundProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        {/* 404 Number */}
        <div className="relative">
          <h1 className="text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-violet-600">
            404
          </h1>
          <div className="absolute inset-0 blur-3xl bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-violet-500/20 -z-10"></div>
        </div>

        {/* Title */}
        <div className="space-y-3">
          <h2 className="text-3xl font-bold text-white">{title}</h2>
          <p className="text-slate-400 text-base leading-relaxed">
            {description}
          </p>
        </div>

        {/* Decorative Line */}
        <div className="h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent"></div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={onNavigateHome}
            className="group flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-semibold rounded-lg transition-all duration-200 transform hover:scale-105 active:scale-95"
          >
            <Home className="w-5 h-5" />
            بازگشت به خانه
          </button>

          <button
            onClick={() => window.history.back()}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white border border-slate-700/50 hover:border-slate-600/50 font-semibold rounded-lg transition-all duration-200"
          >
            <ArrowLeft className="w-5 h-5" />
            بازگشت به صفحه قبل
          </button>
        </div>

        {/* Search Option */}
        {searchEnabled && (
          <div className="pt-4">
            <input
              type="text"
              placeholder="جستجوی رمان‌ها..."
              className="w-full px-4 py-2 bg-slate-900/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-colors"
            />
          </div>
        )}

        {/* Helpful Tips */}
        <div className="pt-4 space-y-2 text-left">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            این‌ها را امتحان کنید:
          </p>
          <ul className="space-y-1 text-sm text-slate-500">
            <li>• املای آدرس (URL) را بررسی کنید</li>
            <li>• ممکن است رمان حذف یا جابه‌جا شده باشد</li>
            <li>• برای مرور، به صفحه اصلی برگردید</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default NotFound;

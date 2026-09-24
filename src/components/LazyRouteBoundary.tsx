import React from "react";

/**
 * Error boundary for lazily loaded route chunks.
 *
 * `React.lazy` rejects when its chunk cannot be fetched, and an unhandled
 * rejection inside `Suspense` unmounts the whole tree — the page goes blank
 * with no message. That happens routinely after a deployment: the build writes
 * new content-hashed filenames and removes the previous ones, so any tab that
 * is still running the old `index-*.js` asks for a chunk that now returns 404.
 *
 * A stale chunk is recovered by reloading once (the fresh HTML references the
 * new hashes). The one-shot marker in `sessionStorage` prevents a reload loop
 * when the failure is not caused by a stale deployment.
 */
const RELOAD_MARKER = "reptoc-chunk-reload";

function isChunkLoadFailure(error: unknown): boolean {
  const message = String((error as any)?.message || error || "");
  return /Loading chunk|Importing a module script failed|Failed to fetch dynamically imported module|dynamically imported module|ChunkLoadError/i.test(message);
}

interface LazyRouteBoundaryProps {
  children: React.ReactNode;
  /** Shown while the chunk is downloading. */
  fallback: React.ReactNode;
  /** Human-readable section name used in the failure message. */
  label: string;
}

interface LazyRouteBoundaryState {
  failed: boolean;
  stale: boolean;
}

export default class LazyRouteBoundary extends React.Component<LazyRouteBoundaryProps, LazyRouteBoundaryState> {
  declare props: LazyRouteBoundaryProps;
  state: LazyRouteBoundaryState = { failed: false, stale: false };
  private reloadMarkerTimer?: number;

  static getDerivedStateFromError(error: unknown): LazyRouteBoundaryState {
    return { failed: true, stale: isChunkLoadFailure(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`Failed to load the "${this.props.label}" section:`, error);
    if (!isChunkLoadFailure(error)) return;
    let alreadyReloaded = false;
    try {
      alreadyReloaded = window.sessionStorage.getItem(RELOAD_MARKER) === "1";
      window.sessionStorage.setItem(RELOAD_MARKER, "1");
    } catch {
      // Private browsing can deny sessionStorage; fall back to the manual button.
    }
    if (!alreadyReloaded) window.location.reload();
  }

  componentDidMount() {
    // Keep the marker through the lazy import window. Clearing it immediately
    // allowed a missing chunk to trigger an endless refresh loop because the
    // boundary itself mounts before its Suspense child finishes loading.
    this.reloadMarkerTimer = window.setTimeout(() => {
      if (this.state.failed) return;
      try { window.sessionStorage.removeItem(RELOAD_MARKER); } catch {}
    }, 5000);
  }

  componentWillUnmount() {
    if (this.reloadMarkerTimer) window.clearTimeout(this.reloadMarkerTimer);
  }

  render() {
    if (!this.state.failed) {
      return <React.Suspense fallback={this.props.fallback}>{this.props.children}</React.Suspense>;
    }

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-16 text-center" role="alert">
        <h2 className="text-lg font-bold">{this.props.label} بارگذاری نشد</h2>
        <p className="max-w-sm text-xs text-slate-400">
          {this.state.stale
            ? "نسخهٔ جدیدی از سایت منتشر شده است. برای بارگذاری این بخش صفحه را تازه‌سازی کنید."
            : "بارگذاری این بخش ناموفق بود. اتصال خود را بررسی کنید و دوباره تلاش کنید."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl border border-violet-500 px-5 py-2 text-xs font-bold text-violet-400 transition-colors hover:bg-violet-500 hover:text-white"
        >
          تازه‌سازی صفحه
        </button>
      </div>
    );
  }
}

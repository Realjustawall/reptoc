import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig(async () => {
  const hmrEnabled = process.env.DISABLE_HMR !== 'true' && process.env.VITE_ENABLE_HMR === 'true';
  const plugins = [
    react(),
    {
      name: 'cloudflare-rocket-loader-exclusions',
      transformIndexHtml: {
        order: 'post' as const,
        handler(html: string) {
          // Vite replaces the source entry tag during production builds and
          // otherwise drops its custom attribute. Restore the Cloudflare
          // opt-out before `src`, as required by Rocket Loader.
          return html.replace(
            /<script\b(?![^>]*\bdata-cfasync=)([^>]*\btype=["']module["'][^>]*)>/gi,
            '<script data-cfasync="false"$1>',
          );
        },
      },
    },
  ];

  try {
    const tailwindModule = await import('@tailwindcss/vite');
    const tailwindcss = tailwindModule.default;
    plugins.push(tailwindcss());
  } catch (error: any) {
    console.warn(`[vite] @tailwindcss/vite unavailable; continuing without the Vite Tailwind plugin. ${error?.message || ""}`.trim());
  }

  return {
    plugins,
    build: {
      // Keep previous content-hashed chunks during deployment. Open tabs may
      // still request them, and deleting the whole client directory before the
      // new index exists also makes direct routes briefly return 503.
      emptyOutDir: false,
      // Vite's default target is intentionally very modern. Explicitly compile
      // for older WebKit versions still found on supported iPhones and iPads.
      target: ['es2018', 'safari12'],
      cssTarget: 'safari12',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // ✅ SECURITY: Explicit allowlist. Empty array would block all hosts;
      // undefined (default) would allow any. We pin the canonical hosts.
      allowedHosts: ['reptoc.ir', 'www.reptoc.ir', 'localhost', '127.0.0.1'],
      fs: {
        allow: [path.resolve(__dirname), searchForWorkspaceRoot(process.cwd())],
        // ✅ SECURITY: Also deny secrets files, private keys, and dotfiles.
        deny: ['.env', '.env.*', '*.pem', '*.key', '*.crt', '*.p12', '*.pfx', '.npmrc', '.git-credentials'],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // File watching stays disabled when DISABLE_HMR is true to keep edits stable.
      hmr: hmrEnabled,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // ✅ SECURITY: Disable the auto-open browser feature in dev to prevent
      // accidental launches of browser windows on shared dev machines.
      open: false,
      // ✅ SECURITY: Restrict CORS in dev to the same hosts as `allowedHosts`.
      cors: {
        origin: ['http://localhost:3000', 'http://localhost:5174', 'http://127.0.0.1:3000', 'http://127.0.0.1:5174'],
        credentials: true,
      },
    },
  };
});

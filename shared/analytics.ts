export const GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-Z6JQRFRDDX";

export const GOOGLE_ANALYTICS_SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`;

/**
 * The exact inline bootstrap that ships inside `index.html`.
 *
 * The application CSP authorizes inline scripts by hash, so this text and the
 * `<script>` body in `index.html` must stay byte-identical. `server.ts` also
 * hashes every inline script found in the served shell at boot, so a future
 * edit to `index.html` can never lock the page out of its own bootstrap.
 */
export const GOOGLE_ANALYTICS_INLINE_SCRIPT = `window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${GOOGLE_ANALYTICS_MEASUREMENT_ID}');`;

export const GOOGLE_ANALYTICS_CODE = `<script async src="${GOOGLE_ANALYTICS_SCRIPT_URL}"></script>
<script>${GOOGLE_ANALYTICS_INLINE_SCRIPT}</script>`;

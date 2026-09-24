import { chromium } from "playwright";

const novelId = "usr-u-1785152366782-6359-ms389lqb-546f24f5";
const chapterIds = [
  "chap-usr-u-1785152366782-6359-ms389lqb-546f24f5-1-ms389lqb-ivnd3f",
  "chap-usr-u-1785152366782-6359-ms389lqb-546f24f5-2-ms393lq1-cav07h",
];
const baseUrl = process.env.AD_TEST_BASE_URL || "http://127.0.0.1:5174";
const homepageUrl = `${baseUrl}/`;
const novelUrl = `${baseUrl}/novels/${encodeURIComponent(novelId)}`;
const chapterUrl = (chapterId) => `${baseUrl}/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`;
const adsenseScriptUrl = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5953906561935245";
const suppliedHomepageUnitId = "ad-unit-adsterra-chapter-end-rectangle-300x250";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const network = [];
const consoleMessages = [];
const popupPages = [];
const retiredPopupRequests = [];
const providerResponses = [];

context.on("page", (openedPage) => {
  if (openedPage !== page) popupPages.push(openedPage.url());
});
page.on("request", (request) => {
  if (/nap5k|11451688|11451890|omg10\.com\/4\//i.test(request.url())) retiredPopupRequests.push(request.url());
});

page.on("response", (response) => {
  const responseUrl = new URL(response.url());
  if (responseUrl.hostname !== new URL(baseUrl).hostname) {
    providerResponses.push({
      status: response.status(),
      url: response.url(),
      contentType: response.headers()["content-type"] || null,
    });
  }
  if (/\/api\/ads|highperformanceformat/i.test(response.url())) {
    const item = { status: response.status(), url: response.url(), bodyBytes: null };
    network.push(item);
    if (/highperformanceformat/i.test(response.url())) {
      void response.body().then((body) => { item.bodyBytes = body.length; }).catch(() => {});
    }
  }
});
page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
});

async function snapshot(label, expectSuppliedHomepageAd = false) {
  await page.locator("main").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1_000);
  const inlineSmartLinkBannerCount = await page.locator("[data-smartlink-banner]").count();
  const popupTagCount = await page.locator('script[data-zone="11432701"], script[data-zone="11451688"], script[src*="3nbf4.com"], script[src*="nap5k.com"]').count();
  const adsenseTagCount = await page.locator(`script[src="${adsenseScriptUrl}"]`).count();
  const suppliedHomepageAdCount = await page.locator(`iframe[data-ad-loader="server-frame"][src*="${suppliedHomepageUnitId}"]`).count();
  if (inlineSmartLinkBannerCount !== 0 || popupTagCount !== 0 || adsenseTagCount !== 1 || retiredPopupRequests.length !== 0 || (expectSuppliedHomepageAd && suppliedHomepageAdCount !== 1)) {
    throw new Error(`Invalid ad state on ${page.url()}: ${JSON.stringify({ inlineSmartLinkBannerCount, popupTagCount, adsenseTagCount, retiredPopupRequests, suppliedHomepageAdCount })}`);
  }
  await page.screenshot({ path: `/tmp/${label}.png`, fullPage: true });
  return {
    pageUrl: page.url(),
    inlineSmartLinkBannerCount,
    popupTagCount,
    adsenseTagCount,
    suppliedHomepageAdCount,
    fixedBannerCount: await page.locator('[data-ad-loader="provider-script"], iframe[data-ad-loader="server-frame"]').count(),
  };
}

async function chapterSnapshot(label) {
  return snapshot(label);
}

await page.goto(homepageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
const homepage = await snapshot("homepage-supplied-ad", true);

await page.goto(novelUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
const novel = await snapshot("novel-without-handmade-banner");

await page.goto(chapterUrl(chapterIds[0]), { waitUntil: "domcontentloaded", timeout: 30_000 });
const first = await chapterSnapshot("chapter-adsense-first");

await page.getByRole("button", { name: /Ch 2: Next/i }).click();
await page.waitForURL((url) => url.pathname.includes(chapterIds[1]), { timeout: 20_000 });
const second = await chapterSnapshot("chapter-adsense-second");

console.log(JSON.stringify({
  homepage,
  novel,
  first,
  second,
  network,
  consoleMessages,
  popupPages,
  retiredPopupRequests,
  providerResponses,
}, null, 2));
await browser.close();

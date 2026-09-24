import React from "react";
import { BookOpen, Download, Trash2, WifiOff } from "lucide-react";
import { listOfflineChapters, removeChapterOffline, type OfflineChapterRecord } from "../utils/offlineLibrary";

export default function OfflineDownloads({ theme, onRead }: { theme: "light" | "dark"; onRead: (novelId: string, chapterId: string) => void }) {
  const [items, setItems] = React.useState<OfflineChapterRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const load = React.useCallback(() => listOfflineChapters().then(setItems).catch(() => setMessage("خواندن دانلودها انجام نشد.")).finally(() => setLoading(false)), []);
  React.useEffect(() => { void load(); }, [load]);
  const remove = async (item: OfflineChapterRecord) => {
    await removeChapterOffline(item.novel.id, item.chapter.id);
    setItems((current) => current.filter((row) => row.id !== item.id));
    setMessage("فصل از دانلودهای آفلاین حذف شد.");
  };
  const card = theme === "dark" ? "border-slate-800 bg-[#080914]" : "border-stone-200 bg-white";
  return <div className="mx-auto max-w-5xl space-y-5 pb-24">
    <section className={`rounded-3xl border p-6 ${card}`}>
      <div className="flex items-center gap-3"><div className="rounded-2xl bg-violet-500/10 p-3 text-violet-500"><WifiOff className="h-6 w-6" /></div><div><h1 className="text-xl font-black">مطالعه آفلاین</h1><p className="mt-1 text-xs text-slate-500">فصل‌های دانلودشده بدون اینترنت روی همین دستگاه در دسترس‌اند.</p></div></div>
    </section>
    {message && <p role="status" className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-xs font-bold text-violet-500">{message}</p>}
    {loading ? <p className="py-12 text-center text-sm text-slate-500">در حال خواندن دانلودها…</p> : items.length === 0 ? <div className={`rounded-3xl border p-12 text-center ${card}`}><Download className="mx-auto h-10 w-10 text-violet-500/40" /><p className="mt-3 text-sm font-bold">هنوز فصلی دانلود نشده است.</p><p className="mt-1 text-xs text-slate-500">داخل صفحه مطالعه، دکمه «آفلاین» را بزنید.</p></div> : <div className="grid gap-3 sm:grid-cols-2">{items.map((item) => <article key={item.id} className={`rounded-2xl border p-4 ${card}`}><p className="text-[10px] font-bold text-violet-500">{item.novel.title}</p><h2 className="mt-1 text-sm font-black">فصل {item.chapter.chapterNumber}: {item.chapter.title}</h2><p className="mt-2 text-[10px] text-slate-500">ذخیره: {new Date(item.downloadedAt).toLocaleString("fa-IR")}</p><div className="mt-4 flex gap-2"><button onClick={() => onRead(item.novel.id, item.chapter.id)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white hover:bg-violet-500"><BookOpen className="h-4 w-4" />مطالعه</button><button onClick={() => void remove(item)} className="rounded-xl border border-rose-500/30 px-3 text-rose-500 hover:bg-rose-500/10" aria-label={`حذف ${item.chapter.title}`}><Trash2 className="h-4 w-4" /></button></div></article>)}</div>}
  </div>;
}

import React, { useState, useEffect } from "react";
import { BookMarked, FolderPlus, Trash2, Edit2, Play, Settings2, Grid, List, Folder, Plus, X, Globe2, Lock } from "lucide-react";
import { Novel } from "../types";
import { api } from "../utils/api";
import SafeImage from "./SafeImage";

function normalizeBookmarkCategories(categories: any[]) {
  return (Array.isArray(categories) ? categories : []).map((category: any, index: number) => ({
    id: category?.id || `cat-${index + 1}`,
    name: category?.name || `دسته ${index + 1}`,
    items: Array.isArray(category?.items) ? category.items : Array.isArray(category?.ids) ? category.ids : []
  }));
}

interface BookmarksProps {
  theme: "light" | "dark";
  novels: Novel[];
  bookmarkedIds: string[];
  onResumeReading: (novelId: string) => void;
  onBookmarkedIdsChange?: (ids: string[]) => void;
  currentUser: any;
  onLoginClick?: () => void;
}

export default function Bookmarks({ theme, novels, bookmarkedIds, onResumeReading, onBookmarkedIdsChange, currentUser, onLoginClick }: BookmarksProps) {
  const isDark = theme === "dark";
  const [categories, setCategories] = useState<{ id: string; name: string; items: string[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [addBookQuery, setAddBookQuery] = useState("");
  const [addBookCategoryId, setAddBookCategoryId] = useState("");
  const [bookmarkError, setBookmarkError] = useState("");
  const [busyNovelIds, setBusyNovelIds] = useState<Set<string>>(() => new Set());
  const [libraryItems, setLibraryItems] = useState<Record<string, any>>({});

  // Inline prompts state
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  // Load Categories on mount
  useEffect(() => {
    let cancelled = false;
    if (currentUser) {
      setLibraryLoaded(false);
      onBookmarkedIdsChange?.([]);
      setCategories([]);
      setLibraryItems({});
      setLoading(true);
      const token = api.getToken();
      if (token) {
        api.getLibrary(token).then((items) => {
          if (cancelled) return;
          setLibraryItems(Object.fromEntries(items.map((item: any) => [String(item.novel_id || ""), item])));
          onBookmarkedIdsChange?.(items.map((item: any) => String(item.novel_id || "")).filter(Boolean));
          setLibraryLoaded(true);
        }).catch(() => {
          if (!cancelled) {
            onBookmarkedIdsChange?.([]);
            setLibraryLoaded(true);
          }
        });
        api.getBookmarkCategories(token).then((cats) => {
          if (cancelled) return;
          const normalized = normalizeBookmarkCategories(cats);
          if (normalized.length > 0) {
            setCategories(normalized);
          } else {
            setCategories([{ id: "cat-1", name: "بعداً بخوان", items: [] }]);
          }
          setLoading(false);
        }).catch(() => {
          if (cancelled) return;
          setCategories([{ id: "cat-1", name: "بعداً بخوان", items: [] }]);
          setLoading(false);
        });
      } else {
        onBookmarkedIdsChange?.([]);
        setLibraryLoaded(true);
        setCategories([{ id: "cat-1", name: "بعداً بخوان", items: [] }]);
        setLoading(false);
      }
    } else {
      onBookmarkedIdsChange?.([]);
      setLibraryItems({});
      setLibraryLoaded(true);
      setCategories([{ id: "cat-1", name: "بعداً بخوان", items: [] }]);
    }
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const saveCategories = async (newCats: any[]) => {
    const normalized = normalizeBookmarkCategories(newCats);
    setCategories(normalized);
    if (currentUser) {
      const token = api.getToken();
      if (token) {
        const saved = await api.saveBookmarkCategories(token, normalized);
        if (!saved) setBookmarkError("دسته‌های نشانک به‌صورت آنلاین ذخیره نشدند.");
      }
    }
  };

  const setNovelBusy = (novelId: string, busy: boolean) => {
    setBusyNovelIds((current) => {
      const next = new Set(current);
      if (busy) next.add(novelId);
      else next.delete(novelId);
      return next;
    });
  };

  const handleCreateCategory = () => {
    setIsCreatingCategory(true);
  };

  const confirmCreateCategory = async () => {
    if (!newCategoryName || !newCategoryName.trim()) {
      setIsCreatingCategory(false);
      return;
    }
    const newCat = { id: `cat-${Date.now()}`, name: newCategoryName.trim(), items: [] };
    await saveCategories([...categories, newCat]);
    setNewCategoryName("");
    setIsCreatingCategory(false);
  };

  const handleDeleteCategory = (id: string) => {
    if (categories.length === 1) {
      // we need at least one category, silently fail or we could show an inline toast. 
      return;
    }
    setDeletingCategoryId(id);
  };

  const confirmDeleteCategory = async () => {
    if (deletingCategoryId) {
      await saveCategories(categories.filter(c => c.id !== deletingCategoryId));
      setDeletingCategoryId(null);
    }
  };

  const handleEditCategory = (id: string, oldName: string) => {
    setEditingCategoryId(id);
    setEditCategoryName(oldName);
  };

  const confirmEditCategory = async () => {
    if (!editCategoryName || !editCategoryName.trim() || !editingCategoryId) {
      setEditingCategoryId(null);
      return;
    }
    const newCats = categories.map(c => c.id === editingCategoryId ? { ...c, name: editCategoryName.trim() } : c);
    await saveCategories(newCats);
    setEditingCategoryId(null);
  };

  const handleMoveToCategory = async (novelId: string, targetCatId: string) => {
    if (!currentUser) {
      onLoginClick?.();
      return;
    }
    setBookmarkError("");
    const newCats = categories.map(c => {
      const existingItems = Array.isArray(c.items) ? c.items : [];
      const cleanItems = existingItems.filter(item => item !== novelId);
      if (c.id === targetCatId) {
        return { ...c, items: [...cleanItems, novelId] };
      }
      return { ...c, items: cleanItems };
    });
    await saveCategories(newCats);
    const token = api.getToken();
    if (currentUser && token) {
      const items = await api.updateLibraryItem(token, novelId, {
        shelfStatus: "plan_to_read",
        categoryId: targetCatId || null,
        visibility: libraryItems[novelId]?.visibility === "public" ? "public" : "private"
      });
      if (!items.length) setBookmarkError("کتاب به‌صورت محلی منتقل شد، اما همگام‌سازی کتابخانهٔ آنلاین ناموفق بود.");
      else setLibraryItems(Object.fromEntries(items.map((item: any) => [String(item.novel_id || ""), item])));
    }
  };

  const handleAddBookToLibrary = async (novelId: string) => {
    if (!currentUser) {
      onLoginClick?.();
      return;
    }
    setBookmarkError("");
    setNovelBusy(novelId, true);
    const nextIds = bookmarkedIds.includes(novelId) ? bookmarkedIds : [...bookmarkedIds, novelId];
    onBookmarkedIdsChange?.(nextIds);

    if (currentUser) {
      const token = api.getToken();
      if (token) {
        const serverIds = await api.toggleBookmark(token, novelId, true);
        if (serverIds) onBookmarkedIdsChange?.(serverIds);
        else {
          onBookmarkedIdsChange?.(bookmarkedIds);
          setBookmarkError("کتاب به کتابخانهٔ آنلاین شما اضافه نشد.");
          setNovelBusy(novelId, false);
          return;
        }
      }
    }

    if (addBookCategoryId) {
      await handleMoveToCategory(novelId, addBookCategoryId);
    }
    setIsAddingBook(false);
    setAddBookQuery("");
    setNovelBusy(novelId, false);
  };

  const handleRemoveFromLibrary = async (novelId: string) => {
    if (!currentUser) {
      onLoginClick?.();
      return;
    }
    setBookmarkError("");
    setNovelBusy(novelId, true);
    const nextIds = bookmarkedIds.filter((id) => id !== novelId);
    onBookmarkedIdsChange?.(nextIds);
    const nextCats = categories.map((category) => ({
      ...category,
      items: category.items.filter((item) => item !== novelId)
    }));
    setCategories(nextCats);

    if (currentUser) {
      const token = api.getToken();
      if (token) {
        const serverIds = await api.toggleBookmark(token, novelId, false);
        if (serverIds) onBookmarkedIdsChange?.(serverIds);
        else setBookmarkError("کتاب به‌صورت محلی حذف شد، اما همگام‌سازی کتابخانهٔ آنلاین ناموفق بود.");
        await api.saveBookmarkCategories(token, nextCats);
      }
    }
    setNovelBusy(novelId, false);
  };

  const handleVisibilityChange = async (novelId: string, visibility: "private" | "public") => {
    const token = api.getToken();
    if (!currentUser || !token) {
      onLoginClick?.();
      return;
    }
    setBookmarkError("");
    setNovelBusy(novelId, true);
    const current = libraryItems[novelId] || {};
    const items = await api.updateLibraryItem(token, novelId, {
      shelfStatus: current.shelf_status || "plan_to_read",
      categoryId: current.category_id ?? null,
      notes: current.notes ?? null,
      visibility
    });
    if (!items.length) {
      setBookmarkError("وضعیت نمایش نشانک به‌روزرسانی نشد.");
    } else {
      setLibraryItems(Object.fromEntries(items.map((item: any) => [String(item.novel_id || ""), item])));
    }
    setNovelBusy(novelId, false);
  };

  const privateBookmarkedIds = currentUser && libraryLoaded ? bookmarkedIds : [];
  const bookmarkedNovels = novels.filter(n => privateBookmarkedIds.includes(n.id));
  const availableNovels = novels
    .filter((novel) => !privateBookmarkedIds.includes(novel.id))
    .filter((novel) => {
      const q = addBookQuery.trim().toLowerCase();
      if (!q) return true;
      return [novel.title, novel.author, novel.genre].some((value) => String(value || "").toLowerCase().includes(q));
    })
    .slice(0, 12);

  // Find uncategorized
  const allCategorizedElements = new Set(categories.flatMap(c => c.items));
  const uncategorizedItems = privateBookmarkedIds.filter(id => !allCategorizedElements.has(id));

  return (
    <div className="space-y-8 pb-16 pt-6 animate-in fade-in zoom-in-95 duration-300">
      
      {/* Inline Creation Prompt */}
      {isCreatingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`p-6 rounded-2xl border w-full max-w-sm ${isDark ? "bg-black border-slate-800" : "bg-white border-slate-200"}`}>
            <h3 className="text-lg font-bold mb-4">ایجاد دستهٔ جدید</h3>
            <input 
              autoFocus
              type="text" 
              value={newCategoryName} 
              onChange={e => setNewCategoryName(e.target.value)} 
              placeholder="نام دسته"
              className={`w-full p-3 rounded-xl mb-4 border ${isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-slate-50 border-slate-200"}`}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setIsCreatingCategory(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">انصراف</button>
              <button onClick={confirmCreateCategory} className="px-4 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-500">ایجاد</button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Edit Prompt */}
      {editingCategoryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`p-6 rounded-2xl border w-full max-w-sm ${isDark ? "bg-black border-slate-800" : "bg-white border-slate-200"}`}>
            <h3 className="text-lg font-bold mb-4">ویرایش دسته</h3>
            <input 
              autoFocus
              type="text" 
              value={editCategoryName} 
              onChange={e => setEditCategoryName(e.target.value)} 
              placeholder="نام دسته"
              className={`w-full p-3 rounded-xl mb-4 border ${isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-slate-50 border-slate-200"}`}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingCategoryId(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">انصراف</button>
              <button onClick={confirmEditCategory} className="px-4 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-500">ذخیره</button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Delete Prompt */}
      {deletingCategoryId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`p-6 rounded-2xl border w-full max-w-sm ${isDark ? "bg-black border-slate-800" : "bg-white border-slate-200"}`}>
            <h3 className="text-lg font-bold text-rose-500 mb-2">حذف دسته؟</h3>
            <p className="text-sm text-slate-500 mb-6">از حذف این دسته مطمئن هستید؟ کتاب‌های داخل آن به «بدون دسته» منتقل می‌شوند.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeletingCategoryId(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">انصراف</button>
              <button onClick={confirmDeleteCategory} className="px-4 py-2 rounded-xl text-sm font-bold bg-rose-600 text-white hover:bg-rose-500">حذف</button>
            </div>
          </div>
        </div>
      )}

      {isAddingBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`p-6 rounded-2xl border w-full max-w-lg ${isDark ? "bg-black border-slate-800" : "bg-white border-slate-200"}`}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold">افزودن کتاب به کتابخانه</h3>
                <p className="text-xs text-slate-500 mt-1">رمان‌های موجود را جست‌وجو کنید و یکی را در کتابخانه‌تان ذخیره کنید.</p>
              </div>
              <button onClick={() => setIsAddingBook(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_180px] mb-4">
              <input
                autoFocus
                type="text"
                value={addBookQuery}
                onChange={(e) => setAddBookQuery(e.target.value)}
                placeholder="جست‌وجوی عنوان، نویسنده یا ژانر"
                className={`w-full p-3 rounded-xl border text-sm ${isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-slate-50 border-slate-200"}`}
              />
              <select
                value={addBookCategoryId}
                onChange={(e) => setAddBookCategoryId(e.target.value)}
                className={`w-full p-3 rounded-xl border text-sm ${isDark ? "bg-slate-900 border-slate-700 text-white" : "bg-slate-50 border-slate-200"}`}
              >
                <option value="">بدون دسته</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {availableNovels.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 border border-dashed border-slate-700 rounded-xl">
                  کتابی پیدا نشد.
                </div>
              ) : availableNovels.map((novel) => (
                <button
                  key={novel.id}
                  onClick={() => handleAddBookToLibrary(novel.id)}
                  disabled={busyNovelIds.has(novel.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-slate-950 border-slate-800 hover:border-violet-500" : "bg-stone-50 border-stone-200 hover:border-violet-500"}`}
                >
                  <SafeImage src={novel.cover || novel.coverUrl} alt={novel.title} className="w-10 h-14 rounded object-cover bg-slate-800" />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm truncate">{novel.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">{novel.author} · {novel.genre}</div>
                  </div>
                  <Plus className="w-4 h-4 text-violet-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold flex items-center gap-2">
            <BookMarked className="w-8 h-8 text-violet-500" />
            <span>نشانک‌های من</span>
          </h1>
          <p className="text-sm text-slate-500">داستان‌های مورد علاقه‌تان را در فهرست‌های دلخواه سازمان‌دهی کنید.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded-lg transition-colors ${viewMode === "grid" ? "bg-violet-600 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-500"}`}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setViewMode("list")}
            className={`p-2 rounded-lg transition-colors ${viewMode === "list" ? "bg-violet-600 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-500"}`}
          >
            <List className="w-4 h-4" />
          </button>
          <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 mx-2" />
          <button onClick={() => setIsAddingBook(true)} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-all text-xs">
            <Plus className="w-4 h-4" />
            <span>افزودن کتاب</span>
          </button>
          <button onClick={handleCreateCategory} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg transition-all text-xs">
            <FolderPlus className="w-4 h-4" />
            <span>دستهٔ جدید</span>
          </button>
        </div>
      </div>

      {!currentUser && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-xl text-xs font-bold">
          توجه: شما وارد نشده‌اید. نشانک‌ها و دسته‌ها به‌صورت آنلاین ذخیره نمی‌شوند.
        </div>
      )}

      {bookmarkError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs font-bold">
          {bookmarkError}
        </div>
      )}

      {bookmarkedNovels.length === 0 ? (
        <div className="p-16 border-2 border-dashed border-slate-300 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-20 h-20 bg-violet-500/10 rounded-full flex items-center justify-center">
            <BookMarked className="w-10 h-10 text-violet-500" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">کتابخانه‌تان کاملاً خالی است.</h2>
          {currentUser ? (
            <p className="text-slate-500 text-sm max-w-sm">
              به بخش کشف کردن بروید و روی آیکون نشانک هر رمان بزنید تا برای مطالعهٔ آفلاین یا پیگیری، اینجا ذخیره شود.
            </p>
          ) : (
            <>
              <p className="text-slate-500 text-sm font-medium">
                برای استفاده از این قابلیت وارد شوید
              </p>
              <button 
                onClick={onLoginClick}
                className="mt-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl transition-all"
              >
                ورود
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Categories */}
          {categories.map(cat => {
            const catItems = bookmarkedNovels.filter(n => cat.items.includes(n.id));
            return (
              <div key={cat.id} className={`p-5 rounded-2xl border ${isDark ? "bg-[#0e0a1c]/50 border-slate-800" : "bg-stone-50 border-stone-200"}`}>
                <div className="flex items-center justify-between mb-4 border-b border-slate-800/10 pb-3">
                  <h3 className="font-bold flex items-center gap-2">
                    <Folder className="w-5 h-5 text-purple-400" />
                    <span>{cat.name}</span>
                    <span className="text-xs bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-500">{catItems.length}</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleEditCategory(cat.id, cat.name)} className="p-1.5 text-slate-400 hover:text-violet-500 hover:bg-violet-500/10 rounded">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDeleteCategory(cat.id)} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {catItems.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4">کتابی در این دسته نیست.</p>
                ) : (
                  <div className={viewMode === "grid" ? "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4" : "space-y-3"}>
                    {catItems.map(novel => (
                      <NovelCard 
                        key={novel.id} 
                        novel={novel} 
                        viewMode={viewMode} 
                        onResumeReading={() => onResumeReading(novel.id)} 
                        categories={categories}
                        currentCatId={cat.id}
                        onMove={(targetId) => handleMoveToCategory(novel.id, targetId)}
                        onRemove={() => handleRemoveFromLibrary(novel.id)}
                        visibility={libraryItems[novel.id]?.visibility === "public" ? "public" : "private"}
                        onVisibilityChange={(visibility) => handleVisibilityChange(novel.id, visibility)}
                        busy={busyNovelIds.has(novel.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Uncategorized Items */}
          {uncategorizedItems.length > 0 && (
            <div className={`p-5 rounded-2xl border ${isDark ? "bg-[#0e0a1c]/50 border-slate-800" : "bg-stone-50 border-stone-200"}`}>
              <div className="flex items-center justify-between mb-4 border-b border-slate-800/10 pb-3">
                <h3 className="font-bold flex items-center gap-2">
                  <Folder className="w-5 h-5 text-slate-500" />
                  <span>نشانک‌های بدون دسته</span>
                  <span className="text-xs bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-500">{uncategorizedItems.length}</span>
                </h3>
              </div>
              <div className={viewMode === "grid" ? "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4" : "space-y-3"}>
                {bookmarkedNovels.filter(n => uncategorizedItems.includes(n.id)).map(novel => (
                   <NovelCard 
                    key={novel.id} 
                    novel={novel} 
                    viewMode={viewMode} 
                    onResumeReading={() => onResumeReading(novel.id)} 
                    categories={categories}
                    currentCatId=""
                    onMove={(targetId) => handleMoveToCategory(novel.id, targetId)}
                    onRemove={() => handleRemoveFromLibrary(novel.id)}
                    visibility={libraryItems[novel.id]?.visibility === "public" ? "public" : "private"}
                    onVisibilityChange={(visibility) => handleVisibilityChange(novel.id, visibility)}
                    busy={busyNovelIds.has(novel.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NovelCard({ novel, viewMode, onResumeReading, categories, currentCatId, onMove, onRemove, visibility, onVisibilityChange, busy }: {
  key?: React.Key;
  novel: Novel, viewMode: "grid"| "list", onResumeReading: () => void, categories: any[], currentCatId: string, onMove: (id: string) => void, onRemove: () => void, visibility: "private" | "public", onVisibilityChange: (visibility: "private" | "public") => void, busy?: boolean
}) {
  return (
    <div className={`group relative rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-black/40 hover:border-violet-500 transition-all ${
      viewMode === "list" ? "flex items-center gap-4 p-3" : "flex flex-col"
    }`}>
      <div className={`bg-slate-800 overflow-hidden shrink-0 ${viewMode === "list" ? "w-16 h-20 rounded shadow" : "w-full aspect-[2/3]"}`}>
         <SafeImage src={novel.coverUrl || novel.cover} alt={novel.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      </div>
      <div className={`flex flex-col flex-grow ${viewMode === "list" ? "" : "p-3"}`}>
        <h4 className="font-bold text-sm tracking-tight line-clamp-1">{novel.title}</h4>
        <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{novel.author}</p>
        
        <div className={`mt-3 flex items-center justify-between ${viewMode === "list" ? "ml-auto" : ""}`}>
          <button 
            onClick={onResumeReading}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded font-bold text-[10px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-3 h-3" />
            <span>{busy ? "در حال ذخیره" : "ادامه مطالعه"}</span>
          </button>

          <div className="relative group/dropdown">
             <button className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors">
                <Settings2 className="w-4 h-4" />
             </button>
             <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-[#0e0a1c] border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl opacity-0 invisible group-hover/dropdown:opacity-100 group-hover/dropdown:visible transition-all z-20">
                 <div className="p-2 space-y-1">
                  <p className="text-[9px] font-mono font-bold text-slate-500 uppercase px-2 py-1">انتقال به...</p>
                  {categories.map(c => (
                    <button 
                      key={c.id} 
                      onClick={() => onMove(c.id)}
                      disabled={busy || c.id === currentCatId}
                      className="w-full text-left px-2 py-1.5 text-[10px] rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      {c.name}
                    </button>
                  ))}
                  <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
                  <button
                    onClick={() => onVisibilityChange(visibility === "public" ? "private" : "public")}
                    disabled={busy}
                    className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-[10px] rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    {visibility === "public" ? <Globe2 className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3 text-slate-500" />}
                    {visibility === "public" ? "عمومی — خصوصی کردن" : "خصوصی — عمومی کردن"}
                  </button>
                  <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />
                  <button
                    onClick={onRemove}
                    disabled={busy}
                    className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-[10px] rounded text-rose-500 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3 h-3" />
                    حذف از کتابخانه
                  </button>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

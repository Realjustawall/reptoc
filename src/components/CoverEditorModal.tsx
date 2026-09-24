import React, { useState, useRef, useEffect } from "react";
import ReactCrop, { Crop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { X, Image as ImageIcon, Type, PaintBucket, Check, Download, Layers, Sparkles } from "lucide-react";
import { api } from "../utils/api";
import { imageDataUrlToBlob, uploadImageBlob } from "../utils/imageUpload";

interface CoverEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (coverDataUrl: string) => void | Promise<void>;
  initialTitle?: string;
  initialAuthor?: string;
}

const MAX_UPLOADED_COVER_WIDTH = 900;
const MAX_UPLOADED_COVER_HEIGHT = 1200;

export default function CoverEditorModal({ isOpen, onClose, onSave, initialTitle, initialAuthor }: CoverEditorModalProps) {
  const [mode, setMode] = useState<"upload" | "create">("upload");
  // Upload State
  const [imgSrc, setImgSrc] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>({
    unit: "%",
    width: 50,
    height: 75,
    x: 25,
    y: 12.5,
  });
  const [completedCrop, setCompletedCrop] = useState<any>(null);

  // Create State
  const [title, setTitle] = useState(initialTitle || "رمان فوق‌العاده من");
  const [author, setAuthor] = useState(initialAuthor || "نام نویسنده");
  const [themeColor, setThemeColor] = useState("#0f172a");
  const [textColor, setTextColor] = useState("#ffffff");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [coverTheme, setCoverTheme] = useState<"solid" | "gradient" | "pattern">("solid");
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const uploadCover = async (dataUrl: string) => {
    const blob = imageDataUrlToBlob(dataUrl);
    const body = await uploadImageBlob(blob, {
      fileName: "cover.jpg",
      csrfToken: api.getToken(),
      // Covers appear on the public catalogue, so the stored file must be
      // readable without a session. Private uploads resolve to an
      // authenticated URL and render as a broken image for visitors.
      fields: { visibility: "public" },
    });
    if (typeof body.url !== "string" || !body.url.trim()) {
      throw new Error("بارگذاری بدون نشانی قابل استفاده برای جلد به پایان رسید.");
    }
    return body.url;
  };

  useEffect(() => {
    if (!isOpen) return;
    setTitle(initialTitle || "رمان فوق‌العاده من");
    setAuthor(initialAuthor || "نام نویسنده");
    setApplyError("");
    setIsApplying(false);
  }, [isOpen, initialTitle, initialAuthor]);

  useEffect(() => {
    if (mode === "create") {
      drawCanvasCover();
    }
  }, [title, author, themeColor, textColor, fontFamily, coverTheme, mode]);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!/^image\/(?:jpeg|png|webp|gif|avif)$/i.test(file.type)) {
        setApplyError("تصویری با قالب JPG، PNG، WebP، GIF یا AVIF انتخاب کنید.");
        e.target.value = "";
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setApplyError("تصویر منبع باید 20 مگابایت یا کوچک‌تر باشد.");
        e.target.value = "";
        return;
      }
      setApplyError("");
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setImgSrc(reader.result?.toString() || "");
        setCompletedCrop(null);
      });
      reader.addEventListener("error", () => {
        setApplyError("تصویر انتخاب‌شده خوانده نشد. لطفاً فایل دیگری را امتحان کنید.");
      });
      reader.readAsDataURL(file);
    }
  };

  const getFallbackCrop = (image: HTMLImageElement): PixelCrop => {
    const aspect = 3 / 4;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    let width = naturalWidth;
    let height = width / aspect;

    if (height > naturalHeight) {
      height = naturalHeight;
      width = height * aspect;
    }

    return {
      unit: "px",
      x: (naturalWidth - width) / 2,
      y: (naturalHeight - height) / 2,
      width,
      height,
    };
  };

  const resolveSourceCrop = (image: HTMLImageElement): PixelCrop => {
    if (!completedCrop?.width || !completedCrop?.height) return getFallbackCrop(image);

    if (completedCrop.unit === "%") {
      return {
        unit: "px",
        x: (completedCrop.x / 100) * image.naturalWidth,
        y: (completedCrop.y / 100) * image.naturalHeight,
        width: (completedCrop.width / 100) * image.naturalWidth,
        height: (completedCrop.height / 100) * image.naturalHeight,
      };
    }

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    return {
      unit: "px",
      x: completedCrop.x * scaleX,
      y: completedCrop.y * scaleY,
      width: completedCrop.width * scaleX,
      height: completedCrop.height * scaleY,
    };
  };

  const applyCover = async (dataUrl: string) => {
    if (!dataUrl || isApplying) return;
    setIsApplying(true);
    setApplyError("");

    try {
      const coverUrl = await uploadCover(dataUrl);
      await onSave(coverUrl || dataUrl);
      onClose();
    } catch (error: any) {
      setApplyError(error?.message || "جلد اعمال نشد. لطفاً دوباره تلاش کنید.");
      setIsApplying(false);
    }
  };

  const getCroppedImg = async () => {
    if (!imgRef.current) {
      setApplyError("قبل از اعمال جلد، ابتدا تصویری انتخاب کنید.");
      return;
    }

    const canvas = document.createElement("canvas");
    const sourceCrop = resolveSourceCrop(imgRef.current);
    const scale = Math.min(
      1,
      MAX_UPLOADED_COVER_WIDTH / Math.max(1, sourceCrop.width),
      MAX_UPLOADED_COVER_HEIGHT / Math.max(1, sourceCrop.height)
    );
    const outputWidth = Math.max(1, Math.round(sourceCrop.width * scale));
    const outputHeight = Math.max(1, Math.round(sourceCrop.height * scale));

    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        imgRef.current,
        sourceCrop.x,
        sourceCrop.y,
        sourceCrop.width,
        sourceCrop.height,
        0,
        0,
        outputWidth,
        outputHeight
      );
      const base64Image = canvas.toDataURL("image/jpeg", 0.9);
      await applyCover(base64Image);
    } else {
      setApplyError("جلد آماده نشد. لطفاً تصویر دیگری را امتحان کنید.");
    }
  };

  const drawCanvasCover = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Define standard novel cover aspect ratio (e.g., 600x900)
    canvas.width = 600;
    canvas.height = 900;

    // Draw Background
    if (coverTheme === "solid") {
      ctx.fillStyle = themeColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (coverTheme === "gradient") {
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, "#1e293b");
      grad.addColorStop(1, themeColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (coverTheme === "pattern") {
      ctx.fillStyle = themeColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 50; i++) {
        ctx.beginPath();
        ctx.arc(
          Math.random() * canvas.width,
          Math.random() * canvas.height,
          Math.random() * 50,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    // Draw frame
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 10;
    ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

    // Draw Title
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // Auto-wrap text extremely simplified
    ctx.font = `bold 60px "Estedad", "Vazirmatn", ${fontFamily}`;
    const words = title.split(" ");
    let line = "";
    let lines = [];
    for (let n = 0; n < words.length; n++) {
      let testLine = line + words[n] + " ";
      let metrics = ctx.measureText(testLine);
      if (metrics.width > canvas.width - 120 && n > 0) {
        lines.push(line);
        line = words[n] + " ";
      } else {
        line = testLine;
      }
    }
    lines.push(line);
    
    let startY = canvas.height / 3;
    lines.forEach((l, i) => {
      ctx.fillText(l.trim(), canvas.width / 2, startY + i * 70);
    });

    // Draw Author
    ctx.font = `30px "Estedad", "Vazirmatn", ${fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(author, canvas.width / 2, canvas.height - 150);
  };

  const saveCanvasCover = async () => {
    if (canvasRef.current) {
      drawCanvasCover();
      const base64Image = canvasRef.current.toDataURL("image/jpeg", 0.9);
      await applyCover(base64Image);
    } else {
      setApplyError("پیش‌نمایش جلد هنوز آماده نیست. لطفاً دوباره تلاش کنید.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col md:flex-row overflow-hidden max-h-[90vh]">
        
        {/* Left Sidebar Tools */}
        <div className="w-full md:w-72 bg-slate-950/50 p-6 border-r border-slate-800 flex flex-col gap-6 overflow-y-auto">
          <div className="flex justify-between items-center md:hidden">
            <h3 className="font-bold text-white">ویرایشگر جلد</h3>
            <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
          </div>
          
          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
            <button
              onClick={() => setMode("upload")}
              className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${mode === "upload" ? "bg-violet-600 text-white shadow-md shadow-violet-900/20" : "text-slate-400 hover:text-white"}`}
            >
              بارگذاری و برش
            </button>
            <button
              onClick={() => setMode("create")}
              className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${mode === "create" ? "bg-violet-600 text-white shadow-md shadow-violet-900/20" : "text-slate-400 hover:text-white"}`}
            >
              ساخت جلد
            </button>
          </div>

          {mode === "upload" ? (
            <div className="space-y-4">
              <label className="block">
                <div className="bg-slate-800 border-2 border-dashed border-slate-600 rounded-xl p-6 text-center cursor-pointer hover:bg-slate-700 transition-colors">
                  <ImageIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <span className="text-sm font-medium text-slate-300">انتخاب تصویر</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={onSelectFile} className="hidden" />
                </div>
              </label>
              <p className="text-xs text-slate-500 text-center">قالب‌های پشتیبانی‌شده: JPG، PNG، WEBP. نسبت 3:4 توصیه می‌شود.</p>
            </div>
          ) : (
            <div className="space-y-5 animate-in slide-in-from-left-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-2"><Type className="w-3 h-3"/> عنوان کتاب</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-2"><Type className="w-3 h-3"/> نام نویسنده</label>
                <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-2"><PaintBucket className="w-3 h-3"/> رنگ تم</label>
                  <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="w-full h-8 rounded cursor-pointer border-0 bg-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-2"><Type className="w-3 h-3"/> متن</label>
                  <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-full h-8 rounded cursor-pointer border-0 bg-transparent" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-2"><Layers className="w-3 h-3"/> سبک</label>
                <select value={coverTheme} onChange={(e:any) => setCoverTheme(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500">
                  <option value="solid">رنگ ساده ملایم</option>
                  <option value="gradient">گرادیان عمیق</option>
                  <option value="pattern">الگوی کهکشانی</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-2"><Type className="w-3 h-3"/> تنظیم قلم</label>
                <select value={fontFamily} onChange={(e:any) => setFontFamily(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500">
                  <option value="Inter">مدرن (Inter)</option>
                  <option value="Playfair Display">کلاسیک (Playfair)</option>
                  <option value="Syncopate">علمی‌تخیلی (Syncopate)</option>
                  <option value="Space Grotesk">تکنولوژیک (Space Grotesk)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 bg-slate-900 p-6 flex flex-col relative min-h-[400px]">
          <button onClick={onClose} className="absolute right-4 top-4 hidden md:block z-10"><X className="w-6 h-6 text-slate-400 hover:text-white" /></button>
          
          <div className="flex-1 flex items-center justify-center bg-slate-950/50 rounded-xl overflow-hidden border border-slate-800 p-4">
            {mode === "upload" ? (
              imgSrc ? (
                <ReactCrop
                  crop={crop}
                  onChange={(c) => setCrop(c)}
                  onComplete={(c) => setCompletedCrop(c)}
                  aspect={3/4}
                  className="max-h-full"
                >
                  <img ref={imgRef} src={imgSrc} alt="برش تصویر" style={{ maxHeight: '60vh', objectFit: 'contain' }} />
                </ReactCrop>
              ) : (
                <div className="text-center text-slate-500 flex flex-col items-center">
                  <ImageIcon className="w-16 h-16 opacity-20 mb-4" />
                  <p>برای شروع برش، یک تصویر بارگذاری کنید</p>
                </div>
              )
            ) : (
               <div className="h-full w-full flex items-center justify-center">
                 <canvas 
                    ref={canvasRef} 
                    className="max-h-[60vh] max-w-full rounded-md shadow-2xl border border-slate-700 shadow-black/50"
                  />
               </div>
            )}
          </div>

          {applyError && (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-200">
              {applyError}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
            <button type="button" onClick={onClose} disabled={isApplying} className="px-5 py-2.5 text-sm font-bold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50">
              لغو
            </button>
            <button 
              type="button"
              onClick={mode === "upload" ? getCroppedImg : saveCanvasCover}
              disabled={isApplying || (mode === "upload" && !imgSrc)}
              className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              {isApplying ? "در حال اعمال..." : "اعمال جلد"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

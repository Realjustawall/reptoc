import React, { useRef, useState } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Image as ImageIcon, X } from "lucide-react";
import { api } from "../utils/api";
import { uploadImageBlob } from "../utils/imageUpload";

interface CharacterImageCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (url: string) => void;
}

export default function CharacterImageCropModal({ isOpen, onClose, onSave }: CharacterImageCropModalProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [source, setSource] = useState("");
  const [crop, setCrop] = useState<Crop>({ unit: "%", x: 10, y: 10, width: 80, height: 80 });
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("لطفاً یک فایل تصویری انتخاب کنید.");
    if (file.size > 10 * 1024 * 1024) return setError("حجم تصویر باید کمتر از 10 مگابایت باشد.");
    const reader = new FileReader();
    reader.onload = () => { setSource(String(reader.result || "")); setCompletedCrop(null); setError(""); };
    reader.onerror = () => setError("تصویر خوانده نشد.");
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const image = imageRef.current;
    if (!image || saving) return setError("ابتدا تصویری انتخاب کنید.");
    setSaving(true);
    setError("");
    try {
      const scaleX = image.naturalWidth / Math.max(1, image.width);
      const scaleY = image.naturalHeight / Math.max(1, image.height);
      const displayed = completedCrop?.width && completedCrop?.height
        ? completedCrop
        : { unit: "px", x: 0, y: 0, width: image.width, height: image.height } as PixelCrop;
      const sx = displayed.x * scaleX;
      const sy = displayed.y * scaleY;
      const sw = displayed.width * scaleX;
      const sh = displayed.height * scaleY;
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 600;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("پردازش تصویر در دسترس نیست.");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, sx, sy, sw, sh, 0, 0, 600, 600);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("تصویر برش‌خورده آماده نشد.");
      const body = await uploadImageBlob(blob, {
        fileName: "character.jpg",
        csrfToken: api.getToken(),
        // Character art is shown on the public novel page.
        fields: { visibility: "public" },
      });
      if (!body.url) throw new Error("بارگذاری بدون نشانی قابل استفاده برای تصویر به پایان رسید.");
      onSave(String(body.url));
      setSource("");
      onClose();
    } catch (cause: any) {
      setError(cause?.message || "بارگذاری تصویر ناموفق بود.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="برش تصویر شخصیت">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h3 className="font-bold">تصویر شخصیت</h3><button type="button" onClick={onClose} aria-label="بستن"><X className="h-5 w-5" /></button></div>
        <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-700 p-4 text-sm text-slate-300 hover:border-violet-500"><ImageIcon className="h-5 w-5" /> انتخاب تصویر<input type="file" accept="image/*" onChange={selectFile} className="hidden" /></label>
        {source && <div className="flex justify-center rounded-xl bg-black/40 p-2"><ReactCrop crop={crop} onChange={(_, percent) => setCrop(percent)} onComplete={(value) => setCompletedCrop(value)} aspect={1}><img ref={imageRef} src={source} alt="پیش‌نمایش برش" className="max-h-[52vh]" /></ReactCrop></div>}
        {error && <p className="mt-3 text-xs font-medium text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-400">لغو</button><button type="button" disabled={!source || saving} onClick={save} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold disabled:opacity-50">{saving ? "در حال بارگذاری…" : "استفاده از تصویر برش‌خورده"}</button></div>
      </div>
    </div>
  );
}

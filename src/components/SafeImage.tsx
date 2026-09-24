import React, { useEffect, useState } from "react";

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  fallbackSrc?: string;
  fallbackLabel?: string;
}

export default function SafeImage({
  src,
  fallbackSrc = "/image-fallback.svg",
  fallbackLabel = "تصویر در دسترس نیست",
  alt,
  onError,
  ...props
}: SafeImageProps) {
  const requested = String(src || "").trim();
  const [currentSrc, setCurrentSrc] = useState(requested || fallbackSrc);
  const [failed, setFailed] = useState(!requested);

  useEffect(() => {
    setCurrentSrc(requested || fallbackSrc);
    setFailed(!requested);
  }, [requested, fallbackSrc]);

  return (
    <img
      {...props}
      src={currentSrc}
      alt={failed ? `${alt || fallbackLabel} — ${fallbackLabel}` : alt}
      data-image-fallback={failed ? "true" : undefined}
      onError={(event) => {
        onError?.(event);
        if (currentSrc !== fallbackSrc) {
          setFailed(true);
          setCurrentSrc(fallbackSrc);
        }
      }}
    />
  );
}

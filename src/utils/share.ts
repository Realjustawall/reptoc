export async function copyLink(url: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // Clipboard permission can be denied even in a secure context. Continue
      // to the selection-based fallback supported by older browsers.
    }
  }
  const input = document.createElement("textarea");
  input.value = url;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("دسترسی به کلیپ‌بورد ممکن نیست.");
}

export async function shareOrCopyLink(details: ShareData): Promise<"shared" | "copied"> {
  if (navigator.share) {
    try {
      await navigator.share(details);
      return "shared";
    } catch (error: any) {
      if (error?.name === "AbortError") throw error;
    }
  }
  await copyLink(String(details.url || window.location.href));
  return "copied";
}

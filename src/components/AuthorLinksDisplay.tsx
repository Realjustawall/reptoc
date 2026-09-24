import React, { useEffect, useState } from "react";
import { AtSign, ExternalLink, HandCoins, Heart, Instagram, Music2, Youtube } from "lucide-react";
import { api } from "../utils/api";

export type PublicAuthorLink = {
  id: string;
  platform: string;
  label: string;
  url: string;
};

const LINK_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  // Financial support is visually distinct from the social links.
  donate: { icon: HandCoins, color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
  patreon: { icon: Heart, color: "border-orange-500/30 bg-orange-500/10 text-orange-500 dark:text-orange-300" },
  youtube: { icon: Youtube, color: "border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-300" },
  tiktok: { icon: Music2, color: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300" },
  x: { icon: AtSign, color: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-200" },
  instagram: { icon: Instagram, color: "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-300" },
};

export function AuthorLinkBoxes({
  links,
  authorName,
  placement = "novel",
  className = "",
}: {
  links: PublicAuthorLink[];
  authorName: string;
  placement?: "novel" | "chapter";
  className?: string;
}) {
  if (!links.length) return null;

  return (
    <section
      className={`rounded-2xl border border-violet-900/20 bg-violet-500/[0.04] p-4 ${className}`.trim()}
      data-author-links={placement}
    >
      <div className="mb-3">
        <h2 className="text-sm font-black">
          {placement === "chapter" ? `حمایت از ${authorName}` : "حمایت مالی و شبکه‌های اجتماعی"}
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          {placement === "chapter" ? "از این فصل لذت بردید؟ از نویسنده حمایت کنید یا او را دنبال کنید." : `خارج از رپتوک از ${authorName} حمایت کنید و او را دنبال کنید.`}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* The financial-support link leads, so readers who want to pay the
            author are not hunting through social icons for it. */}
        {[...links].sort((left, right) => Number(right.platform === "donate") - Number(left.platform === "donate")).map((link) => {
          const style = LINK_STYLES[link.platform] || LINK_STYLES.x;
          const LinkIcon = style.icon;
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`inline-flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:-translate-y-0.5 hover:brightness-110 ${style.color}`}
              data-author-link-platform={link.platform}
            >
              <LinkIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{link.label}</span>
              <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
            </a>
          );
        })}
      </div>
    </section>
  );
}

export default function AuthorLinksDisplay({
  username,
  authorName,
  placement = "novel",
  className = "",
}: {
  username: string;
  authorName?: string;
  placement?: "novel" | "chapter";
  className?: string;
}) {
  const [links, setLinks] = useState<PublicAuthorLink[]>([]);

  useEffect(() => {
    let active = true;
    setLinks([]);
    api.getAuthorLinks(username).then((loaded) => {
      if (active) setLinks(loaded);
    }).catch(() => {
      if (active) setLinks([]);
    });
    return () => { active = false; };
  }, [username]);

  return (
    <AuthorLinkBoxes
      links={links}
      authorName={authorName || username}
      placement={placement}
      className={className}
    />
  );
}

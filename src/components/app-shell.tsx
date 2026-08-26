"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  GitBranch,
  Globe,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { UserRole } from "@/lib/auth/users";

type NavItem = {
  href: string;
  labelKey: TranslationKey;
  icon: typeof Search;
};

const NAV: NavItem[] = [
  { href: "/discovery", labelKey: "nav.discover", icon: Search },
  { href: "/pipeline", labelKey: "nav.pipeline", icon: GitBranch },
  { href: "/lists", labelKey: "nav.lists", icon: List },
];

export function AppShell({
  children,
  role: _role,
  userName,
}: {
  children: React.ReactNode;
  role: UserRole;
  userName: string;
}) {
  const path = usePathname();
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-primary text-primary-foreground">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-5">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold leading-tight tracking-tight">
              {t("app.title")}
            </h1>
            <p className="truncate text-[11px] text-white/50">{t("app.subtitle")}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/");
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 active:scale-[0.98]",
                  active
                    ? "bg-white/20 font-semibold text-white shadow-sm"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t(n.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="mx-3 border-t border-white/10" />
        <div className="px-3 py-3 space-y-2">
          {/* Language toggle */}
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "es" : "en")}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Globe className="h-3.5 w-3.5" />
            {locale === "en" ? "Español" : "English"}
          </button>
          <div className="truncate px-3 text-sm font-medium text-white">{userName}</div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

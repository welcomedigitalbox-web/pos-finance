"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_URL } from "@/lib/apps";
import { useAuth } from "./auth-context";
import { useLanguage } from "./language-context";
import type { TranslationKey } from "./i18n";
import { PAGE_OPTIONS, GROUP_LABELS, PageGroup, hasPermission } from "./permissions";

const GROUPS: PageGroup[] = ["entry", "outstanding", "books", "setup"];

export default function Nav() {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (pathname === "/login" || !profile) return null;

  const visible = PAGE_OPTIONS.filter((p) => hasPermission(profile, p.key));

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={() => setMobileOpen(false)} />
      )}

              <a href={`${APP_URL.report}/dashboard`} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs sm:text-sm bg-white text-slate-600 hover:bg-slate-50 whitespace-nowrap">📋 Daily Report</a>

              <div className="hidden sm:flex border border-slate-200 rounded-lg overflow-hidden text-xs">
                <button
                  onClick={() => setLang("my")}
                  className={`px-2 py-1.5 ${lang === "my" ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}
                >
                  မြန်မာ
                </button>
                <button
                  onClick={() => setLang("en")}
                  className={`px-2 py-1.5 ${lang === "en" ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}
                >
                  EN
                </button>
              </div>

              <span className="text-xs text-slate-400 hidden md:inline">
                {profile.email} · {t(`fin_role_${profile.role}` as TranslationKey)}
              </span>
              <button
                onClick={signOut}
                className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2 py-1.5"
              >
                {t("logout")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

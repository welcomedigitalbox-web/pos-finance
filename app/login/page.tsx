"use client";

import { useEffect } from "react";
import { APP_URL } from "@/lib/apps";

// Sign-in lives on the POS for all four apps now. Anything still pointing
// here -- a bookmark, an old link -- just forwards.
export default function LoginRedirect() {
  useEffect(() => {
    window.location.replace(
      `${APP_URL.pos}/login?next=${encodeURIComponent(APP_URL.finance)}`
    );
  }, []);

  return (
    <div className="min-h-screen grid place-items-center text-sm text-slate-500">
      ခဏစောင့်ပါ...
    </div>
  );
}

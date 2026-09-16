// Where each Edu Baby House app lives.
//
// Sign-in is shared across these subdomains: the session sits in a cookie on
// .edubabyhouse.store, which every one of them can read. The POS owns the
// sign-in screen.

export const APP_URL = {
  pos: "https://erp.edubabyhouse.store",
  report: "https://report.edubabyhouse.store",
  finance: "https://finance.edubabyhouse.store",
  onlineorder: "https://onlineorder.edubabyhouse.store",
} as const;

// Only ever bounce back to our own domains -- an unchecked next= is an open
// redirect a phishing link can abuse.
export function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, APP_URL.finance);
    const ok =
      url.protocol === "https:" &&
      (url.hostname === "edubabyhouse.store" ||
        url.hostname.endsWith(".edubabyhouse.store"));
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

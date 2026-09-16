// Shared auth session storage for every Edu Baby House app.
//
// supabase-js keeps the session in localStorage by default, which belongs to
// one origin -- so the POS and this app each ended up with their own login.
// Writing the same session to a cookie on the parent domain lets every
// subdomain read it, so one sign-in covers all of them.
//
// Cookies cap out near 4 KB and a session with a large JWT can exceed that,
// so the value is split across numbered chunks and reassembled on read.

const COOKIE_KEY = "ebh-auth";
const CHUNK_SIZE = 3000;

// Localhost has no parent domain to share, and setting one breaks the cookie.
function cookieDomain(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  return host.endsWith(".edubabyhouse.store") ? "; domain=.edubabyhouse.store" : "";
}

function secureFlag(): string {
  if (typeof window === "undefined") return "";
  return window.location.protocol === "https:" ? "; secure" : "";
}

function readRaw(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeRaw(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie =
    `${name}=${encodeURIComponent(value)}` +
    cookieDomain() +
    "; path=/; max-age=31536000; samesite=lax" +
    secureFlag();
}

function clearRaw(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=` + cookieDomain() + "; path=/; max-age=0; samesite=lax" + secureFlag();
  // Older builds wrote a host-only cookie with no domain. Clearing that form
  // too stops a stale copy shadowing the shared one after sign-out.
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax` + secureFlag();
}

export const cookieStorage = {
  getItem(key: string): string | null {
    const head = readRaw(`${COOKIE_KEY}-${key}.0`);
    if (head === null) return readRaw(`${COOKIE_KEY}-${key}`);

    let value = head;
    for (let i = 1; ; i++) {
      const part = readRaw(`${COOKIE_KEY}-${key}.${i}`);
      if (part === null) break;
      value += part;
    }
    return value;
  },

  setItem(key: string, value: string): void {
    // Drop whatever was there first, or a shorter session leaves orphan chunks
    // behind that would corrupt the next read.
    cookieStorage.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      writeRaw(`${COOKIE_KEY}-${key}`, value);
      return;
    }
    for (let i = 0; i * CHUNK_SIZE < value.length; i++) {
      writeRaw(`${COOKIE_KEY}-${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },

  removeItem(key: string): void {
    clearRaw(`${COOKIE_KEY}-${key}`);
    for (let i = 0; i < 20; i++) clearRaw(`${COOKIE_KEY}-${key}.${i}`);
  },
};

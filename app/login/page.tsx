"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useLanguage } from "../language-context";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(t("login_error"));
      return;
    }
    router.replace("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form
        onSubmit={handleLogin}
        className="bg-white border border-slate-200 rounded-2xl p-8 w-full max-w-sm shadow-sm"
      >
        <div className="flex justify-between items-start mb-1">
          <h1 className="text-xl font-bold">{t("login_title")}</h1>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setLang("my")}
              className={`px-2 py-1 ${lang === "my" ? "bg-blue-600 text-white" : "text-slate-500"}`}
            >
              မြန်မာ
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2 py-1 ${lang === "en" ? "bg-blue-600 text-white" : "text-slate-500"}`}
            >
              EN
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-6">{t("login_subtitle")}</p>

        <label className="text-sm text-slate-600">{t("login_email")}</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
          placeholder="cashier@example.com"
        />

        <label className="text-sm text-slate-600">{t("login_password")}</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
          placeholder="••••••••"
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 disabled:bg-slate-300 text-white rounded-lg font-semibold text-sm"
        >
          {loading ? t("login_loading") : t("login_button")}
        </button>
      </form>
    </div>
  );
}

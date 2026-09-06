"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useStore } from "@/app/store-context";
import { useLanguage } from "@/app/language-context";
import {
  hasPermission,
  ROLE_OPTIONS,
  PAGE_OPTIONS,
  DEFAULT_ACCOUNTANT_PAGES,
  type FinanceRole,
  type PageKey,
} from "@/app/permissions";
import type { TranslationKey } from "@/app/i18n";

type FinUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: FinanceRole;
  all_stores: boolean;
  permissions: string[] | null;
  is_active: boolean;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

// fin_admin / fin_manager run the whole department: their branch and page
// lists are ignored, so the pickers are switched off for those roles.
const FULL_ACCESS: FinanceRole[] = ["fin_admin", "fin_manager"];

// The Users screen itself is never granted per user - the role decides it.
const SELECTABLE_PAGES = PAGE_OPTIONS.filter((p) => p.key !== "fin-users");

type Draft = {
  id?: string;
  email: string;
  password: string;
  name: string;
  role: FinanceRole;
  all_stores: boolean;
  permissions: PageKey[];
  stores: string[];
  note: string;
};

const emptyDraft = (): Draft => ({
  email: "",
  password: "",
  name: "",
  role: "accountant",
  all_stores: false,
  permissions: [...DEFAULT_ACCOUNTANT_PAGES],
  stores: [],
  note: "",
});

export default function FinanceUsersPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<FinUserRow[]>([]);
  const [scopes, setScopes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FinUserRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-users")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q)
    );
  }, [rows, search]);

  if (!profile || !hasPermission(profile, "fin-users")) return null;

  async function load() {
    setLoading(true);
    const [userRes, scopeRes] = await Promise.all([
      supabase.from("fin_users").select("*").order("created_at", { ascending: false }),
      supabase.from("fin_user_stores").select("user_id,store_id"),
    ]);
    setRows((userRes.data as FinUserRow[]) || []);
    const map: Record<string, string[]> = {};
    for (const r of (scopeRes.data as { user_id: string; store_id: string }[]) || []) {
      (map[r.user_id] ||= []).push(r.store_id);
    }
    setScopes(map);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name || id;

  const roleLabel = (role: FinanceRole | string) =>
    t(("fin_role_" + role) as TranslationKey);

  function openNew() {
    setDraft(emptyDraft());
  }

  function openEdit(u: FinUserRow) {
    setDraft({
      id: u.id,
      email: u.email,
      password: "",
      name: u.name || "",
      role: u.role,
      all_stores: u.all_stores,
      permissions: (u.permissions || []).filter(
        (k): k is PageKey => k !== "fin-users" && SELECTABLE_PAGES.some((p) => p.key === k)
      ),
      stores: scopes[u.id] || [],
      note: u.note || "",
    });
  }

  const draftFullAccess = !!draft && FULL_ACCESS.includes(draft.role);
  const storePickerOff = !draft || draftFullAccess || draft.all_stores;

  function togglePage(key: PageKey) {
    if (!draft) return;
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(key)
        ? draft.permissions.filter((k) => k !== key)
        : [...draft.permissions, key],
    });
  }

  function toggleStore(id: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      stores: draft.stores.includes(id)
        ? draft.stores.filter((s) => s !== id)
        : [...draft.stores, id],
    });
  }

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const email = draft.email.trim();

    if (!name || (!draft.id && !email)) {
      showToast(t("fin_required"));
      return;
    }
    if (!draft.id && draft.password.length < 8) {
      showToast(t("fin_userPasswordHint"));
      return;
    }
    // An administrator cannot demote themselves out of this screen.
    if (draft.id && draft.id === profile?.id && draft.role !== profile.role) {
      showToast(t("fin_userSelfEdit"));
      return;
    }

    const fullAccess = FULL_ACCESS.includes(draft.role);
    const permissions = fullAccess ? [] : draft.permissions;
    const scopeStores = fullAccess || draft.all_stores ? [] : draft.stores;

    setSaving(true);
    try {
      if (draft.id) {
        const { error } = await supabase
          .from("fin_users")
          .update({
            name,
            role: draft.role,
            all_stores: draft.all_stores,
            permissions,
            note: draft.note.trim() || null,
          })
          .eq("id", draft.id);
        if (error) throw error;

        const { error: delErr } = await supabase
          .from("fin_user_stores")
          .delete()
          .eq("user_id", draft.id);
        if (delErr) throw delErr;

        if (scopeStores.length > 0) {
          const { error: insErr } = await supabase
            .from("fin_user_stores")
            .insert(scopeStores.map((store_id) => ({ user_id: draft.id, store_id })));
          if (insErr) throw insErr;
        }
        showToast(t("fin_userUpdated"));
      } else {
        // Creating the auth account needs the service role, so it runs
        // in an edge function rather than from the browser.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        const { data, error } = await supabase.functions.invoke("fin-admin-create-user", {
          body: {
            email,
            password: draft.password,
            name,
            role: draft.role,
            all_stores: draft.all_stores,
            permissions,
            stores: scopeStores,
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        showToast(t("fin_userCreated"));
      }
      setDraft(null);
      await load();
    } catch (err) {
      showToast("❌ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(u: FinUserRow, active: boolean) {
    if (u.id === profile?.id) {
      showToast(t("fin_userSelfEdit"));
      return;
    }
    const { error } = await supabase.from("fin_users").update({ is_active: active }).eq("id", u.id);
    if (error) {
      showToast("❌ " + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, is_active: active } : r)));
    showToast(t("fin_userUpdated"));
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const { data, error } = await supabase.functions.invoke("fin-admin-create-user", {
        body: { action: "delete", user_id: confirmDelete.id },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      showToast(t("fin_userDeleted"));
      setConfirmDelete(null);
      await load();
    } catch (err) {
      showToast("❌ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeleting(false);
    }
  }

  function scopeText(u: FinUserRow) {
    if (FULL_ACCESS.includes(u.role) || u.all_stores) return t("fin_userAllStores");
    const ids = scopes[u.id] || [];
    if (ids.length === 0) return "-";
    return ids.map(storeName).join(", ");
  }

  function pageCount(u: FinUserRow) {
    if (FULL_ACCESS.includes(u.role)) return t("fin_all");
    return String((u.permissions || []).length);
  }

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="font-semibold text-lg">{t("fin_usersTitle")}</h2>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold">
          {t("fin_userNew")}
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">{t("fin_usersHint")}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("fin_search")}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full sm:w-72"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-10">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_userName")}</th>
              <th className="text-left px-3 py-2">{t("fin_userEmail")}</th>
              <th className="text-left px-3 py-2">{t("fin_userRole")}</th>
              <th className="text-left px-3 py-2">{t("fin_userStores")}</th>
              <th className="text-left px-3 py-2">{t("fin_userPages")}</th>
              <th className="text-left px-3 py-2">{t("fin_status")}</th>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">{t("fin_loading")}</td>
              </tr>
            )}
            {!loading &&
              visible.map((u) => {
                const isSelf = u.id === profile?.id;
                return (
                  <tr
                    key={u.id}
                    className={`border-t border-slate-100 ${u.is_active ? "" : "text-slate-400 bg-slate-50/50"}`}>
                    <td className="px-3 py-2 font-medium">{u.name || "-"}</td>
                    <td className="px-3 py-2 text-slate-500">{u.email}</td>
                    <td className="px-3 py-2">{roleLabel(u.role)}</td>
                    <td className="px-3 py-2 text-slate-500">{scopeText(u)}</td>
                    <td className="px-3 py-2">{pageCount(u)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          u.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
                        }`}>
                        {u.is_active ? t("fin_userActive") : t("fin_userInactive")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openEdit(u)}
                          className="text-blue-600 text-xs font-medium">
                          {t("fin_edit")}
                        </button>
                        <button
                          onClick={() => setActive(u, !u.is_active)}
                          disabled={isSelf}
                          title={isSelf ? t("fin_userSelfEdit") : undefined}
                          className="text-xs font-medium text-slate-600 disabled:text-slate-300">
                          {u.is_active ? t("fin_userInactive") : t("fin_userActive")}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(u)}
                          disabled={isSelf}
                          title={isSelf ? t("fin_userSelfEdit") : undefined}
                          className="text-xs font-medium text-red-600 disabled:text-slate-300">
                          {t("fin_delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">{t("fin_empty")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-4">
              {draft.id ? t("fin_edit") : t("fin_userNew")}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              {!draft.id && (
                <div>
                  <label className="text-sm text-slate-600">{t("fin_userEmail")}</label>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  />
                </div>
              )}
              {!draft.id && (
                <div>
                  <label className="text-sm text-slate-600">{t("fin_userPassword")}</label>
                  <input
                    type="password"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  />
                  <p className="text-xs text-slate-400 mt-1">{t("fin_userPasswordHint")}</p>
                </div>
              )}
              <div>
                <label className="text-sm text-slate-600">{t("fin_userName")}</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_userRole")}</label>
                <select
                  value={draft.role}
                  disabled={!!draft.id && draft.id === profile?.id}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value as FinanceRole })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 disabled:bg-slate-100">
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
                {!!draft.id && draft.id === profile?.id && (
                  <p className="text-xs text-slate-400 mt-1">{t("fin_userSelfEdit")}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-slate-600">{t("fin_note")}</label>
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("fin_userStores")}</span>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.all_stores}
                    disabled={draftFullAccess}
                    onChange={(e) => setDraft({ ...draft, all_stores: e.target.checked })}
                  />
                  {t("fin_userAllStores")}
                </label>
              </div>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 border border-slate-200 rounded-xl p-3">
                {stores.map((s) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 text-sm ${storePickerOff ? "text-slate-400" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={storePickerOff}
                      checked={draft.stores.includes(s.id)}
                      onChange={() => toggleStore(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
                {stores.length === 0 && (
                  <span className="text-sm text-slate-400">{t("fin_empty")}</span>
                )}
              </div>
            </div>

            <div className="mt-5">
              <span className="text-sm font-medium">{t("fin_userPages")}</span>
              {draftFullAccess && (
                <p className="text-xs text-slate-400 mt-1">
                  {roleLabel(draft.role)} · {t("fin_all")}
                </p>
              )}
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 border border-slate-200 rounded-xl p-3">
                {SELECTABLE_PAGES.map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-center gap-2 text-sm ${draftFullAccess ? "text-slate-400" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={draftFullAccess}
                      checked={draftFullAccess || draft.permissions.includes(p.key)}
                      onChange={() => togglePage(p.key)}
                    />
                    {t(p.labelKey as TranslationKey)}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setDraft(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
                {saving ? "..." : t("fin_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
            <h3 className="font-semibold text-lg mb-2">{t("fin_delete")}</h3>
            <p className="text-sm text-slate-600">{t("fin_userDeleteConfirm")}</p>
            <p className="text-sm text-slate-500 mt-2">
              {confirmDelete.name || confirmDelete.email}
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
              <button
                onClick={doDelete}
                disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 disabled:bg-red-300 text-white rounded-lg text-sm font-semibold">
                {deleting ? "..." : t("fin_delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

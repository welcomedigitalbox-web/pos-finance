"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, type AccountType, type FinAccount, errorText } from "@/lib/finance";

const TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const TYPE_LABEL: Record<AccountType, "fin_type_asset" | "fin_type_liability" | "fin_type_equity" | "fin_type_income" | "fin_type_expense"> = {
  asset: "fin_type_asset",
  liability: "fin_type_liability",
  equity: "fin_type_equity",
  income: "fin_type_income",
  expense: "fin_type_expense",
};

const SETTING_KEYS = [
  "ar_account", "ap_account", "sales_account", "purchase_account", "tax_account",
  "discount_allowed", "discount_received", "cash_account", "bank_account",
];

type MethodAccount = {
  method_code: string;
  account_id: string | null;
  label: string | null;
};

type MethodCoverage = {
  method_code: string;
  label: string | null;
  in_pos: boolean;
  is_active: boolean | null;
  used_count: number;
  account_code: string | null;
  account_name: string | null;
};

type Draft = {
  id?: string;
  code: string;
  name: string;
  name_my: string;
  type: AccountType;
  parent_code: string;
  is_cash: boolean;
  is_bank: boolean;
  store_id: string;
  bank_name: string;
  bank_account_no: string;
  opening_balance: string;
  note: string;
};

const emptyDraft = (): Draft => ({
  code: "", name: "", name_my: "", type: "asset", parent_code: "",
  is_cash: false, is_bank: false, store_id: "", bank_name: "", bank_account_no: "",
  opening_balance: "0", note: "",
});

export default function FinanceAccountsPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<FinAccount[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingLabels, setSettingLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState("");

  const [methods, setMethods] = useState<MethodCoverage[]>([]);
  const [newMethod, setNewMethod] = useState<MethodAccount>({ method_code: "", account_id: "", label: "" });
  const [newInPos, setNewInPos] = useState(false);
  const [newIsCash, setNewIsCash] = useState(false);
  const [savingMethod, setSavingMethod] = useState(false);
  const [confirmMethod, setConfirmMethod] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-accounts")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!profile || !hasPermission(profile, "fin-accounts")) return null;

  async function load() {
    setLoading(true);
    const [accRes, setRes, methRes] = await Promise.all([
      supabase.from("fin_accounts").select("*").order("sort_order").order("code"),
      supabase.from("fin_settings").select("key,value,label"),
      supabase
        .from("fin_method_coverage")
        .select("method_code,label,in_pos,is_active,used_count,account_code,account_name"),
    ]);
    setRows((accRes.data as FinAccount[]) || []);
    setMethods((methRes.data as MethodCoverage[]) || []);
    const map: Record<string, string> = {};
    const labelMap: Record<string, string> = {};
    for (const s of (setRes.data as { key: string; value: string; label: string | null }[]) || []) {
      map[s.key] = s.value;
      if (s.label) labelMap[s.key] = s.label;
    }
    setSettings(map);
    setSettingLabels(labelMap);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const accName = (a: Pick<FinAccount, "name" | "name_my">) =>
    lang === "my" && a.name_my ? a.name_my : a.name;

  function openNew() {
    setDraft(emptyDraft());
  }

  function openEdit(a: FinAccount) {
    setDraft({
      id: a.id,
      code: a.code,
      name: a.name,
      name_my: a.name_my || "",
      type: a.type,
      parent_code: a.parent_code || "",
      is_cash: a.is_cash,
      is_bank: a.is_bank,
      store_id: a.store_id || "",
      bank_name: a.bank_name || "",
      bank_account_no: a.bank_account_no || "",
      opening_balance: String(a.opening_balance ?? 0),
      note: a.note || "",
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.code.trim() || !draft.name.trim()) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: draft.code.trim(),
        name: draft.name.trim(),
        name_my: draft.name_my.trim() || null,
        type: draft.type,
        parent_code: draft.parent_code.trim() || null,
        is_cash: draft.is_cash,
        is_bank: draft.is_bank,
        store_id: draft.store_id || null,
        bank_name: draft.bank_name.trim() || null,
        bank_account_no: draft.bank_account_no.trim() || null,
        opening_balance: Number(draft.opening_balance) || 0,
        note: draft.note.trim() || null,
      };
      const { error } = draft.id
        ? await supabase.from("fin_accounts").update(payload).eq("id", draft.id)
        : await supabase.from("fin_accounts").insert(payload);
      if (error) throw error;
      showToast(t("fin_saved"));
      setDraft(null);
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(a: FinAccount, active: boolean) {
    const { error } = await supabase.from("fin_accounts").update({ is_active: active }).eq("id", a.id);
    if (error) {
      showToast("❌ " + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === a.id ? { ...r, is_active: active } : r)));
  }

  async function saveSetting(key: string, code: string) {
    setSavingKey(key);
    try {
      const { error } = await supabase.from("fin_settings").upsert({ key, value: code }, { onConflict: "key" });
      if (error) throw error;
      setSettings((prev) => ({ ...prev, [key]: code }));
      showToast(t("fin_saved"));
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSavingKey("");
    }
  }

  async function saveMethodAccount(code: string, accountId: string) {
    setSavingKey("m:" + code);
    try {
      const { error } = await supabase.from("fin_method_accounts").upsert(
        {
          method_code: code,
          account_id: accountId || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "method_code" }
      );
      if (error) throw error;
      showToast(t("fin_saved"));
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSavingKey("");
    }
  }

  async function addMethodAccount() {
    const code = newMethod.method_code.trim().toLowerCase();
    if (!code || !newMethod.account_id) {
      showToast(t("fin_required"));
      return;
    }
    setSavingMethod(true);
    try {
      if (newInPos) {
        const { error: posError } = await supabase.from("payment_methods").insert({
          name: (newMethod.label || "").trim() || code,
          code,
          is_cash: newIsCash,
          is_cod: false,
          is_active: true,
          store_id: null,
          sort_order: 0,
        });
        if (posError) throw posError;
      }
      const { error } = await supabase.from("fin_method_accounts").upsert(
        {
          method_code: code,
          account_id: newMethod.account_id,
          label: (newMethod.label || "").trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "method_code" }
      );
      if (error) throw error;
      showToast(t("fin_saved"));
      setNewMethod({ method_code: "", account_id: "", label: "" });
      setNewInPos(false);
      setNewIsCash(false);
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSavingMethod(false);
    }
  }

  async function deleteMethodAccount(code: string) {
    if (confirmMethod !== code) {
      setConfirmMethod(code);
      setTimeout(() => setConfirmMethod((c) => (c === code ? "" : c)), 4000);
      return;
    }
    setConfirmMethod("");
    setSavingKey("m:" + code);
    try {
      const { error } = await supabase.from("fin_method_accounts").delete().eq("method_code", code);
      if (error) throw error;
      showToast(t("fin_saved"));
      await load();
    } catch (err) {
      showToast("❌ " + (errorText(err)));
    } finally {
      setSavingKey("");
    }
  }

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");

  const visible = useMemo(
    () => (showInactive ? rows : rows.filter((r) => r.is_active)),
    [rows, showInactive]
  );

  const grouped = useMemo(
    () => TYPES.map((type) => ({ type, items: visible.filter((r) => r.type === type) })),
    [visible]
  );

  const activeAccounts = useMemo(() => rows.filter((r) => r.is_active), [rows]);

  const settlementAccounts = useMemo(
    () => activeAccounts.filter((a) => a.is_cash || a.is_bank),
    [activeAccounts]
  );

  const accountIdByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of rows) map[a.code] = a.id;
    return map;
  }, [rows]);

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold text-lg">{t("fin_accountsTitle")}</h2>
        <button onClick={openNew}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold">
          {t("fin_new")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={showInactive ? "all" : "active"}
          onChange={(e) => setShowInactive(e.target.value === "all")}>
          <option value="active">{t("admin_active")}</option>
          <option value="all">{t("fin_all")}</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_accountCode")}</th>
              <th className="text-left px-3 py-2">{t("fin_accountName")}</th>
              <th className="text-left px-3 py-2">{t("fin_parentCode")}</th>
              <th className="text-left px-3 py-2">{t("fin_store")}</th>
              <th className="text-right px-3 py-2">{t("fin_openingBalance")}</th>
              <th className="text-left px-3 py-2">{t("admin_active")}</th>
              <th className="text-left px-3 py-2">{t("fin_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading &&
              grouped.flatMap((g) =>
                g.items.length === 0
                  ? []
                  : [
                      <tr key={`h-${g.type}`} className="bg-slate-50/70">
                        <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold uppercase text-slate-500">
                          {t(TYPE_LABEL[g.type])}
                        </td>
                      </tr>,
                      ...g.items.map((a) => (
                        <tr key={a.id} className={`border-t border-slate-100 ${a.is_active ? "" : "text-slate-400 bg-slate-50/50"}`}>
                          <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium">{accName(a)}</span>
                            {a.is_cash && (
                              <span className="ml-2 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                                {t("fin_isCash")}
                              </span>
                            )}
                            {a.is_bank && (
                              <span className="ml-2 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                                {t("fin_isBank")}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">{a.parent_code || "-"}</td>
                          <td className="px-3 py-2 text-slate-500">{storeName(a.store_id)}</td>
                          <td className="px-3 py-2 text-right">{fmtMMK(a.opening_balance)}</td>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={a.is_active}
                              onChange={(e) => setActive(a, e.target.checked)} />
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => openEdit(a)} className="text-blue-600 text-xs font-medium">
                              {t("fin_edit")}
                            </button>
                          </td>
                        </tr>
                      )),
                    ]
              )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold mb-1">{t("fin_settingsTitle")}</h3>
      <p className="text-sm text-slate-500 mb-3">{t("fin_settingsHint")}</p>
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-10">
        {SETTING_KEYS.map((key) => (
          <div key={key}>
            <label className="text-xs text-slate-500">{settingLabels[key] || key}</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 disabled:bg-slate-100"
              value={settings[key] || ""}
              disabled={savingKey === key}
              onChange={(e) => saveSetting(key, e.target.value)}>
              <option value="">-</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.code} · {accName(a)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <h3 className="font-semibold mb-1">{t("fin_methodAccountsTitle")}</h3>
      <p className="text-sm text-slate-500 mb-3">{t("fin_methodAccountsHint")}</p>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-2">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_methodCode")}</th>
              <th className="text-left px-3 py-2">{t("fin_accountName")}</th>
              <th className="text-left px-3 py-2">{t("fin_status")}</th>
              <th className="text-right px-3 py-2">{t("fin_methodUsed")}</th>
              <th className="text-left px-3 py-2">{t("fin_account")}</th>
              <th className="text-left px-3 py-2">{t("fin_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && methods.map((m) => (
              <tr key={m.method_code}
                className={`border-t border-slate-100 ${m.account_code === null ? "bg-orange-50/40" : ""}`}>
                <td className="px-3 py-2 font-mono text-xs">{m.method_code}</td>
                <td className="px-3 py-2 text-slate-500">{m.label || "-"}</td>
                <td className="px-3 py-2">
                  {m.in_pos && (
                    <span className="mr-2 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                      {t("fin_methodInPos")}
                    </span>
                  )}
                  {m.account_code === null && (
                    <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700">
                      {t("fin_methodUnmapped")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-slate-500">
                  {Number(m.used_count) > 0 ? `${t("fin_methodUsed")} ${Number(m.used_count)}` : "-"}
                </td>
                <td className="px-3 py-2">
                  <select
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100"
                    value={(m.account_code && accountIdByCode[m.account_code]) || ""}
                    disabled={savingKey === "m:" + m.method_code}
                    onChange={(e) => saveMethodAccount(m.method_code, e.target.value)}>
                    <option value="">-</option>
                    {settlementAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {accName(a)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => deleteMethodAccount(m.method_code)}
                    disabled={savingKey === "m:" + m.method_code || m.account_code === null}
                    className="text-red-600 text-xs font-medium disabled:text-slate-300">
                    {confirmMethod === m.method_code ? t("fin_delete") + " ?" : t("fin_delete")}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && methods.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
            <tr className="border-t border-slate-100 bg-slate-50/70">
              <td className="px-3 py-2">
                <input value={newMethod.method_code}
                  onChange={(e) => setNewMethod({ ...newMethod, method_code: e.target.value })}
                  placeholder={t("fin_methodCodeHint")}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </td>
              <td className="px-3 py-2">
                <input value={newMethod.label || ""}
                  onChange={(e) => setNewMethod({ ...newMethod, label: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </td>
              <td className="px-3 py-2" colSpan={2}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={newInPos}
                    onChange={(e) => {
                      setNewInPos(e.target.checked);
                      if (!e.target.checked) setNewIsCash(false);
                    }} />
                  {t("fin_addToPos")}
                </label>
                <p className="text-xs text-slate-500 mt-1">{t("fin_addToPosHint")}</p>
                {newInPos && (
                  <label className="flex items-center gap-2 text-sm mt-2">
                    <input type="checkbox" checked={newIsCash}
                      onChange={(e) => setNewIsCash(e.target.checked)} />
                    {t("fin_methodIsCash")}
                  </label>
                )}
              </td>
              <td className="px-3 py-2">
                <select value={newMethod.account_id || ""}
                  onChange={(e) => setNewMethod({ ...newMethod, account_id: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">-</option>
                  {settlementAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} · {accName(a)}</option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <button onClick={addMethodAccount} disabled={savingMethod}
                  className="px-4 py-2 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
                  {savingMethod ? "..." : t("fin_save")}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t("fin_methodFallback")}</p>
      <p className="text-xs text-slate-500 mb-10">{t("fin_methodSyncNote")}</p>

      {draft && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-4">
              {draft.id ? t("fin_edit") : t("fin_new")}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm text-slate-600">{t("fin_accountCode")}</label>
                <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_accountType")}</label>
                <select value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1">
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>{t(TYPE_LABEL[ty])}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_accountName")}</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_accountNameMy")}</label>
                <input value={draft.name_my} onChange={(e) => setDraft({ ...draft, name_my: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_parentCode")}</label>
                <select value={draft.parent_code}
                  onChange={(e) => setDraft({ ...draft, parent_code: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1">
                  <option value="">-</option>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.code}>{a.code} · {accName(a)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_store")}</label>
                <select value={draft.store_id}
                  onChange={(e) => setDraft({ ...draft, store_id: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1">
                  <option value="">{t("fin_all")}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_bankName")}</label>
                <input value={draft.bank_name} onChange={(e) => setDraft({ ...draft, bank_name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_bankAccountNo")}</label>
                <input value={draft.bank_account_no}
                  onChange={(e) => setDraft({ ...draft, bank_account_no: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_openingBalance")}</label>
                <input type="number" value={draft.opening_balance}
                  onChange={(e) => setDraft({ ...draft, opening_balance: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
              <div className="flex items-end gap-4 pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.is_cash}
                    onChange={(e) => setDraft({ ...draft, is_cash: e.target.checked })} />
                  {t("fin_isCash")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.is_bank}
                    onChange={(e) => setDraft({ ...draft, is_bank: e.target.checked })} />
                  {t("fin_isBank")}
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-slate-600">{t("fin_note")}</label>
                <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setDraft(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
                {saving ? "..." : t("fin_save")}
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

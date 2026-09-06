"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  fmtMMK,
  fmtNum,
  loadAccounts,
  today,
  type AccountType,
  type FinAccount,
  type LedgerRow,
} from "@/lib/finance";
import type { TranslationKey } from "@/app/i18n";

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function BankPage() {
  const { profile } = useAuth();
  const { storeId, stores } = useStore();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [storeFilter, setStoreFilter] = useState("");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryDate, setEntryDate] = useState(today());
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [contraId, setContraId] = useState("");
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-bank")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadAccounts().then(setAccounts);
  }, []);

  const bankAccounts = useMemo(() => accounts.filter((a) => a.is_bank), [accounts]);

  useEffect(() => {
    if (bankAccounts.length === 0 || accountId) return;
    const mine = bankAccounts.find((a) => a.store_id === storeId);
    setAccountId((mine || bankAccounts[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccounts, storeId]);

  useEffect(() => {
    if (!accountId) {
      setRows([]);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, from, to, storeFilter]);

  if (!profile || !hasPermission(profile, "fin-bank")) return null;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("fin_general_ledger", {
      p_account_id: accountId,
      p_from: from || null,
      p_to: to || null,
      p_store: storeFilter || null,
    });
    if (error) showToast("❌ " + error.message);
    setRows((data as LedgerRow[]) || []);
    setLoading(false);
  }

  const account = accounts.find((a) => a.id === accountId) || null;
  const accName = (a: FinAccount) => (lang === "my" && a.name_my ? a.name_my : a.name);
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");

  const totalIn = useMemo(() => rows.reduce((s, r) => s + Number(r.debit || 0), 0), [rows]);
  const totalOut = useMemo(() => rows.reduce((s, r) => s + Number(r.credit || 0), 0), [rows]);

  // The RPC's running balance already carries whatever came before the range,
  // so the opening figure is the first row's balance minus that row's movement.
  const opening = useMemo(() => {
    if (rows.length === 0) return Number(account?.opening_balance || 0);
    const f = rows[0];
    return Number(f.running_balance || 0) - (Number(f.debit || 0) - Number(f.credit || 0));
  }, [rows, account]);

  const closing = rows.length > 0 ? Number(rows[rows.length - 1].running_balance || 0) : opening;

  const contraOptions = useMemo(
    () => accounts.filter((a) => a.id !== accountId),
    [accounts, accountId]
  );

  function openNew() {
    setEntryDate(today());
    setDirection("in");
    setAmount("");
    setContraId("");
    setMemo("");
    setShowNew(true);
  }

  async function saveEntry() {
    const contra = accounts.find((a) => a.id === contraId);
    if (!account || !contra || !Number(amount)) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("fin_save_cash_entry", {
      p: {
        entry_date: entryDate,
        store_id: account.store_id || storeId || null,
        book: "bank",
        direction,
        account_id: account.id,
        contra_code: contra.code,
        amount: Number(amount),
        memo: memo || null,
      },
    });
    setSaving(false);
    if (error) {
      showToast("❌ " + error.message);
      return;
    }
    showToast(t("fin_saved"));
    setShowNew(false);
    await load();
  }

  return (
    <div className="pt-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-lg">{t("fin_bankTitle")}</h2>
          {account && (
            <p className="text-sm text-slate-500 mt-0.5">
              {account.code} · {accName(account)}
              {account.store_id ? ` · ${storeName(account.store_id)}` : ""}
            </p>
          )}
          {account && (account.bank_name || account.bank_account_no) && (
            <p className="text-sm text-slate-600 mt-0.5">
              <span className="text-slate-500">{t("fin_bankName")}:</span>{" "}
              {account.bank_name || "-"}
              <span className="text-slate-500"> · {t("fin_bankAccountNo")}:</span>{" "}
              <span className="font-mono">{account.bank_account_no || "-"}</span>
            </p>
          )}
        </div>
        <button
          onClick={openNew}
          disabled={!account}
          className="bg-slate-900 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold shrink-0"
        >
          {t("fin_newEntry")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {bankAccounts.length === 0 && <option value="">{t("fin_selectAccount")}</option>}
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {accName(a)}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
        >
          <option value="">{t("fin_all")}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_openingBalance")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(opening)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_moneyIn")}</div>
          <div className="text-lg font-bold mt-1 text-green-600">{fmtMMK(totalIn)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_moneyOut")}</div>
          <div className="text-lg font-bold mt-1 text-orange-600">{fmtMMK(totalOut)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_balance")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(closing)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_kind")}</th>
              <th className="text-left px-3 py-2">{t("fin_memo")}</th>
              <th className="text-right px-3 py-2">{t("fin_moneyIn")}</th>
              <th className="text-right px-3 py-2">{t("fin_moneyOut")}</th>
              <th className="text-right px-3 py-2">{t("fin_runningBalance")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-slate-50/60">
              <td className="px-3 py-2 text-slate-500" colSpan={4}>
                {t("fin_openingBalance")}
              </td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right font-semibold">{fmtNum(opening)}</td>
            </tr>
            {loading && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-8">
                  {t("fin_loading")}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r, i) => (
                <tr key={`${r.journal_id}-${i}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">{r.journal_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.journal_no}</td>
                  <td className="px-3 py-2 text-slate-500">{r.journal_type}</td>
                  <td className="px-3 py-2">{r.memo || r.party_name || "-"}</td>
                  <td className="px-3 py-2 text-right text-green-700">{fmtNum(r.debit)}</td>
                  <td className="px-3 py-2 text-right text-orange-700">{fmtNum(r.credit)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtNum(r.running_balance)}</td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-8">
                  {t("fin_empty")}
                </td>
              </tr>
            )}
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={4}>
                {t("fin_balance")}
              </td>
              <td className="px-3 py-2 text-right">{fmtNum(totalIn)}</td>
              <td className="px-3 py-2 text-right">{fmtNum(totalOut)}</td>
              <td className="px-3 py-2 text-right">{fmtNum(closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {showNew && account && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-1">{t("fin_newEntry")}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {account.code} · {accName(account)}
            </p>

            <label className="text-sm text-slate-600">{t("fin_date")}</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => setDirection("in")}
                className={`py-2.5 rounded-lg text-sm font-medium border ${
                  direction === "in"
                    ? "bg-green-600 text-white border-green-600"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                {t("fin_moneyIn")}
              </button>
              <button
                onClick={() => setDirection("out")}
                className={`py-2.5 rounded-lg text-sm font-medium border ${
                  direction === "out"
                    ? "bg-orange-600 text-white border-orange-600"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                {t("fin_moneyOut")}
              </button>
            </div>

            <label className="text-sm text-slate-600">{t("fin_amount")}</label>
            <input
              type="number"
              min="0"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />

            <label className="text-sm text-slate-600">{t("fin_contraAccount")}</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={contraId}
              onChange={(e) => setContraId(e.target.value)}
            >
              <option value="">{t("fin_selectAccount")}</option>
              {ACCOUNT_TYPES.map((type) => {
                const group = contraOptions.filter((a) => a.type === type);
                if (group.length === 0) return null;
                return (
                  <optgroup key={type} label={t(`fin_type_${type}` as TranslationKey)}>
                    {group.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {accName(a)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            <label className="text-sm text-slate-600">{t("fin_memo")}</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                onClick={() => setShowNew(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={saveEntry}
                disabled={saving || !contraId || !Number(amount)}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
              >
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

"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  type FinJournal,
} from "@/lib/finance";
import type { TranslationKey } from "@/app/i18n";

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const JOURNAL_TYPES = [
  "sale", "purchase", "receipt", "payment", "cashbook",
  "bank", "journal", "opening", "contra",
];

type JournalLine = {
  id: string;
  journal_id: string;
  line_no: number;
  account_id: string;
  debit: number;
  credit: number;
  party_name: string | null;
  memo: string | null;
};

type FormLine = { account_id: string; debit: string; credit: string; memo: string };

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function emptyLine(): FormLine {
  return { account_id: "", debit: "", credit: "", memo: "" };
}

export default function JournalPage() {
  const { profile } = useAuth();
  const { storeId, stores } = useStore();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [journals, setJournals] = useState<FinJournal[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [typeFilter, setTypeFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jDate, setJDate] = useState(today());
  const [jStore, setJStore] = useState("");
  const jStoreValue = jStore || storeId;
  const [jMemo, setJMemo] = useState("");
  const [formLines, setFormLines] = useState<FormLine[]>([emptyLine(), emptyLine()]);

  const [reverseRow, setReverseRow] = useState<FinJournal | null>(null);
  const [reverseMemo, setReverseMemo] = useState("");
  const [reversing, setReversing] = useState(false);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-journal")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadAccounts().then(setAccounts);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, typeFilter, storeFilter]);

  if (!profile || !hasPermission(profile, "fin-journal")) return null;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function load() {
    setLoading(true);
    let q = supabase
      .from("fin_journals")
      .select("*")
      .order("journal_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (from) q = q.gte("journal_date", from);
    if (to) q = q.lte("journal_date", to);
    if (typeFilter) q = q.eq("journal_type", typeFilter);
    if (storeFilter) q = q.eq("store_id", storeFilter);

    const { data, error } = await q;
    if (error) showToast("❌ " + error.message);
    const list = (data as FinJournal[]) || [];
    setJournals(list);

    if (list.length > 0) {
      const { data: ld } = await supabase
        .from("fin_journal_lines")
        .select("*")
        .in("journal_id", list.map((j) => j.id))
        .order("line_no");
      setLines((ld as JournalLine[]) || []);
    } else {
      setLines([]);
    }
    setLoading(false);
  }

  const accName = (a: FinAccount) => (lang === "my" && a.name_my ? a.name_my : a.name);
  const accountById = useMemo(() => {
    const m = new Map<string, FinAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");

  const linesByJournal = useMemo(() => {
    const m = new Map<string, JournalLine[]>();
    for (const l of lines) {
      const arr = m.get(l.journal_id) || [];
      arr.push(l);
      m.set(l.journal_id, arr);
    }
    return m;
  }, [lines]);

  const journalDebit = (id: string) =>
    (linesByJournal.get(id) || []).reduce((s, l) => s + Number(l.debit || 0), 0);

  const formDebit = formLines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const formCredit = formLines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced =
    formDebit > 0 && Math.round(formDebit * 100) === Math.round(formCredit * 100);

  function setLine(i: number, patch: Partial<FormLine>) {
    setFormLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function resetForm() {
    setJDate(today());
    setJStore(storeId || "");
    setJMemo("");
    setFormLines([emptyLine(), emptyLine()]);
  }

  async function saveJournal() {
    const payloadLines = formLines
      .filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)))
      .map((l) => ({
        account_id: l.account_id,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        memo: l.memo || null,
      }));
    if (payloadLines.length < 2) {
      showToast(t("fin_required"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("fin_save_journal", {
      p: {
        journal_date: jDate,
        store_id: jStoreValue || null,
        memo: jMemo || null,
        lines: payloadLines,
      },
    });
    setSaving(false);
    if (error) {
      showToast("❌ " + error.message);
      return;
    }
    showToast(t("fin_saved"));
    setShowForm(false);
    resetForm();
    await load();
  }

  async function doReverse() {
    if (!reverseRow) return;
    setReversing(true);
    const { error } = await supabase.rpc("fin_reverse_journal", {
      p_journal_id: reverseRow.id,
      p_memo: reverseMemo || null,
    });
    setReversing(false);
    if (error) {
      showToast("❌ " + error.message);
      return;
    }
    showToast(t("fin_saved"));
    setReverseRow(null);
    await load();
  }

  return (
    <div className="pt-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="font-semibold text-lg">{t("fin_journalTitle")}</h2>
        <button
          onClick={() => {
            resetForm();
            setShowForm((v) => !v);
          }}
          className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-semibold shrink-0"
        >
          {showForm ? t("fin_cancel") : t("fin_new")}
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="date"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={jDate}
              onChange={(e) => setJDate(e.target.value)}
            />
            <select
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={jStoreValue}
              onChange={(e) => setJStore(e.target.value)}
            >
              <option value="">{t("fin_store")}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
              placeholder={t("fin_memo")}
              value={jMemo}
              onChange={(e) => setJMemo(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">{t("fin_account")}</th>
                  <th className="text-right px-3 py-2 w-32">{t("fin_debit")}</th>
                  <th className="text-right px-3 py-2 w-32">{t("fin_credit")}</th>
                  <th className="text-left px-3 py-2">{t("fin_memo")}</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {formLines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <select
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        value={l.account_id}
                        onChange={(e) => setLine(i, { account_id: e.target.value })}
                      >
                        <option value="">{t("fin_selectAccount")}</option>
                        {ACCOUNT_TYPES.map((type) => {
                          const group = accounts.filter((a) => a.type === type);
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
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
                        value={l.debit}
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
                        value={l.credit}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        value={l.memo}
                        onChange={(e) => setLine(i, { memo: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formLines.length > 2 && (
                        <button
                          onClick={() => setFormLines((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-slate-400 text-sm"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">
                    {t("fin_totalDebit")} / {t("fin_totalCredit")}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtNum(formDebit)}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(formCredit)}</td>
                  <td className="px-3 py-2" colSpan={2}>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        balanced ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {balanced ? t("fin_balanced") : t("fin_notBalanced")}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={() => setFormLines((prev) => [...prev, emptyLine()])}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium"
            >
              {t("fin_addLine")}
            </button>
            <div className="flex-1" />
            <button
              onClick={saveJournal}
              disabled={!balanced || saving}
              className="bg-slate-900 disabled:bg-slate-300 text-white rounded-lg px-5 py-2 text-sm font-semibold"
            >
              {saving ? "..." : t("fin_save")}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-3">{t("fin_journalHint")}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
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
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">{t("fin_all")}</option>
          {JOURNAL_TYPES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[940px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_no")}</th>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_kind")}</th>
              <th className="text-left px-3 py-2">{t("fin_store")}</th>
              <th className="text-left px-3 py-2">{t("fin_memo")}</th>
              <th className="text-right px-3 py-2">{t("fin_totalDebit")}</th>
              <th className="text-left px-3 py-2">{t("fin_status")}</th>
              <th className="text-right px-3 py-2">{t("fin_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  {t("fin_loading")}
                </td>
              </tr>
            )}
            {!loading &&
              journals.map((j) => (
                <Fragment key={j.id}>
                  <tr
                    className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                    onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{j.journal_no}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{j.journal_date}</td>
                    <td className="px-3 py-2 text-slate-500">{j.journal_type}</td>
                    <td className="px-3 py-2">{storeName(j.store_id)}</td>
                    <td className="px-3 py-2">{j.memo || "-"}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtNum(journalDebit(j.id))}</td>
                    <td className="px-3 py-2">
                      {j.is_reversed && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
                          {t("fin_reversed")}
                        </span>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5">{j.created_by || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {j.is_posted && !j.is_reversed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReverseMemo("");
                            setReverseRow(j);
                          }}
                          className="text-orange-600 text-xs font-medium"
                        >
                          {t("fin_reverse")}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === j.id && (
                    <tr className="border-t border-slate-100 bg-slate-50/60">
                      <td colSpan={8} className="px-3 py-3">
                        <table className="w-full text-sm">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="text-left px-2 py-1">{t("fin_account")}</th>
                              <th className="text-right px-2 py-1">{t("fin_debit")}</th>
                              <th className="text-right px-2 py-1">{t("fin_credit")}</th>
                              <th className="text-left px-2 py-1">{t("fin_memo")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(linesByJournal.get(j.id) || []).map((l) => {
                              const a = accountById.get(l.account_id);
                              return (
                                <tr key={l.id} className="border-t border-slate-200/70">
                                  <td className="px-2 py-1">
                                    {a ? `${a.code} · ${accName(a)}` : l.account_id}
                                  </td>
                                  <td className="px-2 py-1 text-right">{fmtNum(l.debit)}</td>
                                  <td className="px-2 py-1 text-right">{fmtNum(l.credit)}</td>
                                  <td className="px-2 py-1 text-slate-500">
                                    {l.memo || l.party_name || "-"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            {!loading && journals.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  {t("fin_empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reverseRow && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
            <h3 className="font-semibold text-lg mb-1">{t("fin_reverse")}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {reverseRow.journal_no} · {reverseRow.journal_date} ·{" "}
              <strong>{fmtMMK(journalDebit(reverseRow.id))}</strong>
            </p>

            <label className="text-sm text-slate-600">{t("fin_memo")}</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
              value={reverseMemo}
              onChange={(e) => setReverseMemo(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                onClick={() => setReverseRow(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={doReverse}
                disabled={reversing}
                className="flex-1 py-2.5 bg-orange-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
              >
                {reversing ? "..." : t("fin_reverse")}
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

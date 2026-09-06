"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  loadAccounts,
  loadParties,
  parseCsv,
  today,
  type FinAccount,
  type PartyOption,
} from "@/lib/finance";

type ImportKind = "sale" | "purchase" | "accounts";

const VOUCHER_COLS = [
  "date", "party_name", "description", "qty", "unit_price",
  "trade_discount_pct", "account_code", "due_date", "channel", "note",
];

const ACCOUNT_COLS = [
  "code", "name", "name_my", "type", "parent_code", "is_cash", "is_bank", "opening_balance",
];

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];

type ParsedRow = { rowNo: number; values: Record<string, string>; errors: string[] };
type Failure = { rowNo: number; message: string };

const inputCls = "border border-slate-200 rounded-lg px-3 py-2 text-sm";

function num(v: string | undefined): number {
  return Number(String(v ?? "").replace(/,/g, "").trim() || 0);
}

function isBadNumber(v: string | undefined, required: boolean): boolean {
  const raw = String(v ?? "").replace(/,/g, "").trim();
  if (raw === "") return required;
  return Number.isNaN(Number(raw));
}

function truthy(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

export default function FinanceImportPage() {
  const { storeId, stores } = useStore();
  const { profile } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [kind, setKind] = useState<ImportKind>("sale");
  const [targetStore, setTargetStore] = useState("");
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<number | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-import")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    (async () => {
      const [acc, cust, sup] = await Promise.all([
        loadAccounts(),
        loadParties("customer"),
        loadParties("supplier"),
      ]);
      setAccounts(acc);
      setCustomers(cust);
      setSuppliers(sup);
    })();
  }, []);

  useEffect(() => {
    if (storeId && !targetStore) setTargetStore(storeId);
  }, [storeId, targetStore]);

  if (!profile || !hasPermission(profile, "fin-import")) return null;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const columns = kind === "accounts" ? ACCOUNT_COLS : VOUCHER_COLS;
  const accountCodes = useMemo(() => new Set(accounts.map((a) => a.code)), [accounts]);

  function downloadTemplate() {
    const csv = columns.join(",") + "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function validate(v: Record<string, string>): string[] {
    const errs: string[] = [];
    if (kind === "accounts") {
      if (!v.code?.trim()) errs.push(`code: ${t("fin_required")}`);
      if (!v.name?.trim()) errs.push(`name: ${t("fin_required")}`);
      if (!ACCOUNT_TYPES.includes((v.type || "").trim())) errs.push(`type: ${t("fin_required")}`);
      if (isBadNumber(v.opening_balance, false)) errs.push("opening_balance");
      if (v.parent_code?.trim() && !accountCodes.has(v.parent_code.trim())) {
        errs.push(`parent_code: ${v.parent_code}`);
      }
    } else {
      if (!v.date?.trim()) errs.push(`date: ${t("fin_required")}`);
      if (!v.party_name?.trim()) errs.push(`party_name: ${t("fin_required")}`);
      if (!v.description?.trim()) errs.push(`description: ${t("fin_required")}`);
      if (isBadNumber(v.qty, true)) errs.push("qty");
      if (isBadNumber(v.unit_price, true)) errs.push("unit_price");
      if (isBadNumber(v.trade_discount_pct, false)) errs.push("trade_discount_pct");
      if (v.account_code?.trim() && !accountCodes.has(v.account_code.trim())) {
        errs.push(`account_code: ${v.account_code}`);
      }
    }
    return errs;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setDone(null);
    setFailures([]);
    const text = await file.text();
    const grid = parseCsv(text);
    if (grid.length === 0) {
      setHeader([]);
      setRows([]);
      return;
    }
    const head = grid[0].map((h) => h.trim().toLowerCase());
    setHeader(head);
    const parsed: ParsedRow[] = grid.slice(1).map((cells, idx) => {
      const values: Record<string, string> = {};
      head.forEach((h, i) => { values[h] = (cells[i] ?? "").trim(); });
      return { rowNo: idx + 2, values, errors: validate(values) };
    });
    setRows(parsed);
  }

  // Re-check every row when the account list or the target kind changes, so the
  // preview never shows validation from a previous selection.
  useEffect(() => {
    setRows((prev) => prev.map((r) => ({ ...r, errors: validate(r.values) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, accounts]);

  async function importRow(r: ParsedRow) {
    const v = r.values;
    if (kind === "accounts") {
      const { error } = await supabase.from("fin_accounts").insert({
        code: v.code.trim(),
        name: v.name.trim(),
        name_my: v.name_my?.trim() || null,
        type: v.type.trim(),
        parent_code: v.parent_code?.trim() || null,
        is_cash: truthy(v.is_cash),
        is_bank: truthy(v.is_bank),
        opening_balance: num(v.opening_balance),
      });
      if (error) throw error;
      return;
    }
    const partyType = kind === "sale" ? "customer" : "supplier";
    const list = kind === "sale" ? customers : suppliers;
    const name = v.party_name.trim();
    const match = list.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    const { error } = await supabase.rpc("fin_save_voucher", {
      p: {
        kind,
        voucher_date: v.date.trim() || today(),
        due_date: v.due_date?.trim() || null,
        store_id: targetStore || null,
        channel: kind === "sale" ? v.channel?.trim() || null : null,
        party_type: partyType,
        party_id: match?.id || null,
        party_name: name,
        note: v.note?.trim() || null,
        items: [
          {
            description: v.description.trim(),
            qty: num(v.qty),
            unit_price: num(v.unit_price),
            trade_discount_pct: num(v.trade_discount_pct),
            account_code: v.account_code?.trim() || null,
          },
        ],
      },
    });
    if (error) throw error;
  }

  async function run() {
    if (rows.length === 0) return;
    setRunning(true);
    setProgress(0);
    setDone(null);
    const fails: Failure[] = [];
    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (r.errors.length > 0) throw new Error(r.errors.join(", "));
        await importRow(r);
        ok++;
      } catch (err) {
        fails.push({ rowNo: r.rowNo, message: err instanceof Error ? err.message : String(err) });
      }
      setProgress(i + 1);
    }
    setFailures(fails);
    setDone(ok);
    setRunning(false);
    if (kind === "accounts") setAccounts(await loadAccounts());
    showToast(t("fin_importDone").replace("{n}", String(ok)));
  }

  const preview = rows.slice(0, 20);
  const badCount = rows.filter((r) => r.errors.length > 0).length;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-1">{t("fin_importTitle")}</h2>
      <p className="text-sm text-slate-500 mb-4">{t("fin_importHint")}</p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-slate-500 block mb-1">{t("fin_kind")}</label>
            <select className={inputCls} value={kind}
              onChange={(e) => {
                setKind(e.target.value as ImportKind);
                setRows([]);
                setHeader([]);
                setFileName("");
                setDone(null);
                setFailures([]);
              }}>
              <option value="sale">{t("fin_kind_sale")}</option>
              <option value="purchase">{t("fin_kind_purchase")}</option>
              <option value="accounts">{t("fin_accountsTitle")}</option>
            </select>
          </div>
          {kind !== "accounts" && (
            <div>
              <label className="text-xs text-slate-500 block mb-1">{t("fin_store")}</label>
              <select className={inputCls} value={targetStore}
                onChange={(e) => setTargetStore(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <button onClick={downloadTemplate}
            className="border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium">
            {t("fin_importTemplate")}
          </button>
          <div>
            <label className="text-xs text-slate-500 block mb-1">CSV</label>
            <input type="file" accept=".csv,.txt,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="text-sm" />
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3 font-mono break-all">{columns.join(",")}</p>
        {fileName && <p className="text-xs text-slate-500 mt-1">{fileName}</p>}
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold">
              {t("fin_importPreview")}{" "}
              <span className="text-slate-500 font-normal text-sm">
                {rows.length} {t("fin_importRows")}
              </span>
            </h3>
            <button onClick={run} disabled={running}
              className="bg-green-600 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold">
              {running ? `${progress} / ${rows.length}` : t("fin_importRun")}
            </button>
          </div>
          {badCount > 0 && (
            <p className="text-xs text-orange-600 mb-2">{badCount} · {t("fin_required")}</p>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  {columns.map((c) => (
                    <th key={c} className="text-left px-3 py-2 whitespace-nowrap">{c}</th>
                  ))}
                  <th className="text-left px-3 py-2">{t("fin_status")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.rowNo} className={`border-t border-slate-100 ${r.errors.length ? "bg-orange-50/40" : ""}`}>
                    <td className="px-3 py-2 text-slate-400">{r.rowNo}</td>
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-2 whitespace-nowrap">{r.values[c] || "-"}</td>
                    ))}
                    <td className="px-3 py-2 text-xs">
                      {r.errors.length === 0 ? (
                        <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">OK</span>
                      ) : (
                        <span className="text-orange-700">{r.errors.join(", ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {header.length > 0 && header.join(",") !== columns.join(",") && (
            <p className="text-xs text-slate-400 -mt-4 mb-6 font-mono break-all">{header.join(",")}</p>
          )}
        </>
      )}

      {done !== null && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="font-semibold text-green-700">
            {t("fin_importDone").replace("{n}", String(done))}
          </div>
          {failures.length > 0 && (
            <>
              <div className="font-semibold text-red-600 mt-3 mb-2">{t("fin_importFailed")}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 w-16">#</th>
                      <th className="text-left px-3 py-2">{t("fin_note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.map((f) => (
                      <tr key={f.rowNo} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-400">{f.rowNo}</td>
                        <td className="px-3 py-2 text-red-600">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {rows.length === 0 && fileName && (
        <div className="text-center text-slate-400 py-8">{t("fin_empty")}</div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

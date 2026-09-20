"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { useStore } from "@/app/store-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, today } from "@/lib/finance";

type Line = { code: string; name: string; amount: number; prev: number };
type StoreRow = { store: string; sales: number; prev_sales: number; expenses: number; net: number };
type ChanRow = { channel: string; sales: number; prev_sales: number; orders: number };
type PL = {
  income: Line[]; expense: Line[];
  by_store: StoreRow[]; by_channel: ChanRow[];
  totals: { income: number; cogs: number; expense: number;
            prev_income: number; prev_cogs: number; prev_expense: number };
};

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
const n = (v: unknown) => Number(v || 0);
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const FIELD = "border border-slate-200 rounded-lg px-3 py-2 text-sm";

export default function PLPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const { t } = useLanguage();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [store, setStore] = useState("");
  const [pl, setPl] = useState<PL | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, store]);

  if (!profile || !hasPermission(profile, "fin-pl")) return null;

  async function load() {
    const { data } = await supabase.rpc("fin_pl", { p_from: from, p_to: to, p_store: store || null });
    setPl((data as PL) || null);
  }

  const T = pl?.totals;
  const inc = n(T?.income), cogs = n(T?.cogs), exp = n(T?.expense);
  const pInc = n(T?.prev_income), pCogs = n(T?.prev_cogs), pExp = n(T?.prev_expense);
  const gp = inc - cogs, pGp = pInc - pCogs;
  const net = gp - exp, pNet = pGp - pExp;
  const storeName = (id: string) => (id === "-" ? "-" : stores.find((s) => s.id === id)?.name || id);

  function Delta({ now, before }: { now: number; before: number }) {
    if (!before) return <span className="text-xs text-slate-400">-</span>;
    const p = ((now - before) / Math.abs(before)) * 100;
    return (
      <span className={"text-xs " + (p >= 0 ? "text-green-600" : "text-red-600")}>
        {(p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + "%"}
      </span>
    );
  }

  // One workbook, one sheet per way of looking at the same period.
  function toExcel() {
    const wb = XLSX.utils.book_new();
    const summary = [
      ["Profit & Loss", from + " to " + to, store ? storeName(store) : "All stores"],
      [],
      ["", "This period", "Previous"],
      ["Sales", inc, pInc],
      ["Cost of goods", cogs, pCogs],
      ["Gross profit", gp, pGp],
      ["Gross margin %", pct(gp, inc), pct(pGp, pInc)],
      ["Markup %", pct(gp, cogs), pct(pGp, pCogs)],
      ["Expenses", exp, pExp],
      ["Net profit", net, pNet],
      ["Net margin %", pct(net, inc), pct(pNet, pInc)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      (pl?.income || []).map((l) => ({ Code: l.code, Account: l.name, Amount: l.amount, Previous: l.prev }))
    ), "Income");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      (pl?.expense || []).map((l) => ({ Code: l.code, Account: l.name, Amount: l.amount, Previous: l.prev }))
    ), "Expenses");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      (pl?.by_store || []).map((r) => ({
        Store: storeName(r.store), Sales: r.sales, Previous: r.prev_sales,
        Expenses: r.expenses, Net: r.net,
      }))
    ), "By store");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      (pl?.by_channel || []).map((r) => ({
        Channel: r.channel, Orders: r.orders, Sales: r.sales, Previous: r.prev_sales,
      }))
    ), "By channel");

    XLSX.writeFile(wb, "profit-and-loss-" + from + "-to-" + to + ".xlsx");
  }

  const Row = ({ label, now, before, bold, tone }:
    { label: string; now: number; before: number; bold?: boolean; tone?: string }) => (
    <tr className={"border-t border-slate-100 " + (bold ? "font-semibold bg-slate-50" : "")}>
      <td className="px-3 py-2">{label}</td>
      <td className={"px-3 py-2 text-right " + (tone || "")}>{fmtMMK(now)}</td>
      <td className="px-3 py-2 text-right text-slate-400">{fmtMMK(before)}</td>
      <td className="px-3 py-2 text-right"><Delta now={now} before={before} /></td>
    </tr>
  );

  return (
    <div className="pt-4 max-w-5xl print:max-w-none">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4 print:hidden">
        <h2 className="font-semibold text-lg">{t("nav_finPL")}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} />
          <select className={FIELD} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">{t("fin_store")}: All</option>
            {stores.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button onClick={toExcel} className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium">
            Excel
          </button>
          <button onClick={() => window.print()} className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium">
            PDF
          </button>
        </div>
      </div>

      <div className="hidden print:block mb-4">
        <h2 className="font-semibold text-lg">Profit & Loss</h2>
        <p className="text-sm text-slate-500">{from} — {to} · {store ? storeName(store) : "All stores"}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Sales</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(inc)}</div>
          <Delta now={inc} before={pInc} />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Cost of goods</div>
          <div className="text-lg font-bold mt-1 text-orange-700">{fmtMMK(cogs)}</div>
          {cogs ? <Delta now={cogs} before={pCogs} /> : <div className="text-xs text-slate-400">waiting on product costs</div>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Gross profit</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(gp)}</div>
          <div className="text-xs text-slate-500">Margin {pct(gp, inc).toFixed(1)}%</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Markup</div>
          <div className="text-lg font-bold mt-1">{cogs ? pct(gp, cogs).toFixed(1) + "%" : "-"}</div>
          <div className="text-xs text-slate-500">on cost</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">Net profit</div>
          <div className={"text-lg font-bold mt-1 " + (net >= 0 ? "text-green-700" : "text-red-600")}>
            {fmtMMK(net)}
          </div>
          <div className="text-xs text-slate-500">Margin {pct(net, inc).toFixed(1)}%</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Profit and loss</th>
              <th className="text-right px-3 py-2">This period</th>
              <th className="text-right px-3 py-2">Previous</th>
              <th className="text-right px-3 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Sales" now={inc} before={pInc} />
            <Row label="Cost of goods" now={cogs} before={pCogs} />
            <Row label="Gross profit" now={gp} before={pGp} bold />
            <Row label="Expenses" now={exp} before={pExp} />
            <Row label="Net profit" now={net} before={pNet} bold
              tone={net >= 0 ? "text-green-700" : "text-red-600"} />
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        <div>
          <h3 className="font-semibold mb-2">By channel</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Channel</th>
                  <th className="text-right px-3 py-2">Orders</th>
                  <th className="text-right px-3 py-2">Sales</th>
                  <th className="text-right px-3 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {(pl?.by_channel || []).map((r) => (
                  <tr key={r.channel} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.channel}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{r.orders}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMMK(r.sales)}</td>
                    <td className="px-3 py-2 text-right"><Delta now={n(r.sales)} before={n(r.prev_sales)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">By store</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Store</th>
                  <th className="text-right px-3 py-2">Sales</th>
                  <th className="text-right px-3 py-2">Expenses</th>
                  <th className="text-right px-3 py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {(pl?.by_store || []).map((r) => (
                  <tr key={r.store} className="border-t border-slate-100">
                    <td className="px-3 py-2">{storeName(r.store)}</td>
                    <td className="px-3 py-2 text-right">{fmtMMK(r.sales)}</td>
                    <td className="px-3 py-2 text-right text-orange-700">{fmtMMK(r.expenses)}</td>
                    <td className={"px-3 py-2 text-right font-medium " +
                      (n(r.net) >= 0 ? "text-green-700" : "text-red-600")}>{fmtMMK(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <h3 className="font-semibold mb-2">Income accounts</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(pl?.income || []).map((l) => (
                  <tr key={l.code} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2 text-xs text-slate-400">{l.code}</td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2 text-right">{fmtMMK(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="font-semibold mb-2">Expense accounts</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {(pl?.expense || []).map((l) => (
                  <tr key={l.code} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2 text-xs text-slate-400">{l.code}</td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2 text-right">{fmtMMK(l.amount)}</td>
                  </tr>
                ))}
                {(pl?.expense || []).length === 0 && (
                  <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={3}>{t("fin_empty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4">
        Cost of goods arrives with the product costs; until then margin and markup read as zero.
      </p>
    </div>
  );
}

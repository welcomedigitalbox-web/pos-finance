"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK } from "@/lib/finance";

// What the stock is worth, and what the selling of it earned.
//
// Two questions finance has to answer every month and could not: the value to
// put on the balance sheet, and whether the margin on a line is what the
// buying was supposed to deliver. Both come from the same place the shops
// use, so the shop floor and the accounts cannot disagree.
type Row = {
  id: string;
  sku: string | null;
  name: string;
  total_qty: number;
  total_value: number;
  by_store: Record<string, number>;
};

type Summary = {
  store_id: string;
  skus_in_stock: number;
  total_qty: number;
  total_value: number;
  negative_rows: number;
  no_cost_rows: number;
};

type Gp = {
  code: string | null;
  description: string;
  category: string | null;
  qty: number;
  sales: number;
  cost: number;
  gp: number;
};

function n0(n: unknown) {
  return Math.round(Number(n) || 0).toLocaleString();
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date().toISOString().slice(0, 8) + "01";

export default function FinanceCostingPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<"valuation" | "margin">("valuation");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [gp, setGp] = useState<Gp[]>([]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-costing")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (tab === "valuation") loadValuation();
    else loadMargin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const blocked = !profile || !hasPermission(profile, "fin-costing");

  async function loadValuation() {
    setLoading(true);
    setErr("");
    // One json value rather than a row per product and shop: a REST reply
    // stops at a thousand rows and this is twenty thousand of them.
    const [main, sum] = await Promise.all([
      supabase.rpc("stock_on_hand_json"),
      supabase.from("stock_on_hand_by_store").select("*"),
    ]);
    const e = main.error || sum.error;
    if (e) setErr(e.message);
    setRows((main.data as Row[]) || []);
    setSummary((sum.data as Summary[]) || []);
    setLoading(false);
  }

  async function loadMargin() {
    setLoading(true);
    setErr("");
    const { data, error } = await supabase.rpc("product_gp_report", {
      p_from: from, p_to: to, p_store: null,
    });
    if (error) setErr(error.message);
    setGp((data as Gp[]) || []);
    setLoading(false);
  }

  const shownStock = useMemo(() => {
    let out = rows.filter((r) => Number(r.total_qty) !== 0);
    if (q) {
      const s = q.toLowerCase();
      out = out.filter(
        (r) => (r.sku || "").toLowerCase().includes(s) || r.name.toLowerCase().includes(s)
      );
    }
    return out.sort((a, b) => Number(b.total_value) - Number(a.total_value));
  }, [rows, q]);

  const shownGp = useMemo(() => {
    let out = gp.filter((r) => Number(r.qty) !== 0);
    if (q) {
      const s = q.toLowerCase();
      out = out.filter(
        (r) => (r.code || "").toLowerCase().includes(s) || r.description.toLowerCase().includes(s)
      );
    }
    return out.sort((a, b) => Number(b.sales) - Number(a.sales));
  }, [gp, q]);

  const totalValue = shownStock.reduce((s, r) => s + Number(r.total_value || 0), 0);
  const noCost = summary.reduce((s, r) => s + Number(r.no_cost_rows || 0), 0);
  const negative = summary.reduce((s, r) => s + Number(r.negative_rows || 0), 0);

  const gpSales = shownGp.reduce((s, r) => s + Number(r.sales || 0), 0);
  const gpCost = shownGp.reduce((s, r) => s + Number(r.cost || 0), 0);

  if (blocked) return null;

  const tabClass = (k: string) =>
    `px-3 py-1.5 text-sm rounded-lg ${
      tab === k ? "bg-blue-600 text-white font-medium" : "bg-white border border-slate-200 text-slate-600"
    }`;

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <h1 className="text-xl font-semibold">Costing</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-4">
        What the stock is worth, and what selling it earned. The same figures
        the shops see, so the ledger and the shelf agree.
      </p>

      <div className="flex gap-2 mb-4">
        <button className={tabClass("valuation")} onClick={() => setTab("valuation")}>
          Stock valuation
        </button>
        <button className={tabClass("margin")} onClick={() => setTab("margin")}>
          COGS &amp; margin
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2 mb-4 text-xs">
          {err}
        </div>
      )}

      {tab === "valuation" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {summary
              .slice()
              .sort((a, b) => a.store_id.localeCompare(b.store_id))
              .map((s) => (
                <div key={s.store_id} className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-xs text-slate-500">
                    {stores.find((x) => x.id === s.store_id)?.name || s.store_id}
                  </div>
                  <div className="font-semibold">{fmtMMK(s.total_value)}</div>
                  <div className="text-[11px] text-slate-400">
                    {n0(s.skus_in_stock)} SKU · {n0(s.total_qty)} pcs
                  </div>
                </div>
              ))}
          </div>

          {(noCost > 0 || negative > 0) && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 mb-4 text-xs">
              {noCost > 0 && (
                <div>
                  {n0(noCost)} line(s) hold stock with no cost — their value counts as
                  nothing, so the figure below is understated.
                </div>
              )}
              {negative > 0 && (
                <div>{n0(negative)} line(s) are below zero — stock left that was never booked in.</div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            <input
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 max-w-sm"
              placeholder="Search code or name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="ml-auto text-sm text-slate-500">
              {n0(shownStock.length)} SKU &middot;{" "}
              <span className="font-semibold">{fmtMMK(totalValue)}</span>
            </span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Value at cost</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={4} className="text-center text-slate-400 py-10">Counting...</td></tr>
                )}
                {!loading && shownStock.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-400">{r.sku || "-"}</td>
                    <td className="px-3 py-1.5 text-right">{n0(r.total_qty)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtMMK(r.total_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {shownStock.length > 500 && (
            <p className="text-xs text-slate-400 mt-2">
              Showing the 500 largest by value, of {n0(shownStock.length)}.
            </p>
          )}
        </>
      )}

      {tab === "margin" && (
        <>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <label className="text-xs text-slate-500">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="mt-1 block border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </label>
            <button
              onClick={loadMargin}
              className="px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium"
            >
              Show
            </button>
            <input
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]"
              placeholder="Search code or name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-xs text-slate-500">Sales</div>
              <div className="font-semibold">{fmtMMK(gpSales)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-xs text-slate-500">Cost of goods sold</div>
              <div className="font-semibold">{fmtMMK(gpCost)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-xs text-slate-500">Gross profit</div>
              <div className="font-semibold text-green-700">
                {fmtMMK(gpSales - gpCost)}
                {gpSales > 0 && (
                  <span className="text-xs text-slate-400 font-normal">
                    {" "}· {(((gpSales - gpCost) / gpSales) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Sales</th>
                  <th className="text-right px-3 py-2">Cost</th>
                  <th className="text-right px-3 py-2">GP</th>
                  <th className="text-right px-3 py-2">%</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-10">...</td></tr>
                )}
                {!loading && shownGp.slice(0, 500).map((r, i) => {
                  const pct = Number(r.sales) > 0 ? (Number(r.gp) / Number(r.sales)) * 100 : 0;
                  return (
                    <tr key={`${r.code}-${i}`} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{r.description}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{r.code || "-"}</td>
                      <td className="px-3 py-1.5 text-right">{n0(r.qty)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMMK(r.sales)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">{fmtMMK(r.cost)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMMK(r.gp)}</td>
                      <td className={`px-3 py-1.5 text-right ${pct < 10 ? "text-red-600" : ""}`}>
                        {pct.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
                {!loading && shownGp.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-10">Nothing sold.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

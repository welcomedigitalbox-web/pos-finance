"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, today } from "@/lib/finance";

type Line = {
  id: string;
  return_id: string;
  product_name: string | null;
  qty: number;
  unit_price: number | null;
  unit_cogs: number | null;
  condition: string | null;
};

type CreditNote = {
  id: string;
  return_number: string | null;
  sale_ref: string | null;
  original_sale_id: string | null;
  store_id: string | null;
  processed_store_id: string | null;
  customer_name: string | null;
  refund_amount: number;
  refund_method: string | null;
  refund_payment_method: string | null;
  status: string;
  reason: string | null;
  is_correction: boolean | null;
  corrected_by: string | null;
  requested_by: string | null;
  approved_by: string | null;
  created_at: string;
};

// What happened to the goods decides whether the cost came back with the
// money. A shop assistant reads this column more often than the amount.
const CONDITION_LABEL: Record<string, string> = {
  good: "Back on shelf",
  damaged: "Back, damaged",
  not_returned: "Not returned",
};

const CONDITION_TONE: Record<string, string> = {
  good: "bg-green-100 text-green-700",
  damaged: "bg-amber-100 text-amber-700",
  not_returned: "bg-red-100 text-red-700",
};

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function CreditNotesPage() {
  const { profile } = useAuth();
  const { stores } = useStore();
  const router = useRouter();

  const [rows, setRows] = useState<CreditNote[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [journals, setJournals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [storeFilter, setStoreFilter] = useState("");
  const [kind, setKind] = useState<"" | "correction" | "return">("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-credit-notes")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, storeFilter, kind]);

  const pageBlocked = !profile || !hasPermission(profile, "fin-credit-notes");

  async function load() {
    setLoading(true);

    // Only what has actually been refunded belongs on this screen; a request
    // still waiting on a manager is not yet a credit note.
    let q = supabase
      .from("sale_returns")
      .select("*")
      .in("status", ["approved", "completed", "refunded"])
      .order("created_at", { ascending: false })
      .limit(300);

    // The day the shop was open, not the server's day.
    if (from) q = q.gte("created_at", `${from}T00:00:00+06:30`);
    if (to) q = q.lte("created_at", `${to}T23:59:59+06:30`);

    const { data } = await q;
    let list = (data as CreditNote[]) || [];

    if (storeFilter) {
      list = list.filter(
        (r) => (r.processed_store_id || r.store_id) === storeFilter
      );
    }
    if (kind === "correction") list = list.filter((r) => r.is_correction);
    if (kind === "return") list = list.filter((r) => !r.is_correction);

    setRows(list);

    const ids = list.map((r) => r.id);
    if (ids.length) {
      const [{ data: li }, { data: js }] = await Promise.all([
        supabase.from("sale_return_items").select("*").in("return_id", ids),
        supabase
          .from("fin_journals")
          .select("journal_no, source_id")
          .eq("source_type", "sale_return")
          .in("source_id", ids),
      ]);
      setLines((li as Line[]) || []);
      const map: Record<string, string> = {};
      for (const j of (js as { journal_no: string; source_id: string }[]) || []) {
        map[j.source_id] = j.journal_no;
      }
      setJournals(map);
    } else {
      setLines([]);
      setJournals({});
    }

    setLoading(false);
  }

  const visible = search.trim()
    ? rows.filter((r) => {
        const q = search.trim().toLowerCase();
        return (
          (r.return_number || "").toLowerCase().includes(q) ||
          (r.sale_ref || "").toLowerCase().includes(q) ||
          (r.customer_name || "").toLowerCase().includes(q)
        );
      })
    : rows;

  const totalRefund = visible.reduce((s, r) => s + Number(r.refund_amount || 0), 0);
  const correctionCount = visible.filter((r) => r.is_correction).length;

  if (pageBlocked) return null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <h1 className="text-xl font-semibold">Credit notes</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-5">
        Every refund and invoice correction, and what became of the goods
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        />
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All branches</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "" | "correction" | "return")}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All</option>
          <option value="correction">Finance corrections</option>
          <option value="return">Shop returns</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search CN / invoice / customer"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white w-56"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-xs text-slate-400">Credit notes</div>
          <div className="text-lg font-semibold">{visible.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-xs text-slate-400">Refunded</div>
          <div className="text-lg font-semibold">{fmtMMK(totalRefund)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="text-xs text-slate-400">Of which corrections</div>
          <div className="text-lg font-semibold">{correctionCount}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Credit note</th>
              <th className="text-left px-3 py-2">Invoice</th>
              <th className="text-left px-3 py-2">Branch</th>
              <th className="text-left px-3 py-2">Customer</th>
              <th className="text-left px-3 py-2">Raised by</th>
              <th className="text-left px-3 py-2">Journal</th>
              <th className="text-right px-3 py-2">Refund</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const mine = lines.filter((l) => l.return_id === r.id);
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setExpanded(open ? null : r.id)}
                    className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString("en-CA", {
                        timeZone: "Asia/Yangon",
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.return_number || "-"}</span>
                      {r.is_correction && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700">
                          correction
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.sale_ref || "-"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.processed_store_id || r.store_id || "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.customer_name || "Walk-in"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {r.corrected_by || r.approved_by || r.requested_by || "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {journals[r.id] || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-red-600">
                      {fmtMMK(r.refund_amount)}
                    </td>
                  </tr>

                  {open && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-4 py-3">
                        {r.reason && (
                          <p className="text-sm text-slate-600 mb-3">
                            <span className="text-slate-400">Reason: </span>
                            {r.reason}
                          </p>
                        )}
                        <table className="w-full text-sm">
                          <thead className="text-slate-400">
                            <tr>
                              <th className="text-left py-1">Item</th>
                              <th className="text-right py-1">Qty</th>
                              <th className="text-right py-1">Unit price</th>
                              <th className="text-left py-1 pl-4">Goods</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mine.map((l) => (
                              <tr key={l.id} className="border-t border-slate-200">
                                <td className="py-1.5">{l.product_name || "-"}</td>
                                <td className="py-1.5 text-right">{l.qty}</td>
                                <td className="py-1.5 text-right">
                                  {fmtMMK(l.unit_price || 0)}
                                </td>
                                <td className="py-1.5 pl-4">
                                  <span
                                    className={
                                      "px-2 py-0.5 rounded text-xs " +
                                      (CONDITION_TONE[l.condition || ""] ||
                                        "bg-slate-100 text-slate-600")
                                    }
                                  >
                                    {CONDITION_LABEL[l.condition || ""] ||
                                      l.condition ||
                                      "-"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {mine.length === 0 && (
                              <tr>
                                <td colSpan={4} className="py-3 text-slate-400">
                                  No lines recorded
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        <p className="text-xs text-slate-400 mt-3">
                          Refunded by {r.refund_payment_method || r.refund_method || "—"}
                          {r.original_sale_id && ` · sale ${r.original_sale_id.slice(0, 8)}`}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-12">
                  No credit notes in this period
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-12">
                  …
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

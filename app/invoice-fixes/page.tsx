"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, errorText } from "@/lib/finance";

// Shops report a mistyped invoice; this is where it is actually corrected.
// Applying one rewrites the invoice's lines and totals, puts stock back if a
// quantity fell, and keeps a before and after copy on the record.
type Line = { item_id: string; qty: number; unit_price: number };

type Row = {
  id: string;
  sale_id: string;
  sale_ref: string;
  store_id: string;
  reason: string;
  lines: Line[];
  status: string;
  total_before: number | null;
  total_after: number | null;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  before_snap: unknown;
  after_snap: unknown;
};

type Item = {
  id: string;
  product_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export default function FinanceInvoiceFixesPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<"pending" | "applied" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [open, setOpen] = useState<Row | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-payments")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!profile || !hasPermission(profile, "fin-payments")) return null;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sale_corrections")
      .select("*")
      .eq("status", tab)
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) showToast("❌ " + error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  }

  function storeName(id: string) {
    return stores.find((s) => s.id === id)?.name || id;
  }

  async function openRow(r: Row) {
    setOpen(r);
    setNote("");
    setItems([]);
    const { data } = await supabase
      .from("sale_items")
      .select("id,product_name,qty,unit_price,line_total")
      .eq("sale_id", r.sale_id);
    setItems((data as Item[]) || []);
  }

  async function apply() {
    if (!open) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("apply_sale_correction", {
        p_id: open.id,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      const res = (data || {}) as Record<string, number | string>;
      const extra =
        Number(res.overpaid) > 0
          ? ` The customer overpaid by ${fmtMMK(Number(res.overpaid))} — refund it from Refunds.`
          : Number(res.owing) > 0
          ? ` ${fmtMMK(Number(res.owing))} is now owing on it.`
          : "";
      showToast(`${open.sale_ref} corrected.${extra}`);
      setOpen(null);
      await load();
    } catch (err) {
      showToast("❌ " + errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!open) return;
    if (!note.trim()) return showToast("Say why it is being turned down");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("reject_sale_correction", {
        p_id: open.id,
        p_note: note.trim(),
      });
      if (error) throw error;
      showToast(`${open.sale_ref} turned down`);
      setOpen(null);
      await load();
    } catch (err) {
      showToast("❌ " + errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const asked = (r: Row, itemId: string) => r.lines.find((l) => l.item_id === itemId);

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-1">Invoice corrections</h2>
      <p className="text-sm text-slate-500 mb-4">
        Prices and quantities the shops typed in wrong. Applying one rewrites the
        invoice and puts stock back; the original lines are kept on the record.
      </p>

      <div className="flex items-center gap-2 mb-4">
        {(["pending", "applied", "rejected"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === k ? "bg-slate-900 text-white" : "border border-slate-200"
            }`}
          >
            {k === "pending" ? "To decide" : k === "applied" ? "Applied" : "Turned down"}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-500">{rows.length}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Invoice</th>
              <th className="text-left px-3 py-2">Shop</th>
              <th className="text-left px-3 py-2">What is wrong</th>
              <th className="text-right px-3 py-2">Now</th>
              <th className="text-left px-3 py-2">Asked by</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-8">
                  ...
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.sale_ref}</td>
                  <td className="px-3 py-2">{storeName(r.store_id)}</td>
                  <td className="px-3 py-2">
                    {r.reason}
                    <div className="text-[10px] text-slate-400">
                      {r.lines?.length || 0} line(s)
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {fmtMMK(Number(r.total_before) || 0)}
                    {r.total_after != null && (
                      <div className="text-[10px] text-green-700">
                        &rarr; {fmtMMK(Number(r.total_after))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.requested_by}
                    <div className="text-[10px] text-slate-400">
                      {new Date(r.requested_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openRow(r)}
                      className="text-blue-600 text-xs font-semibold"
                    >
                      {r.status === "pending" ? "Review" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-8">
                  -
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-1">{open.sale_ref}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {storeName(open.store_id)} &middot; {open.reason}
            </p>

            <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">On the invoice</th>
                    <th className="text-right px-3 py-2">Shop says</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const a = asked(open, i.id);
                    return (
                      <tr
                        key={i.id}
                        className={`border-t border-slate-100 ${a ? "bg-amber-50" : ""}`}
                      >
                        <td className="px-3 py-2">{i.product_name}</td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {i.qty} &times; {fmtMMK(i.unit_price)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {a ? `${a.qty} × ${fmtMMK(a.unit_price)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {open.status === "pending" ? (
              <>
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 mb-3 text-xs">
                  Applying this rewrites the invoice lines and totals, and puts
                  stock back if a quantity falls. Money already taken is not
                  touched: if the new total is lower the customer is owed a
                  refund, if higher the difference becomes owing.
                </div>
                <label className="text-sm text-slate-600">Note</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
                  placeholder="Checked against the till roll"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setOpen(null)}
                    className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
                  >
                    Close
                  </button>
                  <button
                    onClick={reject}
                    disabled={busy}
                    className="flex-1 py-2.5 border border-red-200 text-red-700 disabled:text-slate-300 rounded-lg text-sm font-semibold"
                  >
                    Turn down
                  </button>
                  <button
                    onClick={apply}
                    disabled={busy}
                    className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
                  >
                    {busy ? "..." : "Apply"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-500 mb-4">
                  {open.status} by {open.decided_by} on{" "}
                  {open.decided_at ? new Date(open.decided_at).toLocaleString() : "-"}
                  {open.decision_note ? ` — ${open.decision_note}` : ""}
                </div>
                <button
                  onClick={() => setOpen(null)}
                  className="w-full py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50 max-w-md text-center">
          {toast}
        </div>
      )}
    </div>
  );
}

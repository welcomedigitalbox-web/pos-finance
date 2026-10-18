"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK } from "@/lib/finance";

// Purchase orders, as finance needs to see them: in full, and not editable.
//
// The order belongs to merchandising. Finance pays against it, so finance has
// to be able to read every line, what has actually arrived, what the freight
// was and what has already been paid - the three-way match. Anything that
// needs changing goes back with the bill, rather than being quietly altered
// by whoever is looking at it.
type PO = {
  id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  order_date: string;
  expected_date: string | null;
  payment_term: string | null;
  discount_amount: number | null;
  note: string | null;
};

type Item = {
  id: string;
  product_id: string;
  qty: number;
  received_qty: number;
  unit_cost: number;
};

type Charge = { id: string; kind: string; note: string | null; amount: number };
type Totals = { po_id: string; subtotal: number; charges_total: number; discount_amount: number; grand_total: number };
type Doc = { id: string; kind: string; title: string | null; file_path: string; created_at: string };
type Pay = { id: string; amount: number; paid_at: string; method: string | null; note: string | null };

export default function FinancePurchaseOrdersPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [totals, setTotals] = useState<Record<string, Totals>>({});
  const [products, setProducts] = useState<Record<string, { name: string; sku: string | null }>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState<PO | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-purchase-orders")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
  }, []);

  const blocked = !profile || !hasPermission(profile, "fin-purchase-orders");

  async function load() {
    setLoading(true);
    const [{ data: po }, { data: sup }, { data: tot }] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id,po_number,supplier_id,status,order_date,expected_date,payment_term,discount_amount,note")
        .order("order_date", { ascending: false })
        .limit(300),
      supabase.from("suppliers").select("id,name"),
      supabase.from("po_totals").select("*").limit(1000),
    ]);

    setRows((po as PO[]) || []);
    setSuppliers(
      Object.fromEntries(((sup as { id: string; name: string }[]) || []).map((s) => [s.id, s.name]))
    );
    setTotals(
      Object.fromEntries(((tot as Totals[]) || []).map((t) => [t.po_id, t]))
    );
    setLoading(false);
  }

  async function openPo(po: PO) {
    setOpen(po);
    setItems([]);
    setCharges([]);
    setDocs([]);
    setPays([]);

    const [{ data: its }, { data: ch }, { data: dc }, { data: py }] = await Promise.all([
      supabase
        .from("purchase_order_items")
        .select("id,product_id,qty,received_qty,unit_cost")
        .eq("po_id", po.id),
      supabase.from("purchase_order_charges").select("*").eq("po_id", po.id),
      supabase.from("po_documents").select("id,kind,title,file_path,created_at").eq("po_id", po.id),
      supabase.from("po_payment_lines").select("*").eq("po_id", po.id),
    ]);

    const lines = (its as Item[]) || [];
    setItems(lines);
    setCharges((ch as Charge[]) || []);
    setDocs((dc as Doc[]) || []);
    setPays((py as Pay[]) || []);

    const ids = Array.from(new Set(lines.map((l) => l.product_id)));
    if (ids.length) {
      const { data: ps } = await supabase
        .from("products").select("id,name,sku").in("id", ids);
      setProducts(
        Object.fromEntries(
          ((ps as { id: string; name: string; sku: string | null }[]) || []).map((p) => [
            p.id, { name: p.name, sku: p.sku },
          ])
        )
      );
    }
  }

  // The freight on this order, shared over the lines by value - the same
  // arithmetic the warehouse sees when it books the goods in, so the cost on
  // the shelf and the cost finance signs for are the same number.
  const landed = useMemo(() => {
    const t = open ? totals[open.id] : null;
    const subtotal = Number(t?.subtotal || 0);
    const chargesTotal = Number(t?.charges_total || 0);
    const by: Record<string, number> = {};
    if (subtotal > 0 && chargesTotal > 0) {
      for (const l of items) {
        const share = (chargesTotal * (l.qty * l.unit_cost)) / subtotal;
        by[l.id] = l.qty > 0 ? share / l.qty : 0;
      }
    }
    return by;
  }, [items, totals, open]);

  async function openDoc(path: string) {
    const { data } = await supabase.storage.from("po-docs").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.po_number.toLowerCase().includes(s) ||
        (suppliers[r.supplier_id] || "").toLowerCase().includes(s)
    );
  }, [rows, q, suppliers]);

  if (blocked) return null;

  const paidTotal = pays.reduce((n, p) => n + Number(p.amount || 0), 0);
  const openTotals = open ? totals[open.id] : null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Purchase orders</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-4">
        Merchandising&rsquo;s orders, in full and read-only. Something wrong on one?
        Send the bill back with a note rather than changing the order here.
      </p>

      <input
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 mb-3"
        placeholder="Search PO number or supplier"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">PO</th>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Goods</th>
              <th className="text-right px-3 py-2">Freight</th>
              <th className="text-right px-3 py-2">Grand total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-8">...</td></tr>
            )}
            {!loading && shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{r.po_number}</td>
                <td className="px-3 py-2">{suppliers[r.supplier_id] || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.order_date}</td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{fmtMMK(totals[r.id]?.subtotal || 0)}</td>
                <td className="px-3 py-2 text-right text-slate-500">
                  {totals[r.id]?.charges_total ? fmtMMK(totals[r.id].charges_total) : "-"}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {fmtMMK(totals[r.id]?.grand_total || 0)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => openPo(r)}
                    className="text-blue-600 text-xs font-medium"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-8">Nothing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-3xl shadow-lg my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-lg mb-1">{open.po_number}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {suppliers[open.supplier_id] || "-"} &middot; {open.order_date}
              {open.expected_date ? ` · expected ${open.expected_date}` : ""}
              {open.payment_term ? ` · ${open.payment_term}` : ""}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-sm">
              <div className="border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-xs text-slate-500">Goods</div>
                <div className="font-semibold">{fmtMMK(openTotals?.subtotal || 0)}</div>
              </div>
              <div className="border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-xs text-slate-500">Freight &amp; charges</div>
                <div className="font-semibold">{fmtMMK(openTotals?.charges_total || 0)}</div>
              </div>
              <div className="border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-xs text-slate-500">Grand total</div>
                <div className="font-semibold">{fmtMMK(openTotals?.grand_total || 0)}</div>
              </div>
              <div className="border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-xs text-slate-500">Paid</div>
                <div className="font-semibold text-green-700">{fmtMMK(paidTotal)}</div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">Product</th>
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Received</th>
                    <th className="text-right px-3 py-2">Unit cost</th>
                    <th className="text-right px-3 py-2">Landed</th>
                    <th className="text-right px-3 py-2">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        {products[l.product_id]?.name || l.product_id}
                        {products[l.product_id]?.sku && (
                          <span className="text-xs text-slate-400"> · {products[l.product_id]?.sku}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">{l.qty}</td>
                      <td
                        className={`px-3 py-1.5 text-right ${
                          l.received_qty < l.qty ? "text-orange-600" : "text-green-700"
                        }`}
                      >
                        {l.received_qty}
                      </td>
                      <td className="px-3 py-1.5 text-right">{fmtMMK(l.unit_cost)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        {landed[l.id] ? fmtMMK(l.unit_cost + landed[l.id]) : "-"}
                      </td>
                      <td className="px-3 py-1.5 text-right">{fmtMMK(l.qty * l.unit_cost)}</td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-slate-400 py-6">No lines</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {charges.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-slate-500 mb-1.5">Freight &amp; other charges</div>
                {charges.map((c) => (
                  <div key={c.id} className="flex justify-between text-sm border-b border-slate-100 py-1">
                    <span>
                      {c.kind}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                    <span>{fmtMMK(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {pays.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-slate-500 mb-1.5">Payments</div>
                {pays.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm border-b border-slate-100 py-1">
                    <span className="text-slate-500">
                      {p.paid_at?.slice(0, 10)} {p.method ? `· ${p.method}` : ""}
                    </span>
                    <span>{fmtMMK(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {docs.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-slate-500 mb-1.5">Supplier paperwork</div>
                <div className="flex flex-wrap gap-2">
                  {docs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => openDoc(d.file_path)}
                      className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white hover:border-blue-300"
                    >
                      📎 {d.title || d.kind}
                      <span className="text-slate-400"> · {d.kind}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {open.note && (
              <p className="text-sm text-slate-600 mb-4">
                <span className="text-slate-400">Note: </span>{open.note}
              </p>
            )}

            <button
              onClick={() => setOpen(null)}
              className="w-full py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

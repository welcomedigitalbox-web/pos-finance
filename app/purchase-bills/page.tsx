"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK, errorText } from "@/lib/finance";

// Bills merchandising has entered against supplier orders. Approving one is
// what makes the money owed: it raises the voucher and its journal in the same
// step, so the payable and the ledger can never drift apart. Paying it then
// happens on the Payables screen like any other bill.
type Bill = {
  id: string;
  internal_no: string;
  invoice_no: string;
  po_id: string | null;
  supplier_id: string;
  store_id: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
  note: string | null;
  status: string;
  voucher_id: string | null;
  created_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

type Item = {
  id: string;
  description: string;
  qty: number;
  unit_cost: number;
  line_total: number;
  po_item_id: string | null;
};

type Billing = {
  po_id: string;
  po_number: string;
  ordered_value: number;
  received_value: number;
  billed_value: number;
};

export default function FinancePurchaseBillsPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"submitted" | "approved" | "rejected">("submitted");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [open, setOpen] = useState<Bill | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  // The supplier's own paperwork, attached to the order by merchandising.
  // Finance is the one paying, so finance is the one who has to be able to
  // read it before approving.
  const [docs, setDocs] = useState<
    { id: string; kind: string; title: string | null; file_path: string; created_at: string }[]
  >([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-payables")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    supabase
      .from("suppliers")
      .select("id,name")
      .then(({ data }) =>
        setSuppliers(
          Object.fromEntries(
            ((data as { id: string; name: string }[]) || []).map((s) => [s.id, s.name])
          )
        )
      );
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!profile || !hasPermission(profile, "fin-payables")) return null;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_invoices")
      .select("*")
      .eq("status", tab)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) showToast("❌ " + error.message);
    setRows((data as Bill[]) || []);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 4500);
  }

  function storeName(id: string) {
    return stores.find((s) => s.id === id)?.name || id;
  }

  async function openBill(b: Bill) {
    setOpen(b);
    setNote("");
    setItems([]);
    setBilling(null);
    setDocs([]);
    const [{ data: its }, { data: bill }] = await Promise.all([
      supabase
        .from("purchase_invoice_items")
        .select("id,description,qty,unit_cost,line_total,po_item_id")
        .eq("invoice_id", b.id)
        .order("line_no"),
      b.po_id
        ? supabase.from("po_billing_status").select("*").eq("po_id", b.po_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setItems((its as Item[]) || []);
    setBilling((bill as Billing) || null);

    if (b.po_id) {
      const { data: dc } = await supabase
        .from("po_documents")
        .select("id,kind,title,file_path,created_at")
        .eq("po_id", b.po_id)
        .order("created_at", { ascending: false });
      setDocs((dc as typeof docs) || []);
    }
  }

  // The files live in a private bucket, so they are opened through a link
  // that expires rather than a public address anyone could pass around.
  async function openDoc(path: string) {
    const { data, error } = await supabase.storage
      .from("po-docs")
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return showToast("\u274c " + (error?.message || "Cannot open"));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function approve() {
    if (!open) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("approve_purchase_invoice", {
        p_id: open.id,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      showToast(
        `${open.internal_no} approved — ${fmtMMK(
          Number(open.total)
        )} is now payable. Pay it from Payables.`
      );
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
      const { error } = await supabase.rpc("reject_purchase_invoice", {
        p_id: open.id,
        p_note: note.trim(),
      });
      if (error) throw error;
      showToast(`${open.internal_no} turned down`);
      setOpen(null);
      await load();
    } catch (err) {
      showToast("❌ " + errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const waiting = rows.reduce((s, r) => s + Number(r.total || 0), 0);

  // What this bill would take the order's billing past, if anything.
  const overBilled =
    open && billing
      ? Number(billing.billed_value) + Number(open.total) - Number(billing.ordered_value)
      : 0;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-1">Supplier bills</h2>
      <p className="text-sm text-slate-500 mb-4">
        Bills merchandising has entered. Approving one raises the payable and
        posts it to the ledger; paying it happens on Payables.
      </p>

      <div className="flex items-center gap-2 mb-4">
        {(["submitted", "approved", "rejected"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === k ? "bg-slate-900 text-white" : "border border-slate-200"
            }`}
          >
            {k === "submitted" ? "To decide" : k === "approved" ? "Approved" : "Turned down"}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-500">
          {rows.length} &middot; <span className="font-semibold">{fmtMMK(waiting)}</span>
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Ref</th>
              <th className="text-left px-3 py-2">Bill no</th>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Into</th>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Due</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Entered by</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="text-center text-slate-400 py-8">
                  ...
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{b.internal_no}</td>
                  <td className="px-3 py-2 font-medium">{b.invoice_no}</td>
                  <td className="px-3 py-2">{suppliers[b.supplier_id] || "-"}</td>
                  <td className="px-3 py-2 text-xs">{storeName(b.store_id)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{b.invoice_date}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{b.due_date || "-"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtMMK(b.total)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{b.created_by}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openBill(b)}
                      className="text-blue-600 text-xs font-semibold"
                    >
                      {b.status === "submitted" ? "Review" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-slate-400 py-8">
                  -
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-lg my-8">
            <h3 className="font-semibold text-lg mb-1">
              {open.invoice_no}{" "}
              <span className="font-mono text-xs text-slate-400">{open.internal_no}</span>
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {suppliers[open.supplier_id] || "-"} &middot; {storeName(open.store_id)} &middot;{" "}
              {open.invoice_date}
              {open.due_date ? ` → due ${open.due_date}` : ""}
            </p>

            {billing && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-xs grid grid-cols-3 gap-2">
                <div>
                  <div className="text-slate-500">Ordered ({billing.po_number})</div>
                  <div className="font-semibold">{fmtMMK(billing.ordered_value)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Received so far</div>
                  <div className="font-semibold">{fmtMMK(billing.received_value)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Already billed</div>
                  <div className="font-semibold">{fmtMMK(billing.billed_value)}</div>
                </div>
              </div>
            )}

            {docs.length > 0 && (
              <div className="border border-slate-200 rounded-lg px-3 py-2 mb-4">
                <div className="text-xs text-slate-500 mb-1.5">
                  Supplier paperwork on the order
                </div>
                <div className="flex flex-wrap gap-2">
                  {docs.map((d) => (
                    <button
                      key={d.id}
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

            {open.po_id && docs.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 mb-4 text-xs">
                No invoice or delivery note is attached to this order. Ask
                merchandising to attach the supplier&rsquo;s paperwork before you pay.
              </div>
            )}

            {overBilled > 0 && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 mb-4 text-xs">
                This bill would take the order {fmtMMK(overBilled)} past what was
                ordered. Check it against the order before approving.
              </div>
            )}

            <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Unit cost</th>
                    <th className="text-right px-3 py-2">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {i.description}
                        {!i.po_item_id && (
                          <span className="ml-1 text-[10px] text-amber-700">not on the order</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{i.qty}</td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {fmtMMK(i.unit_cost)}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtMMK(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-xs">
                  <tr>
                    <td className="px-3 py-1.5 text-slate-500" colSpan={3}>
                      Subtotal
                    </td>
                    <td className="px-3 py-1.5 text-right">{fmtMMK(open.subtotal)}</td>
                  </tr>
                  {Number(open.tax_amount) > 0 && (
                    <tr>
                      <td className="px-3 py-1.5 text-slate-500" colSpan={3}>
                        Tax {open.tax_percent}%
                      </td>
                      <td className="px-3 py-1.5 text-right">{fmtMMK(open.tax_amount)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-bold">{fmtMMK(open.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {open.status === "submitted" ? (
              <>
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 mb-3 text-xs">
                  Approving raises the payable and posts it to the ledger. Stock
                  is not touched &mdash; that happened when the goods were received.
                </div>
                <label className="text-sm text-slate-600">Note</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-4"
                  placeholder="Checked against the order and the delivery note"
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
                    onClick={approve}
                    disabled={busy}
                    className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
                  >
                    {busy ? "..." : "Approve"}
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

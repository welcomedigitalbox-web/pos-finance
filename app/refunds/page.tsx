"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  fmtMMK, today, loadAccounts, accountLabel, errorText, type FinAccount,
} from "@/lib/finance";

// Shops do not hand cash back. They take the customer's details, and the money
// leaves from here — with the slip attached, so the shop can show the customer.
type RefundRow = {
  id: string;
  return_number: string | null;
  sale_ref: string | null;
  store_id: string | null;
  customer_name: string | null;
  refund_amount: number;
  reason: string | null;
  created_at: string;
  requested_by: string | null;
  payee_name: string | null;
  payee_phone: string | null;
  payee_method: string | null;
  payee_account: string | null;
  payee_bank: string | null;
  refund_status: string | null;
  refund_slip_url: string | null;
  refunded_by: string | null;
  refunded_at: string | null;
};

export default function FinanceRefundsPage() {
  const { stores } = useStore();
  const { profile } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<RefundRow[]>([]);
  const [accounts, setAccounts] = useState<FinAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "paid">("pending");
  const [toast, setToast] = useState("");

  const [payRow, setPayRow] = useState<RefundRow | null>(null);
  const [accountId, setAccountId] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [reference, setReference] = useState("");
  const [slip, setSlip] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [slipLink, setSlipLink] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-refunds")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    loadAccounts().then((a) => setAccounts(a.filter((x) => x.is_cash || x.is_bank)));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!profile || !hasPermission(profile, "fin-refunds")) return null;

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("sale_returns")
      .select("*")
      .eq("refund_status", tab === "pending" ? "pending_finance" : "paid")
      .order("created_at", { ascending: false })
      .limit(300);
    setRows((data as RefundRow[]) || []);
    setLoading(false);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function storeName(id: string | null) {
    return stores.find((s) => s.id === id)?.name || id || "-";
  }

  function openPay(r: RefundRow) {
    setPayRow(r);
    setAccountId("");
    setPayDate(today());
    setReference("");
    setSlip(null);
  }

  async function submitPay() {
    if (!payRow) return;
    if (!accountId) return showToast("Pick the account the money leaves from");
    if (!slip) return showToast("Attach the transfer slip");
    setSaving(true);
    try {
      const path = `refunds/${payRow.store_id || "none"}/${payRow.id}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("transfer-photos")
        .upload(path, slip, { contentType: slip.type || "image/jpeg", upsert: true });
      if (upErr) throw upErr;

      const { error } = await supabase.rpc("pay_refund", {
        p_return_id: payRow.id,
        p_account_id: accountId,
        p_date: payDate,
        p_reference: reference.trim() || null,
        p_slip_url: path,
      });
      if (error) throw error;

      showToast(`${payRow.return_number || ""} paid`);
      setPayRow(null);
      await load();
    } catch (err) {
      showToast("❌ " + errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function openSlip(path: string) {
    const { data } = await supabase.storage
      .from("transfer-photos")
      .createSignedUrl(path, 3600);
    if (data?.signedUrl) setSlipLink(data.signedUrl);
  }

  const total = rows.reduce((s, r) => s + Number(r.refund_amount || 0), 0);

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-1">Refunds</h2>
      <p className="text-sm text-slate-500 mb-4">
        Money owed back to customers on returns the shops have taken in.
      </p>

      <div className="flex items-center gap-2 mb-4">
        {(["pending", "paid"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === k ? "bg-slate-900 text-white" : "border border-slate-200"}`}>
            {k === "pending" ? "To pay" : "Paid"}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-500">
          {rows.length} · <span className="font-semibold">{fmtMMK(total)}</span>
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Return</th>
              <th className="text-left px-3 py-2">Invoice</th>
              <th className="text-left px-3 py-2">Shop</th>
              <th className="text-left px-3 py-2">Customer</th>
              <th className="text-left px-3 py-2">Send to</th>
              <th className="text-right px-3 py-2">Amount</th>
              <th className="text-left px-3 py-2">Asked by</th>
              <th className="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-8">...</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{r.return_number || "-"}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.sale_ref || "-"}</td>
                <td className="px-3 py-2">{storeName(r.store_id)}</td>
                <td className="px-3 py-2">
                  {r.customer_name || "-"}
                  {r.reason && <div className="text-[10px] text-slate-400">{r.reason}</div>}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.payee_name || "-"}</div>
                  <div className="text-[11px] text-slate-500">
                    {[r.payee_method, r.payee_bank, r.payee_account].filter(Boolean).join(" · ")}
                  </div>
                  {r.payee_phone && (
                    <div className="text-[11px] text-slate-400">{r.payee_phone}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold">{fmtMMK(r.refund_amount)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {r.requested_by || "-"}
                  <div className="text-[10px] text-slate-400">
                    {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {r.refund_status === "paid" ? (
                    <>
                      <div className="text-[11px] text-slate-500">
                        {r.refunded_by}
                        {r.refunded_at ? ` · ${new Date(r.refunded_at).toLocaleDateString()}` : ""}
                      </div>
                      {r.refund_slip_url && (
                        <button onClick={() => openSlip(r.refund_slip_url as string)}
                          className="text-blue-600 text-xs font-medium">
                          📎 Slip
                        </button>
                      )}
                    </>
                  ) : (
                    <button onClick={() => openPay(r)}
                      className="text-green-700 text-xs font-semibold">
                      Pay refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-8">-</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {payRow && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-1">Pay refund</h3>
            <p className="text-sm text-slate-500 mb-4">
              {payRow.return_number} · {payRow.customer_name || "-"}
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-sm">
              <div className="font-medium">{payRow.payee_name}</div>
              <div className="text-slate-600">
                {[payRow.payee_method, payRow.payee_bank, payRow.payee_account]
                  .filter(Boolean).join(" · ")}
              </div>
              {payRow.payee_phone && <div className="text-slate-500">{payRow.payee_phone}</div>}
              <div className="mt-1 text-lg font-bold">{fmtMMK(payRow.refund_amount)}</div>
            </div>

            <label className="text-sm text-slate-600">Paid from</label>
            <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">-</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a)}</option>
              ))}
            </select>

            <label className="text-sm text-slate-600">Date</label>
            <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              value={payDate} onChange={(e) => setPayDate(e.target.value)} />

            <label className="text-sm text-slate-600">Reference</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1 mb-3"
              placeholder="Transaction id"
              value={reference} onChange={(e) => setReference(e.target.value)} />

            <label className="text-sm text-slate-600">
              Transfer slip <span className="text-red-600">*</span>
            </label>
            <input type="file" accept="image/*"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs mt-1 mb-4"
              onChange={(e) => setSlip(e.target.files?.[0] || null)} />

            <div className="flex gap-2">
              <button onClick={() => setPayRow(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium">
                {t("fin_cancel")}
              </button>
              <button onClick={submitPay} disabled={saving}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
                {saving ? "..." : "Mark paid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {slipLink && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setSlipLink(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slipLink} alt="" className="max-h-[80vh] max-w-full rounded-lg" />
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

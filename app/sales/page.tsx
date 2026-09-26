"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import type { TranslationKey } from "@/app/i18n";
import { fmtMMK, fmtNum, today, STATUS_COLORS, errorText } from "@/lib/finance";

// The finance team's one list of every sale: the tills and the online orders
// arrive through the same read-only view, so a row is identified by the pair
// (source, source_id) rather than by an id of its own.
type SaleSource = "pos" | "online";
type SaleType = "walk_in" | "wholesale" | "online_retail" | "online_wholesale";
type PayStatus = "paid" | "partial" | "unpaid";

type SaleRow = {
  source: SaleSource;
  source_id: string;
  reference: string;
  sale_date: string;
  sale_at: string;
  store_id: string | null;
  sale_type: SaleType;
  customer_name: string | null;
  customer_id: string | null;
  payment_method: string | null;
  payment_status: PayStatus;
  delivery_status: string | null;
  source_status: string | null;
  total: number;
  paid_amount: number;
  balance: number;
  sale_rep_name: string | null;
  cashier: string | null;
  voucher_no: string | null;
  voucher_id: string | null;
};

type ReceiptLine = {
  description: string | null;
  qty: number | null;
  unit_price: number | null;
  line_total: number | null;
};

type ReceiptPayment = {
  amount: number | null;
  channel: string | null;
  paid_at: string | null;
  ref: string | null;
};

// The detail block's keys differ by source, so it is read key by key rather
// than typed as one shape that neither side actually has.
type Detail = Record<string, unknown> | null;

type SaleItemRow = {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
};

type GoodsBack = "good" | "damaged" | "not_returned";

type CorrectLine = {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sold_qty: number;
  unit_price: number;
  qty: string;
  goods_back: GoodsBack;
};

type Receipt = SaleRow & { lines: ReceiptLine[] | null; detail: Detail };

const SALE_TYPES: SaleType[] = ["walk_in", "wholesale", "online_retail", "online_wholesale"];
const PAY_STATUSES: PayStatus[] = ["paid", "partial", "unpaid"];
const SOURCES: SaleSource[] = ["pos", "online"];

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function detailStr(d: Detail, key: string): string | null {
  if (!d) return null;
  const v = d[key];
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function detailNum(d: Detail, key: string): number | null {
  if (!d) return null;
  const v = d[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function detailSlips(d: Detail): string[] {
  if (!d) return [];
  const v = d["slips"];
  return Array.isArray(v) ? (v as string[]) : [];
}

function detailPayments(d: Detail): ReceiptPayment[] {
  if (!d) return [];
  const v = d["payments"];
  return Array.isArray(v) ? (v as ReceiptPayment[]) : [];
}

export default function FinanceSalesPage() {
  const { stores } = useStore();

  // Nothing is sold out of a warehouse, so it has no place in this filter -
  // it only makes the list of branches longer to read.
  const sellingStores = stores.filter((s) => !s.is_warehouse);
  const { profile } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [storeFilter, setStoreFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [search, setSearch] = useState("");

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [slipPhoto, setSlipPhoto] = useState<string | null>(null);
  const [repFilter, setRepFilter] = useState("");

  // Correcting an invoice is not editing it. The original stands; a correction
  // is raised against it, and one server call moves the stock, files any
  // write-off and raises the credit note together.
  const [correctRow, setCorrectRow] = useState<SaleRow | null>(null);
  const [correctLines, setCorrectLines] = useState<CorrectLine[]>([]);
  const [correctReason, setCorrectReason] = useState("");
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-sales")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, storeFilter, typeFilter, statusFilter, sourceFilter]);

  async function load() {
    setLoading(true);
    try {
      let q = supabase
        .from("fin_sales_transactions")
        .select("*")
        .gte("sale_date", from)
        .lte("sale_date", to)
        .order("sale_at", { ascending: false })
        .limit(500);
      if (storeFilter) q = q.eq("store_id", storeFilter);
      if (typeFilter) q = q.eq("sale_type", typeFilter);
      if (statusFilter) q = q.eq("payment_status", statusFilter);
      if (sourceFilter) q = q.eq("source", sourceFilter);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as SaleRow[]) || []);
    } catch (err) {
      showToast("❌ " + errorText(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  // Delivery status and payment method are free text on both sources, so the
  // options are whatever the loaded rows actually contain.
  const deliveryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.delivery_status) set.add(r.delivery_status);
    return Array.from(set).sort();
  }, [rows]);

  const repOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.sale_rep_name) set.add(r.sale_rep_name);
    return Array.from(set).sort();
  }, [rows]);

  const methodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.payment_method) set.add(r.payment_method);
    return Array.from(set).sort();
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (repFilter && r.sale_rep_name !== repFilter) return false;
      if (deliveryFilter && (r.delivery_status || "") !== deliveryFilter) return false;
      if (methodFilter && (r.payment_method || "") !== methodFilter) return false;
      if (
        q &&
        !(r.reference || "").toLowerCase().includes(q) &&
        !(r.customer_name || "").toLowerCase().includes(q) &&
        !(r.voucher_no || "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, deliveryFilter, methodFilter, search]);

  const totals = useMemo(() => {
    let total = 0;
    let paid = 0;
    let balance = 0;
    for (const r of visible) {
      total += Number(r.total || 0);
      paid += Number(r.paid_amount || 0);
      balance += Number(r.balance || 0);
    }
    return { count: visible.length, total, paid, balance };
  }, [visible]);

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");

  async function openReceipt(r: SaleRow) {
    setReceiptLoading(true);
    try {
      const { data, error } = await supabase.rpc("fin_sale_receipt", {
        p_source: r.source,
        p_id: r.source_id,
      });
      if (error) throw error;
      if (!data) throw new Error(t("fin_empty"));
      setReceipt(data as Receipt);
    } catch (err) {
      showToast("❌ " + errorText(err));
    } finally {
      setReceiptLoading(false);
    }
  }

  async function openCorrection(r: SaleRow) {
    if (r.source !== "pos") return showToast(t("fin_correctPosOnly"));
    setCorrectReason("");
    setCorrecting(true);
    try {
      const { data, error } = await supabase
        .from("sale_items")
        .select("product_id, variant_id, product_name, qty, unit_price")
        .eq("sale_id", r.source_id);
      if (error) throw error;
      setCorrectLines(((data as SaleItemRow[]) || []).map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id,
        product_name: i.product_name,
        sold_qty: Number(i.qty),
        unit_price: Number(i.unit_price),
        qty: "",
        goods_back: "not_returned" as GoodsBack,
      })));
      setCorrectRow(r);
    } catch (err) {
      showToast("\u274c " + errorText(err));
    } finally {
      setCorrecting(false);
    }
  }

  async function submitCorrection() {
    if (!correctRow) return;
    const lines = correctLines
      .filter((l) => Number(l.qty) > 0)
      .map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        qty: Number(l.qty),
        goods_back: l.goods_back,
      }));
    if (!lines.length) return showToast(t("fin_correctNeedQty"));
    if (!correctReason.trim()) return showToast(t("fin_correctNeedReason"));

    setCorrecting(true);
    try {
      const { error } = await supabase.rpc("apply_sale_correction", {
        p_sale_id: correctRow.source_id,
        p_lines: lines,
        p_reason: correctReason.trim(),
        p_refund_method: "cash",
        p_refund_payment: correctRow.payment_method,
      });
      if (error) throw error;
      showToast(t("fin_correctDone"));
      setCorrectRow(null);
      await load();
    } catch (err) {
      showToast("\u274c " + errorText(err));
    } finally {
      setCorrecting(false);
    }
  }

  if (!profile || !hasPermission(profile, "fin-sales")) return null;

  const rDetail = receipt?.detail ?? null;
  const rLines = receipt?.lines || [];
  const rPayments = detailPayments(rDetail);
  const rSubtotal = detailNum(rDetail, "subtotal");
  const rDiscount = detailNum(rDetail, "discount_amount") ?? detailNum(rDetail, "discount");
  const rDeliveryFee = detailNum(rDetail, "delivery_fee");
  const rTax = detailNum(rDetail, "vat_amount");
  const rPhone = detailStr(rDetail, "phone");
  const rAddress = detailStr(rDetail, "delivery_address");
  const rCity = detailStr(rDetail, "city");
  const rChannel =
    detailStr(rDetail, "order_channel_name") ?? detailStr(rDetail, "delivery_method");
  const rNote = detailStr(rDetail, "note");
  const rMethod = detailStr(rDetail, "payment_method") ?? receipt?.payment_method ?? null;

  return (
    <div className="pt-4">
      <h2 className="font-semibold text-lg mb-1">{t("fin_salesTitle")}</h2>
      <p className="text-sm text-slate-500 mb-4">{t("fin_salesHint")}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        <div>
          <label className="text-xs text-slate-500">{t("fin_from")}</label>
          <input
            type="date"
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_to")}</label>
          <input
            type="date"
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_store")}</label>
          <select
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {sellingStores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_saleType")}</label>
          <select
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {SALE_TYPES.map((s) => (
              <option key={s} value={s}>{t(`fin_type_${s}` as TranslationKey)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_paymentStatus")}</label>
          <select
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {PAY_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`fin_status_${s}` as TranslationKey)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_deliveryStatus")}</label>
          <select
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={deliveryFilter}
            onChange={(e) => setDeliveryFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {deliveryOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_method")}</label>
          <select
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {methodOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">{t("fin_source")}</label>
          <select
            className="block border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{t(`fin_source_${s}` as TranslationKey)}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-slate-500">{t("fin_search")}</label>
          <input
            className="block w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
            placeholder={t("fin_search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_txnCount")}</div>
          <div className="text-xl font-bold mt-1">{totals.count}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_totalSales")}</div>
          <div className="text-lg font-bold mt-1">{fmtMMK(totals.total)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_collected")}</div>
          <div className="text-lg font-bold mt-1 text-green-700">{fmtMMK(totals.paid)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-500 uppercase">{t("fin_outstanding")}</div>
          <div className="text-lg font-bold mt-1 text-orange-600">{fmtMMK(totals.balance)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1200px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">{t("fin_date")}</th>
              <th className="text-left px-3 py-2">{t("fin_reference")}</th>
              <th className="text-left px-3 py-2">{t("fin_source")}</th>
              <th className="text-left px-3 py-2">{t("fin_store")}</th>
              <th className="text-left px-3 py-2">{t("fin_saleType")}</th>
              <th className="text-left px-3 py-2">{t("fin_customer")}</th>
              <th className="text-left px-3 py-2" data-k="fin_salesRep_col">{t("fin_salesRep")}</th>
              <th className="text-left px-3 py-2">{t("fin_method")}</th>
              <th className="text-left px-3 py-2">{t("fin_status")}</th>
              <th className="text-left px-3 py-2">{t("fin_deliveryStatus")}</th>
              <th className="text-right px-3 py-2">{t("fin_total")}</th>
              <th className="text-right px-3 py-2">{t("fin_paid")}</th>
              <th className="text-right px-3 py-2">{t("fin_balance")}</th>
              <th className="text-right px-3 py-2">{t("fin_no")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={14} className="text-center text-slate-400 py-8">{t("fin_loading")}</td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr
                key={`${r.source}:${r.source_id}`}
                className={`border-t border-slate-100 ${Number(r.balance || 0) > 0 ? "bg-orange-50/40" : ""}`}
              >
                <td className="px-3 py-2">{r.sale_date}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{r.reference}</div>
                  {!r.voucher_no && (
                    <div className="text-[11px] text-slate-400">{t("fin_noVoucher")}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      r.source === "pos" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {t(`fin_source_${r.source}` as TranslationKey)}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">{storeName(r.store_id)}</td>
                <td className="px-3 py-2 text-slate-500">
                  {t(`fin_type_${r.sale_type}` as TranslationKey)}
                </td>
                <td className="px-3 py-2 font-medium">{r.customer_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.sale_rep_name || "-"}</td>
                <td className="px-3 py-2 text-slate-500">{r.payment_method || "-"}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[r.payment_status] || ""}`}>
                    {t(`fin_status_${r.payment_status}` as TranslationKey)}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">{r.delivery_status || "-"}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtNum(r.total)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{fmtNum(r.paid_amount)}</td>
                <td className={`px-3 py-2 text-right ${Number(r.balance || 0) > 0 ? "text-orange-600 font-semibold" : "text-slate-400"}`}>
                  {fmtNum(r.balance)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => openReceipt(r)}
                    disabled={receiptLoading}
                    className="text-blue-600 text-xs font-medium disabled:text-slate-300"
                  >
                    {t("fin_viewReceipt")}
                  </button>
                  {r.source === "pos" && (
                    <button
                      onClick={() => openCorrection(r)}
                      disabled={correcting}
                      className="text-orange-600 text-xs font-medium disabled:text-slate-300 ml-3"
                    >
                      {t("fin_correct")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={14} className="text-center text-slate-400 py-8">{t("fin_empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {correctRow && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg">{t("fin_correctTitle")}</h3>
            <p className="text-sm text-slate-500 mt-1">
              {correctRow.reference} · {storeName(correctRow.store_id)} · {fmtMMK(correctRow.total)}
            </p>
            <p className="text-sm text-slate-500 mt-2">{t("fin_correctIntro")}</p>

            <table className="w-full text-sm mt-4">
              <thead className="text-slate-500 text-left border-b border-slate-200">
                <tr>
                  <th className="py-2">{t("fin_description")}</th>
                  <th className="py-2 text-right">{t("fin_qty")}</th>
                  <th className="py-2 text-right">{t("fin_correctQty")}</th>
                  <th className="py-2">{t("fin_correctGoodsBack")}</th>
                </tr>
              </thead>
              <tbody>
                {correctLines.map((l, i) => (
                  <tr key={`${l.product_id}:${l.variant_id || "base"}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">{l.product_name}</td>
                    <td className="py-2 text-right text-slate-500">{fmtNum(l.sold_qty)}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number" min={0} max={l.sold_qty}
                        className="border border-slate-200 rounded-lg px-2 py-1 w-20 text-right"
                        value={l.qty}
                        onChange={(e) => {
                          const next = [...correctLines];
                          next[i] = { ...l, qty: e.target.value };
                          setCorrectLines(next);
                        }}
                      />
                    </td>
                    <td className="py-2">
                      <select
                        className="border border-slate-200 rounded-lg px-2 py-1 text-sm"
                        value={l.goods_back}
                        onChange={(e) => {
                          const next = [...correctLines];
                          next[i] = { ...l, goods_back: e.target.value as GoodsBack };
                          setCorrectLines(next);
                        }}
                      >
                        <option value="not_returned">{t("fin_goodsNone")}</option>
                        <option value="good">{t("fin_goodsGood")}</option>
                        <option value="damaged">{t("fin_goodsDamaged")}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className="text-sm text-slate-600 mt-4 block">{t("fin_correctReason")}</label>
            <textarea
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
              value={correctReason}
              onChange={(e) => setCorrectReason(e.target.value)}
            />

            <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-200">
              <div className="text-sm">
                <span className="text-slate-500">{t("fin_correctRefund")}: </span>
                <span className="font-semibold">
                  {fmtMMK(correctLines.reduce((sum, l) => sum + (Number(l.qty) || 0) * l.unit_price, 0))}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCorrectRow(null)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  {t("fin_cancel")}
                </button>
                <button
                  onClick={submitCorrection}
                  disabled={correcting}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium disabled:bg-slate-300"
                >
                  {t("fin_correctSubmit")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 print:static print:bg-transparent print:p-0 print:block">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl shadow-lg max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:p-0">
            <div className="flex items-start justify-between gap-3 mb-4 print:hidden">
              <div>
                <h3 className="font-semibold text-lg">{t("fin_receiptTitle")}</h3>
                <p className="text-sm text-slate-500">
                  {receipt.reference} · {t(`fin_source_${receipt.source}` as TranslationKey)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => window.print()}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium"
                >
                  {t("fin_print")}
                </button>
                <button
                  onClick={() => setReceipt(null)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium"
                >
                  {t("fin_cancel")}
                </button>
              </div>
            </div>

            {/* po-print is the app's printable-sheet hook; without it the global
                print stylesheet hides the whole page. */}
            <div className="po-print print:block">
              <div className="flex flex-wrap justify-between gap-4 mb-4">
                <div className="text-sm">
                  <div className="text-lg font-bold">{t("fin_receiptTitle")}</div>
                  <div className="font-mono text-sm">{receipt.reference}</div>
                  <div className="text-slate-500">
                    {t("fin_date")}: {receipt.sale_date}
                  </div>
                  <div className="text-slate-500">{storeName(receipt.store_id)}</div>
                  <div className="text-slate-500">
                    {t("fin_saleType")}: {t(`fin_type_${receipt.sale_type}` as TranslationKey)}
                  </div>
                  {rChannel && (
                    <div className="text-slate-500">
                      {t("fin_channelName")}: {rChannel}
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <div className="text-slate-500">{t("fin_customer")}</div>
                  <div className="font-medium">{receipt.customer_name || "-"}</div>
                  {rPhone && (
                    <div className="text-slate-500">
                      {t("fin_phone")}: {rPhone}
                    </div>
                  )}
                  {rAddress && (
                    <div className="text-slate-500 whitespace-pre-line">
                      {t("fin_address")}: {rAddress}
                      {rCity ? `, ${rCity}` : ""}
                    </div>
                  )}
                  {receipt.cashier && (
                    <div className="text-slate-500 mt-1">
                      {t("fin_cashierName")}: {receipt.cashier}
                    </div>
                  )}
                  {receipt.sale_rep_name && (
                    <div className="text-slate-500">
                      {t("fin_salesRep")}: {receipt.sale_rep_name}
                    </div>
                  )}
                  {rMethod && (
                    <div className="text-slate-500">
                      {t("fin_method")}: {rMethod}
                    </div>
                  )}
                </div>
              </div>

              {detailSlips(receipt.detail).length > 0 && (
                <div className="mb-4 print:hidden">
                  <div className="text-sm font-medium mb-2">Payment Slip</div>
                  <div className="flex flex-wrap gap-2">
                    {detailSlips(receipt.detail).map((u, i) => (
                      <img key={i} src={u} alt="" onClick={() => setSlipPhoto(u)}
                        className="h-24 w-24 object-cover rounded-lg border border-slate-200 cursor-zoom-in" />
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl print:border-0">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">{t("fin_description")}</th>
                      <th className="text-right px-3 py-2">{t("fin_qty")}</th>
                      <th className="text-right px-3 py-2">{t("fin_unitPrice")}</th>
                      <th className="text-right px-3 py-2">{t("fin_lineTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rLines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2">{l.description || "-"}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(l.qty)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(l.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtNum(l.line_total)}</td>
                      </tr>
                    ))}
                    {rLines.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center text-slate-400 py-6">{t("fin_empty")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end mt-3">
                <div className="w-full sm:w-72 text-sm">
                  {rSubtotal !== null && (
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">{t("fin_subtotal")}</span>
                      <span>{fmtMMK(rSubtotal)}</span>
                    </div>
                  )}
                  {rDiscount !== null && (
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">{t("fin_tradeDiscount")}</span>
                      <span>{fmtMMK(rDiscount)}</span>
                    </div>
                  )}
                  {rDeliveryFee !== null && (
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">{t("fin_deliveryFee")}</span>
                      <span>{fmtMMK(rDeliveryFee)}</span>
                    </div>
                  )}
                  {rTax !== null && (
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">{t("fin_tax")}</span>
                      <span>{fmtMMK(rTax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-t border-slate-200 font-semibold">
                    <span>{t("fin_total")}</span>
                    <span>{fmtMMK(receipt.total)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">{t("fin_paid")}</span>
                    <span>{fmtMMK(receipt.paid_amount)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">{t("fin_balance")}</span>
                    <span className={Number(receipt.balance || 0) > 0 ? "text-orange-600 font-semibold" : ""}>
                      {fmtMMK(receipt.balance)}
                    </span>
                  </div>
                </div>
              </div>

              {rPayments.length > 0 && (
                <div className="overflow-x-auto border border-slate-200 rounded-xl mt-4 print:border-0">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-2">{t("fin_date")}</th>
                        <th className="text-left px-3 py-2">{t("fin_method")}</th>
                        <th className="text-left px-3 py-2">{t("fin_reference")}</th>
                        <th className="text-right px-3 py-2">{t("fin_amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rPayments.map((p, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-2">{(p.paid_at || "").slice(0, 10) || "-"}</td>
                          <td className="px-3 py-2 text-slate-500">{p.channel || "-"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{p.ref || "-"}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtNum(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {rNote && (
                <p className="text-sm text-slate-500 mt-3">
                  {t("fin_note")}: {rNote}
                </p>
              )}

              <p className="text-sm text-slate-500 mt-3">
                {t("fin_no")}:{" "}
                {receipt.voucher_no ? (
                  <span className="font-mono text-xs text-slate-700">{receipt.voucher_no}</span>
                ) : (
                  t("fin_noVoucher")
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50 print:hidden">
          {toast}
        </div>
      )}

      {slipPhoto && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 print:hidden"
          onClick={() => setSlipPhoto(null)}>
          <img src={slipPhoto} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

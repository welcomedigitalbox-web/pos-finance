"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/app/store-context";
import { useAuth } from "@/app/auth-context";
import { useLanguage } from "@/app/language-context";
import { hasPermission } from "@/app/permissions";
import {
  DOC_FLOW,
  DOC_TYPES,
  STATUS_COLORS,
  fmtMMK,
  fmtNum,
  loadParties,
  today,
  type DocType,
  type FinDocument,
  type PartyOption,
} from "@/lib/finance";
import type { TranslationKey } from "@/app/i18n";

type DocItem = {
  id?: string;
  doc_id?: string;
  line_no: number;
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
};

type FormLine = {
  product_id: string;
  description: string;
  qty: string;
  unit_price: string;
  discount_pct: string;
};

type ProductOption = { id: string; name: string; sku: string | null };

const DOC_STATUSES = ["draft", "issued", "checked", "cancelled"] as const;

// Documents raised against a supplier rather than a customer.
const SUPPLIER_DOCS: DocType[] = ["purchase_order", "debit_note"];

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function emptyLine(): FormLine {
  return { product_id: "", description: "", qty: "1", unit_price: "0", discount_pct: "0" };
}

function lineValue(l: { qty: number; unit_price: number; discount_pct: number }) {
  return (
    Math.round(l.qty * l.unit_price * (1 - (l.discount_pct || 0) / 100) * 100) / 100
  );
}

export default function DocumentsPage() {
  const { profile } = useAuth();
  const { storeId, stores } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [docs, setDocs] = useState<FinDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [voucherNos, setVoucherNos] = useState<Record<string, string>>({});
  const [refNos, setRefNos] = useState<Record<string, string>>({});

  const [showNew, setShowNew] = useState(false);
  const [docType, setDocType] = useState<DocType>("invoice");
  const [docDate, setDocDate] = useState(today());
  const [docStore, setDocStore] = useState("");
  const docStoreValue = docStore || storeId;
  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [formLines, setFormLines] = useState<FormLine[]>([emptyLine()]);

  const [detail, setDetail] = useState<FinDocument | null>(null);
  const [detailItems, setDetailItems] = useState<DocItem[]>([]);
  const [convertRow, setConvertRow] = useState<FinDocument | null>(null);
  const [convertTo, setConvertTo] = useState<DocType | "">("");

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-documents")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    supabase
      .from("products")
      .select("id,name,sku")
      .eq("is_active", true)
      .order("name")
      .limit(1000)
      .then(({ data }) => setProducts((data as ProductOption[]) || []));
  }, []);

  useEffect(() => {
    loadParties(partyType).then(setParties);
  }, [partyType]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter, from, to, search]);

  if (!profile || !hasPermission(profile, "fin-documents")) return null;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function load() {
    setLoading(true);
    let q = supabase
      .from("fin_documents")
      .select("*")
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (typeFilter) q = q.eq("doc_type", typeFilter);
    if (statusFilter) q = q.eq("status", statusFilter);
    if (from) q = q.gte("doc_date", from);
    if (to) q = q.lte("doc_date", to);
    if (search.trim()) q = q.ilike("party_name", `%${search.trim()}%`);

    const { data, error } = await q;
    if (error) showToast("❌ " + error.message);
    const list = (data as FinDocument[]) || [];
    setDocs(list);

    const voucherIds = Array.from(
      new Set(list.map((d) => d.voucher_id).filter((v): v is string => !!v))
    );
    if (voucherIds.length > 0) {
      const { data: vs } = await supabase
        .from("fin_vouchers")
        .select("id,voucher_no")
        .in("id", voucherIds);
      const map: Record<string, string> = {};
      for (const v of (vs as { id: string; voucher_no: string }[]) || []) map[v.id] = v.voucher_no;
      setVoucherNos(map);
    } else {
      setVoucherNos({});
    }

    const refIds = Array.from(
      new Set(list.map((d) => d.ref_doc_id).filter((v): v is string => !!v))
    );
    if (refIds.length > 0) {
      const { data: rs } = await supabase.from("fin_documents").select("id,doc_no").in("id", refIds);
      const map: Record<string, string> = {};
      for (const r of (rs as { id: string; doc_no: string }[]) || []) map[r.id] = r.doc_no;
      setRefNos(map);
    } else {
      setRefNos({});
    }
    setLoading(false);
  }

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || id : "-");
  const docTypeLabel = (d: DocType) => t(`fin_docType_${d}` as TranslationKey);
  const statusLabel = (s: string) => t(`fin_docStatus_${s}` as TranslationKey);

  const grossTotal = formLines.reduce(
    (s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0),
    0
  );
  const netTotal = formLines.reduce(
    (s, l) =>
      s +
      lineValue({
        qty: Number(l.qty || 0),
        unit_price: Number(l.unit_price || 0),
        discount_pct: Number(l.discount_pct || 0),
      }),
    0
  );
  const discountTotal = Math.round((grossTotal - netTotal) * 100) / 100;
  const grandTotal = netTotal + Number(taxAmount || 0);

  function setLine(i: number, patch: Partial<FormLine>) {
    setFormLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function openNew() {
    setDocType("invoice");
    setDocDate(today());
    setDocStore(storeId || "");
    setPartyType("customer");
    setPartyId("");
    setPartyName("");
    setPartyAddress("");
    setValidUntil("");
    setTerms("");
    setNote("");
    setTaxAmount("0");
    setFormLines([emptyLine()]);
    setShowNew(true);
  }

  function changeDocType(next: DocType) {
    setDocType(next);
    const nextParty = SUPPLIER_DOCS.includes(next) ? "supplier" : "customer";
    if (nextParty !== partyType) {
      setPartyType(nextParty);
      setPartyId("");
      setPartyName("");
    }
  }

  async function saveDocument() {
    if (!partyName.trim()) {
      showToast(t("fin_required"));
      return;
    }
    const lines = formLines.filter((l) => l.description.trim() || l.product_id);
    if (lines.length === 0) {
      showToast(t("fin_required"));
      return;
    }
    setBusy(true);
    try {
      const { data: noData, error: noErr } = await supabase.rpc("next_fin_no", {
        p_kind: docType,
        p_store_id: docStoreValue || null,
      });
      if (noErr) throw noErr;

      const { data: created, error: docErr } = await supabase
        .from("fin_documents")
        .insert({
          doc_type: docType,
          doc_no: noData as string,
          doc_date: docDate,
          store_id: docStoreValue || null,
          party_type: partyType,
          party_id: partyId || null,
          party_name: partyName,
          party_address: partyAddress || null,
          status: "draft",
          subtotal: grossTotal,
          discount: discountTotal,
          tax_amount: Number(taxAmount || 0),
          total: grandTotal,
          valid_until: docType === "quotation" && validUntil ? validUntil : null,
          terms: terms || null,
          note: note || null,
          created_by: profile?.email || null,
        })
        .select()
        .single();
      if (docErr) throw docErr;

      const doc = created as FinDocument;
      const items = lines.map((l, i) => ({
        doc_id: doc.id,
        line_no: i + 1,
        product_id: l.product_id || null,
        description: l.description,
        qty: Number(l.qty || 0),
        unit_price: Number(l.unit_price || 0),
        discount_pct: Number(l.discount_pct || 0),
        line_total: lineValue({
          qty: Number(l.qty || 0),
          unit_price: Number(l.unit_price || 0),
          discount_pct: Number(l.discount_pct || 0),
        }),
      }));
      const { error: itemErr } = await supabase.from("fin_document_items").insert(items);
      if (itemErr) {
        // Never leave a header without its lines.
        await supabase.from("fin_documents").delete().eq("id", doc.id);
        throw itemErr;
      }

      showToast(t("fin_saved"));
      setShowNew(false);
      await load();
    } catch (err) {
      showToast("❌ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(d: FinDocument) {
    setDetail(d);
    setDetailItems([]);
    const { data } = await supabase
      .from("fin_document_items")
      .select("*")
      .eq("doc_id", d.id)
      .order("line_no");
    setDetailItems((data as DocItem[]) || []);
  }

  async function setStatus(d: FinDocument, status: FinDocument["status"]) {
    setBusy(true);
    const patch: Record<string, unknown> = { status };
    if (status === "checked") {
      patch.checked_by = profile?.email || null;
      patch.checked_at = new Date().toISOString();
    }
    const { error } = await supabase.from("fin_documents").update(patch).eq("id", d.id);
    setBusy(false);
    if (error) {
      showToast("❌ " + error.message);
      return;
    }
    showToast(t("fin_saved"));
    if (detail?.id === d.id) setDetail({ ...d, ...(patch as Partial<FinDocument>) });
    await load();
  }

  async function convert() {
    if (!convertRow || !convertTo) return;
    setBusy(true);
    try {
      const { data: srcItems, error: itemsErr } = await supabase
        .from("fin_document_items")
        .select("*")
        .eq("doc_id", convertRow.id)
        .order("line_no");
      if (itemsErr) throw itemsErr;

      const { data: noData, error: noErr } = await supabase.rpc("next_fin_no", {
        p_kind: convertTo,
        p_store_id: convertRow.store_id,
      });
      if (noErr) throw noErr;

      const { data: created, error: docErr } = await supabase
        .from("fin_documents")
        .insert({
          doc_type: convertTo,
          doc_no: noData as string,
          doc_date: today(),
          store_id: convertRow.store_id,
          party_type: convertRow.party_type,
          party_id: convertRow.party_id,
          party_name: convertRow.party_name,
          party_address: convertRow.party_address,
          ref_doc_id: convertRow.id,
          status: "draft",
          subtotal: convertRow.subtotal,
          discount: convertRow.discount,
          tax_amount: convertRow.tax_amount,
          total: convertRow.total,
          terms: convertRow.terms,
          note: convertRow.note,
          created_by: profile?.email || null,
        })
        .select()
        .single();
      if (docErr) throw docErr;

      const doc = created as FinDocument;
      const rows = ((srcItems as DocItem[]) || []).map((it, i) => ({
        doc_id: doc.id,
        line_no: i + 1,
        product_id: it.product_id,
        description: it.description,
        qty: it.qty,
        unit_price: it.unit_price,
        discount_pct: it.discount_pct,
        line_total: it.line_total,
      }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("fin_document_items").insert(rows);
        if (insErr) {
          await supabase.from("fin_documents").delete().eq("id", doc.id);
          throw insErr;
        }
      }

      showToast(t("fin_saved"));
      setConvertRow(null);
      setConvertTo("");
      await load();
    } catch (err) {
      showToast("❌ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-4">
      <div className="print:hidden">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="font-semibold text-lg">{t("nav_finDocuments")}</h2>
          <button
            onClick={openNew}
            className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-semibold shrink-0"
          >
            {t("fin_new")}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <select
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {docTypeLabel(d)}
              </option>
            ))}
          </select>
          <select
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">{t("fin_all")}</option>
            {DOC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <input
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]"
            placeholder={t("fin_search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">{t("fin_no")}</th>
                <th className="text-left px-3 py-2">{t("fin_kind")}</th>
                <th className="text-left px-3 py-2">{t("fin_date")}</th>
                <th className="text-left px-3 py-2">{t("fin_party")}</th>
                <th className="text-right px-3 py-2">{t("fin_total")}</th>
                <th className="text-left px-3 py-2">{t("fin_status")}</th>
                <th className="text-left px-3 py-2">{t("fin_reference")}</th>
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
                docs.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      <button onClick={() => openDetail(d)} className="text-blue-600 font-medium">
                        {d.doc_no}
                      </button>
                    </td>
                    <td className="px-3 py-2">{docTypeLabel(d.doc_type)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.doc_date}</td>
                    <td className="px-3 py-2">
                      {d.party_name || "-"}
                      {d.ref_doc_id && refNos[d.ref_doc_id] && (
                        <div className="text-[10px] text-slate-400">
                          {t("fin_convertedFrom")} {refNos[d.ref_doc_id]}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{fmtNum(d.total)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          STATUS_COLORS[d.status] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {statusLabel(d.status)}
                      </span>
                      {d.checked_by && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{d.checked_by}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      {d.voucher_id ? voucherNos[d.voucher_id] || "-" : "-"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        {d.status === "draft" && (
                          <button
                            onClick={() => setStatus(d, "issued")}
                            disabled={busy}
                            className="text-blue-600 text-xs font-medium disabled:text-slate-300"
                          >
                            {t("fin_issue")}
                          </button>
                        )}
                        {d.status === "issued" && (
                          <button
                            onClick={() => setStatus(d, "checked")}
                            disabled={busy}
                            className="text-green-600 text-xs font-medium disabled:text-slate-300"
                          >
                            {t("fin_markChecked")}
                          </button>
                        )}
                        {d.status !== "cancelled" && (
                          <button
                            onClick={() => setStatus(d, "cancelled")}
                            disabled={busy}
                            className="text-slate-400 text-xs font-medium"
                          >
                            {t("fin_cancel")}
                          </button>
                        )}
                        {(DOC_FLOW[d.doc_type] || []).length > 0 && d.status !== "cancelled" && (
                          <button
                            onClick={() => {
                              setConvertRow(d);
                              setConvertTo((DOC_FLOW[d.doc_type] || [])[0] || "");
                            }}
                            className="text-slate-700 text-xs font-medium"
                          >
                            {t("fin_convertTo")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              {!loading && docs.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-8">
                    {t("fin_empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg mb-4">{t("fin_new")}</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">{t("fin_kind")}</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={docType}
                  onChange={(e) => changeDocType(e.target.value as DocType)}
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {docTypeLabel(d)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_date")}</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_store")}</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={docStoreValue}
                  onChange={(e) => setDocStore(e.target.value)}
                >
                  <option value="">-</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">{t("fin_party")}</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={partyType}
                  onChange={(e) => {
                    setPartyType(e.target.value as "customer" | "supplier");
                    setPartyId("");
                    setPartyName("");
                  }}
                >
                  <option value="customer">{t("fin_customer")}</option>
                  <option value="supplier">{t("fin_supplier")}</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-slate-600">
                  {partyType === "customer" ? t("fin_customer") : t("fin_supplier")}
                </label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={partyId}
                  onChange={(e) => {
                    setPartyId(e.target.value);
                    setPartyName(parties.find((p) => p.id === e.target.value)?.name || "");
                  }}
                >
                  <option value="">-</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-sm text-slate-600">{t("fin_party")}</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_note")}</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  placeholder={t("fin_description")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {docType === "quotation" && (
                <div>
                  <label className="text-sm text-slate-600">{t("fin_dueDate")}</label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label className="text-sm text-slate-600">{t("fin_reference")}</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">{t("fin_note")}</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mt-1"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">{t("fin_description")}</th>
                    <th className="text-right px-3 py-2 w-24">{t("fin_qty")}</th>
                    <th className="text-right px-3 py-2 w-32">{t("fin_unitPrice")}</th>
                    <th className="text-right px-3 py-2 w-24">{t("fin_tradeDiscount")}</th>
                    <th className="text-right px-3 py-2 w-32">{t("fin_lineTotal")}</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {formLines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">
                        <input
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                          value={l.description}
                          onChange={(e) => setLine(i, { description: e.target.value })}
                        />
                        <select
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs mt-1 text-slate-500"
                          value={l.product_id}
                          onChange={(e) => {
                            const p = products.find((x) => x.id === e.target.value);
                            setLine(i, {
                              product_id: e.target.value,
                              description: p ? p.name : l.description,
                            });
                          }}
                        >
                          <option value="">-</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku ? `${p.sku} · ` : ""}
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
                          value={l.qty}
                          onChange={(e) => setLine(i, { qty: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
                          value={l.unit_price}
                          onChange={(e) => setLine(i, { unit_price: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right"
                          value={l.discount_pct}
                          onChange={(e) => setLine(i, { discount_pct: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {fmtNum(
                          lineValue({
                            qty: Number(l.qty || 0),
                            unit_price: Number(l.unit_price || 0),
                            discount_pct: Number(l.discount_pct || 0),
                          })
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formLines.length > 1 && (
                          <button
                            onClick={() =>
                              setFormLines((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="text-slate-400 text-sm"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-start gap-3 mt-3">
              <button
                onClick={() => setFormLines((prev) => [...prev, emptyLine()])}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium"
              >
                {t("fin_addLine")}
              </button>
              <div className="flex-1" />
              <div className="w-full sm:w-72 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">{t("fin_subtotal")}</span>
                  <span>{fmtMMK(grossTotal)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">{t("fin_tradeDiscount")}</span>
                  <span>{fmtMMK(discountTotal)}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500">{t("fin_tax")}</span>
                  <input
                    type="number"
                    className="border border-slate-200 rounded-lg px-2 py-1 text-sm text-right w-32"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                  />
                </div>
                <div className="flex justify-between py-1 border-t border-slate-200 mt-1 font-semibold">
                  <span>{t("fin_total")}</span>
                  <span>{fmtMMK(grandTotal)}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowNew(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={saveDocument}
                disabled={busy}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
              >
                {busy ? "..." : t("fin_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 print:static print:bg-transparent print:p-0 print:block">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl shadow-lg max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:shadow-none print:rounded-none print:p-0">
            <div className="flex items-start justify-between gap-3 mb-4 print:hidden">
              <div>
                <h3 className="font-semibold text-lg">{detail.doc_no}</h3>
                <p className="text-sm text-slate-500">
                  {docTypeLabel(detail.doc_type)} · {statusLabel(detail.status)}
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
                  onClick={() => setDetail(null)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium"
                >
                  {t("fin_cancel")}
                </button>
              </div>
            </div>

            <div className="print:block">
              <div className="flex flex-wrap justify-between gap-4 mb-4">
                <div>
                  <div className="text-lg font-bold">{docTypeLabel(detail.doc_type)}</div>
                  <div className="font-mono text-sm">{detail.doc_no}</div>
                  <div className="text-sm text-slate-500">
                    {t("fin_date")}: {detail.doc_date}
                  </div>
                  {detail.valid_until && (
                    <div className="text-sm text-slate-500">
                      {t("fin_dueDate")}: {detail.valid_until}
                    </div>
                  )}
                  {detail.ref_doc_id && refNos[detail.ref_doc_id] && (
                    <div className="text-sm text-slate-500">
                      {t("fin_convertedFrom")} {refNos[detail.ref_doc_id]}
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <div className="text-slate-500">{t("fin_party")}</div>
                  <div className="font-medium">{detail.party_name || "-"}</div>
                  {detail.party_address && (
                    <div className="text-slate-500 whitespace-pre-line">{detail.party_address}</div>
                  )}
                  <div className="text-slate-500 mt-1">{storeName(detail.store_id)}</div>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl print:border-0">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">{t("fin_description")}</th>
                      <th className="text-right px-3 py-2">{t("fin_qty")}</th>
                      <th className="text-right px-3 py-2">{t("fin_unitPrice")}</th>
                      <th className="text-right px-3 py-2">{t("fin_tradeDiscount")}</th>
                      <th className="text-right px-3 py-2">{t("fin_lineTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailItems.map((it, i) => (
                      <tr key={it.id || i} className="border-t border-slate-100">
                        <td className="px-3 py-2">{it.description}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(it.qty)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(it.unit_price)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(it.discount_pct)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtNum(it.line_total)}</td>
                      </tr>
                    ))}
                    {detailItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-slate-400 py-6">
                          {t("fin_empty")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end mt-3">
                <div className="w-full sm:w-72 text-sm">
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">{t("fin_subtotal")}</span>
                    <span>{fmtMMK(detail.subtotal)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">{t("fin_tradeDiscount")}</span>
                    <span>{fmtMMK(detail.discount)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">{t("fin_tax")}</span>
                    <span>{fmtMMK(detail.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-t border-slate-200 mt-1 font-semibold">
                    <span>{t("fin_total")}</span>
                    <span>{fmtMMK(detail.total)}</span>
                  </div>
                </div>
              </div>

              {detail.terms && (
                <p className="text-xs text-slate-500 mt-4 whitespace-pre-line">{detail.terms}</p>
              )}
              {detail.note && (
                <p className="text-xs text-slate-500 mt-1 whitespace-pre-line">{detail.note}</p>
              )}
              {detail.checked_by && (
                <p className="text-xs text-slate-500 mt-4">
                  {t("fin_markChecked")}: {detail.checked_by}
                  {detail.checked_at ? ` · ${new Date(detail.checked_at).toLocaleString()}` : ""}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {convertRow && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-lg">
            <h3 className="font-semibold text-lg mb-1">{t("fin_convertTo")}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {convertRow.doc_no} · {docTypeLabel(convertRow.doc_type)}
            </p>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4"
              value={convertTo}
              onChange={(e) => setConvertTo(e.target.value as DocType)}
            >
              {(DOC_FLOW[convertRow.doc_type] || []).map((d) => (
                <option key={d} value={d}>
                  {docTypeLabel(d)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setConvertRow(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {t("fin_cancel")}
              </button>
              <button
                onClick={convert}
                disabled={busy || !convertTo}
                className="flex-1 py-2.5 bg-slate-900 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold"
              >
                {busy ? "..." : t("fin_save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50 print:hidden">
          {toast}
        </div>
      )}
    </div>
  );
}

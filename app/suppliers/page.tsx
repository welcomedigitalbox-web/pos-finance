"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";
import { hasPermission } from "@/app/permissions";
import { fmtMMK } from "@/lib/finance";

// Who the company buys from, and what is owed to each of them.
//
// Finance could see a supplier's name on a bill and nothing else - not the
// phone number to ring about it, not the payment terms that decide when it
// falls due, not what is already outstanding. The list is kept by
// merchandising; this is the same list, read-only, beside the money.
type Supplier = {
  id: string;
  name: string;
  company_name: string | null;
  dica_no: string | null;
  tax_no: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  payment_terms: string | null;
  is_active: boolean | null;
  note: string | null;
};

// Where the money actually goes. Finance was reading these off a chat
// message; they belong beside the bill.
type Bank = {
  id: string;
  supplier_id: string;
  bank_name: string | null;
  account_name: string | null;
  account_no: string | null;
  branch: string | null;
  currency: string | null;
  is_primary: boolean | null;
};

type Doc = {
  id: string;
  supplier_id: string;
  title: string | null;
  doc_type: string | null;
  file_path: string | null;
  expires_on: string | null;
};

type Owed = { supplier_id: string; outstanding: number; bills: number };

export default function FinanceSuppliersPage() {
  const { profile } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<Supplier[]>([]);
  const [owed, setOwed] = useState<Record<string, Owed>>({});
  const [banks, setBanks] = useState<Record<string, Bank[]>>({});
  const [docs, setDocs] = useState<Record<string, Doc[]>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Supplier | null>(null);

  useEffect(() => {
    if (profile && !hasPermission(profile, "fin-payables")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    load();
  }, []);

  const blocked = !profile || !hasPermission(profile, "fin-payables");

  async function load() {
    setLoading(true);
    const [{ data: sup }, { data: bills }, { data: bk }, { data: dc }] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      // What is still owed, straight from the bills finance has approved.
      supabase
        .from("purchase_invoices")
        .select("supplier_id,total,status")
        .eq("status", "approved")
        .limit(1000),
      supabase
        .from("supplier_bank_accounts")
        .select("id,supplier_id,bank_name,account_name,account_no,branch,currency,is_primary")
        .order("is_primary", { ascending: false })
        .limit(1000),
      supabase
        .from("supplier_documents")
        .select("id,supplier_id,title,doc_type,file_path,expires_on")
        .limit(1000),
    ]);

    const byBank: Record<string, Bank[]> = {};
    for (const b of ((bk as Bank[]) || [])) (byBank[b.supplier_id] ||= []).push(b);
    const byDoc: Record<string, Doc[]> = {};
    for (const d of ((dc as Doc[]) || [])) (byDoc[d.supplier_id] ||= []).push(d);
    setBanks(byBank);
    setDocs(byDoc);

    const by: Record<string, Owed> = {};
    for (const b of ((bills as { supplier_id: string; total: number }[]) || [])) {
      const cur = by[b.supplier_id] || { supplier_id: b.supplier_id, outstanding: 0, bills: 0 };
      cur.outstanding += Number(b.total || 0);
      cur.bills += 1;
      by[b.supplier_id] = cur;
    }

    setRows((sup as Supplier[]) || []);
    setOwed(by);
    setLoading(false);
  }

  // A private bucket, so the file opens through a link that expires.
  async function openDoc(path: string) {
    const { data } = await supabase.storage
      .from("supplier-docs")
      .createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.name, r.phone, r.contact_person, r.email, r.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [rows, q]);

  if (blocked) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <h1 className="text-xl font-semibold">Suppliers</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-4">
        Kept by merchandising. Read-only here, so the contact you ring about a
        bill is the same one on the order.
      </p>

      <input
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full sm:w-80 mb-3"
        placeholder="Search name, phone or contact"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2">Supplier</th>
              <th className="text-left px-3 py-2">Contact</th>
              <th className="text-left px-3 py-2">Phone</th>
              <th className="text-left px-3 py-2">Term</th>
              <th className="text-left px-3 py-2">Bank</th>
              <th className="text-right px-3 py-2">Approved bills</th>
              <th className="text-right px-3 py-2">Value</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">...</td>
              </tr>
            )}
            {!loading &&
              shown.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${
                    s.is_active === false ? "opacity-50" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium">
                    {s.name}
                    {s.is_active === false && (
                      <span className="ml-2 text-[10px] text-slate-400">inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{s.contact_person || "-"}</td>
                  <td className="px-3 py-2 text-slate-500">{s.phone || "-"}</td>
                  <td className="px-3 py-2 text-slate-500">{s.payment_terms || "-"}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {banks[s.id]?.[0]
                      ? `${banks[s.id][0].bank_name || ""} ${banks[s.id][0].account_no || ""}`.trim()
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">{owed[s.id]?.bills ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    {owed[s.id] ? fmtMMK(owed[s.id].outstanding) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setOpen(s)}
                      className="text-blue-600 text-xs font-medium"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  Nothing matches.
                </td>
              </tr>
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
            className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-lg my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-lg mb-3">{open.name}</h3>
            <dl className="text-sm space-y-2">
              {[
                ["Registered name", open.company_name],
                ["DICA no.", open.dica_no],
                ["Tax / TIN", open.tax_no],
                ["Contact", open.contact_person],
                ["Contact phone", open.contact_phone],
                ["Phone", open.phone],
                ["Email", open.email],
                ["Website", open.website],
                ["Address", open.address],
                ["Payment terms", open.payment_terms],
                ["Note", open.note],
              ].map(([label, value]) => (
                <div key={label as string} className="flex gap-3">
                  <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
                  <dd className="flex-1">{value || "-"}</dd>
                </div>
              ))}
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <dt className="w-32 shrink-0 text-slate-500">Approved bills</dt>
                <dd className="flex-1 font-medium">
                  {owed[open.id]?.bills ?? 0}
                  {owed[open.id] ? ` · ${fmtMMK(owed[open.id].outstanding)}` : ""}
                </dd>
              </div>
            </dl>

            {(banks[open.id] || []).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-500 mb-1.5">Bank accounts</div>
                {(banks[open.id] || []).map((b) => (
                  <div key={b.id} className="border border-slate-200 rounded-lg px-3 py-2 mb-2 text-sm">
                    <div className="font-medium">
                      {b.bank_name || "-"}
                      {b.is_primary && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                          primary
                        </span>
                      )}
                    </div>
                    <div className="font-mono">{b.account_no || "-"}</div>
                    <div className="text-xs text-slate-500">
                      {[b.account_name, b.branch, b.currency].filter(Boolean).join(" · ") || "-"}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(docs[open.id] || []).length > 0 && (
              <div className="mt-2 border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-500 mb-1.5">Documents</div>
                <div className="flex flex-wrap gap-2">
                  {(docs[open.id] || []).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => d.file_path && openDoc(d.file_path)}
                      className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white hover:border-blue-300"
                    >
                      📎 {d.title || d.doc_type}
                      {d.expires_on && <span className="text-slate-400"> · to {d.expires_on}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setOpen(null)}
              className="mt-5 w-full py-2.5 border border-slate-200 rounded-lg text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

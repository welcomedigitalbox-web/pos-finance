"use client";

// =====================================================================
// Damage, filed by accounts.
//
// The finance team works in this app and nowhere else, so this is where
// a damage is written up — but what it describes is stock, and the stock
// lives on the other side of the same database. The accountant scans the
// damaged pieces, says how many, and sends the lot to the warehouse. The
// warehouse receives it in the ERP, and that is the moment the shop's
// stock comes off.
//
// Nothing is deducted here. The goods are still sitting in the shop when
// this form is filled in, and a system that writes them off before
// anybody has handled them produces a stock figure nobody can stand
// behind.
//
// Unlike the ERP's version this page does not load the catalogue. A
// finance account has no business pulling three thousand products down
// to type one number, so each scan asks the database about that one code
// and nothing else.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Line = {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  sku: string | null;
  on_hand: number | null;
  qty: number;
  reason: string;
};

type Filed = {
  damage_no: string;
  store_id: string;
  status: string;
  created_at: string;
  lines: number;
  qty: number;
  value: number;
  received_by: string | null;
  reject_reason: string | null;
};

const REASONS = [
  "Broken in transit",
  "Broken in store",
  "Expired",
  "Packaging damaged",
  "Customer return, unsellable",
  "Other",
];

const num = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for the warehouse",
  received: "Received by the warehouse",
  rejected: "Rejected",
  approved: "Approved (old record)",
};

export default function FinanceDamagePage() {
  const [email, setEmail] = useState<string | null>(null);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [store, setStore] = useState("");
  const [code, setCode] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filed, setFiled] = useState<Filed[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    supabase.rpc("can_file_damage").then(({ data }) => setAllowed(!!data));
    supabase
      .from("stores")
      .select("id, name")
      .order("id")
      .then(({ data }) => setStores(data || []));
  }, []);

  const loadFiled = useCallback(async () => {
    const { data, error } = await supabase
      .from("stock_damages")
      .select("damage_no, store_id, status, created_at, qty, unit_cost, warehouse_approved_by, reject_reason")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return;
    const byNo = new Map<string, Filed>();
    for (const r of data || []) {
      const no = r.damage_no || "—";
      let g = byNo.get(no);
      if (!g) {
        g = {
          damage_no: no,
          store_id: r.store_id,
          status: r.status,
          created_at: r.created_at,
          lines: 0,
          qty: 0,
          value: 0,
          received_by: r.warehouse_approved_by,
          reject_reason: r.reject_reason,
        };
        byNo.set(no, g);
      }
      g.lines += 1;
      g.qty += Number(r.qty || 0);
      g.value += Number(r.qty || 0) * Number(r.unit_cost || 0);
    }
    setFiled([...byNo.values()].slice(0, 40));
  }, []);

  useEffect(() => {
    loadFiled();
  }, [loadFiled]);

  // -----------------------------------------------------------------
  // One code, one question to the database. resolve_barcode knows the
  // supplier's barcode, the warehouse's own sticker, a carton code, and
  // the article number — so whatever is printed on the piece in hand
  // will find it.
  // -----------------------------------------------------------------
  const add = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || !store) return;
      setErr(null);
      setLooking(true);

      try {
        const { data: hitData } = await supabase.rpc("resolve_barcode", { p_code: q });
        const hit = Array.isArray(hitData) ? hitData[0] : hitData;

        let productId: string | null = hit?.product_id ?? null;
        let variantId: string | null = hit?.variant_id ?? null;
        let name = "";
        let sku: string | null = null;

        if (!productId) {
          // Not a code the system knows. Try it as a name, which is the
          // fallback for the piece whose label is the thing that broke.
          const { data: byName } = await supabase
            .from("products")
            .select("id, name, sku")
            .ilike("name", `%${q}%`)
            .limit(5);
          if (!byName || byName.length === 0) {
            setErr(`Nothing found for "${q}"`);
            return;
          }
          if (byName.length > 1) {
            setErr(`${byName.length} products match "${q}" — scan the barcode instead`);
            return;
          }
          productId = byName[0].id;
          name = byName[0].name;
          sku = byName[0].sku;
        } else {
          const { data: p } = await supabase
            .from("products")
            .select("name, sku")
            .eq("id", productId)
            .maybeSingle();
          name = p?.name || "";
          sku = p?.sku || null;
          if (variantId) {
            const { data: v } = await supabase
              .from("product_variants")
              .select("variant_name, sku")
              .eq("id", variantId)
              .maybeSingle();
            if (v?.variant_name) name = `${name} (${v.variant_name})`;
            if (v?.sku) sku = v.sku;
          }
        }

        // What the shop says it has, shown next to the line so an
        // obviously wrong quantity is obvious before it is sent.
        let onHand: number | null = null;
        const inv = supabase
          .from("store_inventory")
          .select("stock_qty")
          .eq("store_id", store)
          .eq("product_id", productId);
        const { data: si } = await (variantId
          ? inv.eq("variant_id", variantId).maybeSingle()
          : inv.is("variant_id", null).maybeSingle());
        if (si) onHand = Number(si.stock_qty);

        const key = `${productId}:${variantId || ""}`;
        setLines((prev) => {
          const at = prev.findIndex((l) => l.key === key);
          if (at >= 0) {
            const next = [...prev];
            next[at] = { ...next[at], qty: next[at].qty + 1 };
            return next;
          }
          return [
            ...prev,
            {
              key,
              product_id: productId!,
              variant_id: variantId,
              name: name || productId!,
              sku,
              on_hand: onHand,
              qty: 1,
              reason: REASONS[0],
            },
          ];
        });
        setCode("");
      } finally {
        setLooking(false);
        scanRef.current?.focus();
      }
    },
    [store]
  );

  const totalQty = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);
  const overHand = useMemo(
    () => lines.filter((l) => l.on_hand !== null && l.qty > l.on_hand!),
    [lines]
  );

  async function submit() {
    setErr(null);
    setMsg(null);
    if (!store) return setErr("Choose the shop the goods are in");
    if (!lines.length) return setErr("Nothing to report");
    if (lines.some((l) => !(l.qty > 0))) return setErr("Every line needs a quantity");

    setSaving(true);
    const { data, error } = await supabase.rpc("create_stock_damage", {
      p_store_id: store,
      p_items: lines.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        qty: l.qty,
        reason: l.reason,
      })),
      p_note: note || null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    setLines([]);
    setNote("");
    setMsg(`${data} sent to the warehouse. Stock comes off when they receive it.`);
    loadFiled();
    scanRef.current?.focus();
  }

  if (allowed === null) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Damage</h1>
        <p className="mt-2 text-sm text-gray-600">
          Damages are filed by the senior accountant and received by the warehouse.
          Your account is not set up to file them.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold">
        Report damage
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        Scan the damaged pieces and send them to the warehouse. Stock comes off
        when the warehouse receives them, not now.
      </p>

      {err && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}
      {msg && (
        <div className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {msg}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Shop the goods are in</span>
          <select
            value={store}
            onChange={(e) => { setStore(e.target.value); setLines([]); }}
            className="border rounded px-2 py-1.5 min-w-[12rem]"
          >
            <option value="">—</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="text-sm text-gray-500 pb-2">
          Reported by {email || "—"}
        </div>
      </div>

      <div className="mt-4">
        <label className="text-sm block text-gray-600 mb-1">Scan each piece</label>
        <input
          ref={scanRef}
          autoFocus
          value={code}
          disabled={!store || looking}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(code);
            }
          }}
          placeholder={store ? "Barcode, SKU, or product name — then Enter" : "Choose a shop first"}
          className="w-full border rounded px-3 py-2 font-mono"
        />
        <p className="mt-1 text-xs text-gray-500">
          Scanning the same piece again adds one to its quantity.
          {looking && " Looking it up…"}
        </p>
      </div>

      {lines.length > 0 && (
        <div className="mt-4 overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right w-24">In shop</th>
                <th className="px-3 py-2 w-24">Damaged</th>
                <th className="px-3 py-2 w-56">Reason</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const over = l.on_hand !== null && l.qty > l.on_hand;
                return (
                  <tr key={l.key} className="border-t">
                    <td className="px-3 py-2">
                      <div>{l.name}</div>
                      {l.sku && <div className="text-xs text-gray-400 font-mono">{l.sku}</div>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {l.on_hand === null ? "—" : num(l.on_hand)}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={l.qty}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setLines((p) => p.map((x, k) => (k === i ? { ...x, qty: v } : x)));
                        }}
                        className={`w-20 border rounded px-2 py-1 text-right ${
                          over ? "border-red-400 bg-red-50" : ""
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={l.reason}
                        onChange={(e) =>
                          setLines((p) => p.map((x, k) => (k === i ? { ...x, reason: e.target.value } : x)))
                        }
                        className="w-full border rounded px-2 py-1"
                      >
                        {REASONS.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setLines((p) => p.filter((_, k) => k !== i))}
                        className="text-gray-400 hover:text-red-600"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t">
              <tr>
                <td className="px-3 py-2 font-medium">{lines.length} lines</td>
                <td />
                <td className="px-3 py-2 font-medium text-right">{num(totalQty)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {overHand.length > 0 && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          More damaged than the shop is recorded as holding:{" "}
          {overHand.map((l) => l.name).join(", ")}. Worth checking the count before
          sending — the warehouse will be asked to receive goods the books say are
          not there.
        </div>
      )}

      <label className="mt-4 block text-sm">
        <span className="block text-gray-600 mb-1">Note for the warehouse (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="Who is bringing it over, when"
        />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={saving || !lines.length || !store}
          className="rounded bg-blue-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Sending…" : "Send to warehouse"}
        </button>
        <span className="text-xs text-gray-500">
          Nothing comes off stock until the warehouse receives it.
        </span>
      </div>

      {/* ------------------------------------------------------------ */}
      <h2 className="mt-10 text-base font-semibold">Filed recently</h2>
      <p className="mt-1 text-xs text-gray-500">
        What has been sent and whether the warehouse has taken it in.
      </p>

      {filed.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">Nothing filed yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2">Shop</th>
                <th className="px-3 py-2">Filed</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filed.map((f) => (
                <tr key={f.damage_no} className="border-t">
                  <td className="px-3 py-2 font-mono">{f.damage_no}</td>
                  <td className="px-3 py-2 text-gray-600">{f.store_id}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {new Date(f.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">{num(f.qty)}</td>
                  <td className="px-3 py-2 text-right">{num(f.value)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        f.status === "pending"
                          ? "text-amber-700"
                          : f.status === "rejected"
                          ? "text-red-700"
                          : "text-gray-600"
                      }
                    >
                      {STATUS_LABEL[f.status] || f.status}
                    </span>
                    {f.status === "rejected" && f.reject_reason && (
                      <div className="text-xs text-gray-500">{f.reject_reason}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

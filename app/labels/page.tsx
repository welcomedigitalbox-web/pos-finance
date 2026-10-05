"use client";

// =====================================================================
// Sticker labels for the warehouse.
//
// The department already has a label and a printer: a Nippon POS RP400H
// on 115mm paper, three 40×25mm labels across. So this page does not
// invent a format — it reproduces the one on the roll, and prints through
// the printer's own Windows driver like any other document.
//
// What goes on a label is what somebody standing at a shelf needs: the
// product's name, a barcode a scanner will actually read, and the code
// underneath in case the scanner will not.
//
// Quantities come from the goods that arrived, not from a person counting
// again: pick a received purchase order and the lines come with their
// quantities already set.
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, fetchSellableItems, SellableItem, describeError } from "@/lib/supabase";
import { useAuth } from "../auth-context";
import { useStore } from "../store-context";
import { useLanguage } from "../language-context";
import { hasPermission } from "../permissions";
import { code128Svg, moduleWidthMm } from "@/lib/code128";

type Line = {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  sku: string | null;
  price: number;
  code: string;          // what the barcode will carry
  codeKind: string;      // where that code came from
  qty: number;
};

// The roll the department buys. Other sizes are here because a second roll
// turns up eventually and nobody should have to change code for it.
const PRESETS: Record<string, { w: number; h: number; across: number; label: string }> = {
  "40x25x3": { w: 40, h: 25, across: 3, label: "40 × 25mm · 3 across (115mm)" },
  "50x25x2": { w: 50, h: 25, across: 2, label: "50 × 25mm · 2 across" },
  "40x30x3": { w: 40, h: 30, across: 3, label: "40 × 30mm · 3 across" },
  "70x40x1": { w: 70, h: 40, across: 1, label: "70 × 40mm · 1 across" },
};

export default function LabelsPage() {
  const { profile } = useAuth();
  const { storeId } = useStore();
  const { t } = useLanguage();
  const router = useRouter();

  const [items, setItems] = useState<SellableItem[]>([]);
  const [barcodes, setBarcodes] = useState<Record<string, { barcode: string; kind: string }>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState("40x25x3");
  const [showPrice, setShowPrice] = useState(false);
  const [showName, setShowName] = useState(true);
  const [pos, setPos] = useState<{ id: string; po_number: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const size = PRESETS[preset];

  useEffect(() => {
    if (profile && !hasPermission(profile, "labels")) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      const [list, bc, po] = await Promise.all([
        fetchSellableItems(storeId, true),
        supabase.from("product_barcodes")
          .select("product_id,variant_id,barcode,kind")
          .eq("is_active", true)
          .neq("kind", "carton")
          .limit(5000),
        supabase.from("purchase_orders")
          .select("id,po_number,status,order_date")
          .in("status", ["received", "partial"])
          .order("order_date", { ascending: false })
          .limit(30),
      ]);
      setItems(list);
      const map: Record<string, { barcode: string; kind: string }> = {};
      for (const b of (bc.data as any[]) || []) {
        const k = `${b.product_id}:${b.variant_id || "base"}`;
        // A supplier's own barcode is what is already on the box, so it
        // wins: reprinting our own over it only adds a second answer.
        if (!map[k] || b.kind === "supplier") map[k] = { barcode: b.barcode, kind: b.kind };
      }
      setBarcodes(map);
      setPos(((po.data as any[]) || []).map((p) => ({ id: p.id, po_number: p.po_number })));
    })();
  }, [storeId]);

  function say(m: string) {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  }

  function codeFor(i: SellableItem) {
    const hit = barcodes[`${i.product_id}:${i.variant_id || "base"}`];
    if (hit) return { code: hit.barcode, kind: hit.kind };
    if (i.sku) return { code: i.sku, kind: "sku" };
    return { code: "", kind: "none" };
  }

  function addItem(i: SellableItem, qty = 1) {
    const c = codeFor(i);
    setLines((rows) => {
      const at = rows.findIndex((r) => r.key === i.key);
      if (at >= 0) {
        return rows.map((r, n) => (n === at ? { ...r, qty: r.qty + qty } : r));
      }
      return [...rows, {
        key: i.key, product_id: i.product_id, variant_id: i.variant_id,
        name: i.display_name, sku: i.sku, price: i.price,
        code: c.code, codeKind: c.kind, qty,
      }];
    });
  }

  // Goods that have arrived are the usual reason to print: the quantities
  // are already known, so they are not asked for again.
  async function fromPo(poId: string) {
    if (!poId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("product_id, variant_id, received_qty")
        .eq("po_id", poId)
        .gt("received_qty", 0);
      if (error) throw error;
      let added = 0;
      for (const row of (data as any[]) || []) {
        const hit = items.find(
          (i) => i.product_id === row.product_id &&
            (i.variant_id || null) === (row.variant_id || null)
        );
        if (hit) { addItem(hit, Number(row.received_qty) || 0); added++; }
      }
      say(added ? `✅ ${added}` : "❌ " + t("stockIn_noItems"));
    } catch (err) {
      say("❌ " + describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // Goods with no barcode of their own get one of ours, once.
  async function issueCode(line: Line) {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("issue_internal_barcode", {
        p_product: line.product_id,
        p_variant: line.variant_id,
      });
      if (error) throw error;
      const code = String(data);
      setLines((rows) => rows.map((r) =>
        r.key === line.key ? { ...r, code, codeKind: "internal" } : r));
      setBarcodes((m) => ({
        ...m,
        [`${line.product_id}:${line.variant_id || "base"}`]: { barcode: code, kind: "internal" },
      }));
    } catch (err) {
      say("❌ " + describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(
      (i) => i.display_name.toLowerCase().includes(q) || (i.sku || "").toLowerCase().includes(q)
    ).slice(0, 20);
  }, [items, search]);

  // One entry per sticker, which is what the sheet is laid out from.
  const stickers = useMemo(
    () => lines.flatMap((l) => Array.from({ length: Math.max(0, Math.floor(l.qty)) }, () => l)),
    [lines]
  );

  const total = stickers.length;
  const barcodeWidth = size.w - 6;
  const tooNarrow = lines.filter(
    (l) => l.code && moduleWidthMm(l.code, barcodeWidth) < 0.25
  );
  const noCode = lines.filter((l) => !l.code);

  if (!profile || !hasPermission(profile, "labels")) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <style>{`
        @media print {
          /* The roll, not a page of A4. Margins are the printer's job. */
          @page { size: ${size.across * size.w}mm auto; margin: 0; }
          body * { visibility: hidden; }
          #sheet, #sheet * { visibility: visible; }
          #sheet { position: absolute; left: 0; top: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <h1 className="text-xl font-semibold">{t("labels_title")}</h1>
        <p className="text-sm text-slate-500 mt-0.5 mb-4">{t("labels_subtitle")}</p>

        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500">{t("labels_size")}</label>
              <select value={preset} onChange={(e) => setPreset(e.target.value)}
                className="block border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-1">
                {Object.entries(PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">{t("labels_fromPo")}</label>
              <select defaultValue="" disabled={busy}
                onChange={(e) => { fromPo(e.target.value); e.target.value = ""; }}
                className="block border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-1 max-w-[170px]">
                <option value="">{t("stockIn_selectPlaceholder")}</option>
                {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-sm pb-2">
              <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
              {t("labels_showName")}
            </label>
            <label className="flex items-center gap-1.5 text-sm pb-2">
              <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
              {t("labels_showPrice")}
            </label>
          </div>

          <div className="mt-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("labels_search")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            {found.length > 0 && (
              <div className="border border-slate-200 rounded-lg mt-1 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {found.map((i) => (
                  <button key={i.key} onClick={() => { addItem(i); setSearch(""); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                    {i.display_name}
                    <span className="text-slate-400 ml-2">{i.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {lines.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">{t("stockIn_product")}</th>
                  <th className="text-left px-3 py-2">{t("labels_code")}</th>
                  <th className="text-right px-3 py-2">{t("labels_qty")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-t border-slate-100">
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2">
                      {l.code ? (
                        <>
                          <span className="font-mono">{l.code}</span>
                          <span className="text-xs text-slate-400 ml-2">
                            {t(`labels_kind_${l.codeKind}` as never)}
                          </span>
                        </>
                      ) : (
                        <button onClick={() => issueCode(l)} disabled={busy}
                          className="text-xs text-blue-600 underline">
                          {t("labels_issue")}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" value={l.qty} min={0}
                        onChange={(e) => setLines((rows) => rows.map((r) =>
                          r.key === l.key ? { ...r, qty: Number(e.target.value) } : r))}
                        className="w-20 border border-slate-200 rounded px-2 py-1 text-right" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setLines((rows) => rows.filter((r) => r.key !== l.key))}
                        className="text-red-600 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Said before the roll is spent, not after. */}
        {noCode.length > 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-2">
            {t("labels_needCode")} — {noCode.map((l) => l.name).join(", ")}
          </p>
        )}
        {tooNarrow.length > 0 && (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-2">
            {t("labels_tooNarrow")} — {tooNarrow.map((l) => l.name).join(", ")}
          </p>
        )}

        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => window.print()}
            disabled={!total || noCode.length > 0}
            className="px-5 py-2 bg-blue-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold">
            🖨 {t("labels_print")} ({total})
          </button>
          {lines.length > 0 && (
            <button onClick={() => setLines([])} className="text-sm text-slate-500">
              {t("labels_clear")}
            </button>
          )}
        </div>

        <h2 className="text-sm font-medium text-slate-500 mb-2">{t("labels_preview")}</h2>
      </div>

      {/* The sheet itself. Sized in millimetres so what prints is what the
          roll expects, whatever the screen is doing. */}
      <div
        id="sheet"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${size.across}, ${size.w}mm)`,
          width: `${size.across * size.w}mm`,
        }}
      >
        {stickers.map((l, n) => (
          <div
            key={n}
            style={{
              width: `${size.w}mm`,
              height: `${size.h}mm`,
              padding: "1.5mm 2mm",
              boxSizing: "border-box",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              breakInside: "avoid",
            }}
          >
            {showName && (
              <div style={{
                fontSize: "2.2mm", lineHeight: 1.15, textAlign: "center",
                maxHeight: "5mm", overflow: "hidden", marginBottom: "0.8mm",
              }}>
                {l.name}
              </div>
            )}
            <div
              style={{ width: `${barcodeWidth}mm`, height: `${size.h * 0.4}mm` }}
              dangerouslySetInnerHTML={{
                __html: code128Svg(l.code, {
                  widthMm: barcodeWidth,
                  heightMm: size.h * 0.4,
                }),
              }}
            />
            <div style={{ fontSize: "2.2mm", marginTop: "0.6mm", letterSpacing: "0.2mm" }}>
              {l.code}
            </div>
            {showPrice && (
              <div style={{ fontSize: "2.6mm", fontWeight: 600, marginTop: "0.4mm" }}>
                {l.price.toLocaleString()} MMK
              </div>
            )}
          </div>
        ))}
      </div>

      {toast && (
        <div className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

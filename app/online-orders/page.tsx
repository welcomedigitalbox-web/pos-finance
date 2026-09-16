"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/auth-context";

type Order = {
  id: string; order_no: number; order_date: string; customer_name: string | null;
  phone: string | null; city: string | null; delivery_address: string | null;
  shop_id: string | null; sales_person_id: string | null; sales_person_name: string | null;
  subtotal: number | null; discount: number | null; discount_type: string | null;
  discount_value: number | null; delivery_fee: number | null; grand_total: number | null;
  amount_received: number | null; payment_status: string | null; payment_method: string | null;
  payment_ref: string | null; delivery_status: string | null; status: string | null;
  payment_slips: string[] | null; note: string | null;
};
type Item = { id?: string; barcode: string | null; description: string | null; unit_price: number; qty: number; line_total?: number };
type Pay = { id: string; order_id: string; amount: number | null; channel_name: string | null; ref: string | null; slips: string[] | null; paid_at: string | null; actor_name: string | null; note: string | null };
type Edit = { id: number; field: string; old_value: unknown; new_value: unknown; edited_by: string | null; edited_at: string };
type Named = { id: string; name: string };

const fmt = (n: unknown) => Number(n || 0).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);
const ago = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const TONE: Record<string, string> = {
  paid: "bg-green-50 text-green-700", partial: "bg-amber-50 text-amber-700",
  unpaid: "bg-slate-100 text-slate-500", refunded: "bg-red-50 text-red-700",
};

export default function OnlineOrdersPage() {
  const { profile, loading: authLoading } = useAuth();
  const [from, setFrom] = useState(ago(7));
  const [to, setTo] = useState(today());
  const [shop, setShop] = useState(""); const [rep, setRep] = useState("");
  const [status, setStatus] = useState(""); const [q, setQ] = useState("");
  const [rows, setRows] = useState<Order[]>([]);
  const [shops, setShops] = useState<Named[]>([]);
  const [reps, setReps] = useState<Named[]>([]);
  const [chans, setChans] = useState<Named[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState<Order | null>(null);
  const [form, setForm] = useState<Partial<Order>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newPay, setNewPay] = useState({ amount: "", channel_name: "", ref: "", paid_at: today(), note: "" });

  useEffect(() => { if (profile) load(); }, [profile?.id, from, to]); // eslint-disable-line

  async function load() {
    setLoading(true);
    const [{ data: o }, { data: s }, { data: r }, { data: c }] = await Promise.all([
      supabase.from("msgr_orders").select("*").gte("order_date", from).lte("order_date", to)
        .order("order_no", { ascending: false }).limit(500),
      supabase.from("msgr_shops").select("id,name").order("sort_order"),
      supabase.from("msgr_sales_people").select("id,name").eq("is_active", true).order("sort_order"),
      supabase.from("msgr_payment_channels").select("id,name").order("name"),
    ]);
    setRows((o as Order[]) || []); setShops((s as Named[]) || []);
    setReps((r as Named[]) || []); setChans((c as Named[]) || []);
    setLoading(false);
  }

  async function openOrder(o: Order) {
    setOpen(o); setForm(o); setMsg("");
    const [{ data: it }, { data: p }, { data: e }] = await Promise.all([
      supabase.from("msgr_order_items").select("*").eq("order_id", o.id).order("sort_order"),
      supabase.from("msgr_order_payments").select("*").eq("order_id", o.id).order("paid_at", { ascending: false }),
      supabase.from("fin_order_edits").select("*").eq("order_id", o.id).order("id", { ascending: false }).limit(50),
    ]);
    setItems(((it as Item[]) || []).map((x) => ({ ...x, unit_price: Number(x.unit_price), qty: Number(x.qty) })));
    setPays((p as Pay[]) || []); setEdits((e as Edit[]) || []);
    setNewPay({ amount: "", channel_name: "", ref: "", paid_at: today(), note: "" });
  }

  const calc = useMemo(() => {
    const sub = items.reduce((a, i) => a + Number(i.unit_price || 0) * Number(i.qty || 0), 0);
    const dv = Number(form.discount_value || 0);
    const disc = form.discount_type === "percent" ? (sub * dv) / 100 : dv;
    return { sub, disc, total: Math.max(0, sub - disc + Number(form.delivery_fee || 0)) };
  }, [items, form.discount_type, form.discount_value, form.delivery_fee]);

  async function save() {
    if (!open) return;
    setBusy(true); setMsg("");
    const payload: Record<string, unknown> = {};
    for (const k of ["customer_name","phone","city","delivery_address","shop_id","order_date",
      "sales_person_id","sales_person_name","payment_method","payment_status","payment_ref",
      "delivery_status","delivery_fee","discount_type","discount_value","note","status"] as const) {
      if (form[k] !== undefined && form[k] !== (open as Record<string, unknown>)[k]) payload[k] = form[k];
    }
    const { data, error } = await supabase.rpc("fin_save_order", {
      p_order_id: open.id, p_order: payload,
      p_items: items.map((i) => ({ barcode: i.barcode, description: i.description, unit_price: i.unit_price, qty: i.qty })),
    });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setMsg(`သိမ်းပြီးပါပြီ · စုစုပေါင်း ${fmt((data as { grand_total: number })?.grand_total)}`);
    await load(); const fresh = (await supabase.from("msgr_orders").select("*").eq("id", open.id).single()).data;
    if (fresh) await openOrder(fresh as Order);
  }

  async function addPay() {
    if (!open || !newPay.amount) return;
    setBusy(true);
    const { error } = await supabase.from("msgr_order_payments").insert({
      order_id: open.id, amount: Number(newPay.amount), channel_name: newPay.channel_name || null,
      ref: newPay.ref || null, paid_at: newPay.paid_at, note: newPay.note || null,
      actor_name: profile?.name || profile?.email, slips: [],
    });
    if (!error) {
      const total = pays.reduce((a, p) => a + Number(p.amount || 0), 0) + Number(newPay.amount);
      await supabase.from("msgr_orders").update({
        amount_received: total,
        payment_status: total >= Number(open.grand_total || 0) ? "paid" : total > 0 ? "partial" : "unpaid",
      }).eq("id", open.id);
      await load();
      const fresh = (await supabase.from("msgr_orders").select("*").eq("id", open.id).single()).data;
      if (fresh) await openOrder(fresh as Order);
    } else setMsg(error.message);
    setBusy(false);
  }

  async function delPay(p: Pay) {
    if (!open || !confirm("ဒီပေးချေမှုကို ဖျက်မလား")) return;
    await supabase.from("msgr_order_payments").delete().eq("id", p.id);
    const total = pays.filter((x) => x.id !== p.id).reduce((a, x) => a + Number(x.amount || 0), 0);
    await supabase.from("msgr_orders").update({
      amount_received: total,
      payment_status: total >= Number(open.grand_total || 0) ? "paid" : total > 0 ? "partial" : "unpaid",
    }).eq("id", open.id);
    await load();
    const fresh = (await supabase.from("msgr_orders").select("*").eq("id", open.id).single()).data;
    if (fresh) await openOrder(fresh as Order);
  }

  const shopName = (id: string | null) => shops.find((s) => s.id === id)?.name || "—";
  const view = rows.filter((r) =>
    (!shop || r.shop_id === shop) && (!rep || r.sales_person_name === rep) &&
    (!status || (r.payment_status || "unpaid") === status) &&
    (!q || `${r.order_no} ${r.customer_name || ""} ${r.phone || ""}`.toLowerCase().includes(q.toLowerCase())));
  const tot = view.reduce((a, r) => ({ g: a.g + Number(r.grand_total || 0), p: a.p + Number(r.amount_received || 0) }), { g: 0, p: 0 });

  if (authLoading || loading) return <div className="pt-16 text-center text-sm text-slate-400">…</div>;
  if (!profile) return null;

  const inp = "border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white";
  const card = "bg-white border border-slate-200 rounded-xl p-4";
  const set = (k: keyof Order, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold mb-1">Online Orders</h1>
      <p className="text-sm text-slate-500 mb-4">EduPage မှ order များ — ပြင်ဆင်မှုတိုင်း မှတ်တမ်းတင်ပါသည်</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} />
        <select value={shop} onChange={(e) => setShop(e.target.value)} className={inp}>
          <option value="">ဆိုင် — အားလုံး</option>
          {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)} className={inp}>
          <option value="">Sale Rep — အားလုံး</option>
          {reps.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>
          <option value="">Payment — အားလုံး</option><option value="paid">Paid</option>
          <option value="partial">Partial</option><option value="unpaid">Unpaid</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="No. / နာမည် / ဖုန်း" className={inp + " flex-1 min-w-40"} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className={card}><div className="text-xs text-slate-500">Order</div><div className="text-lg font-semibold">{view.length}</div></div>
        <div className={card}><div className="text-xs text-slate-500">စုစုပေါင်း</div><div className="text-lg font-semibold">{fmt(tot.g)}</div></div>
        <div className={card}><div className="text-xs text-slate-500">ရရှိပြီး</div><div className="text-lg font-semibold">{fmt(tot.p)}</div>
          {tot.g - tot.p > 0 && <div className="text-xs text-amber-700">ကျန် {fmt(tot.g - tot.p)}</div>}</div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
            <th className="px-3 py-2">No.</th><th className="px-3 py-2">ရက်</th><th className="px-3 py-2">ဆိုင်</th>
            <th className="px-3 py-2">Customer</th><th className="px-3 py-2">Sale Rep</th>
            <th className="px-3 py-2 text-right">စုစုပေါင်း</th><th className="px-3 py-2 text-right">ရရှိပြီး</th>
            <th className="px-3 py-2">Payment</th><th className="px-3 py-2">Slip</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {view.map((r) => (
              <tr key={r.id} onClick={() => openOrder(r)} className="hover:bg-slate-50 cursor-pointer">
                <td className="px-3 py-2 font-medium">{r.order_no}</td>
                <td className="px-3 py-2 text-slate-500">{r.order_date}</td>
                <td className="px-3 py-2">{shopName(r.shop_id)}</td>
                <td className="px-3 py-2">{r.customer_name || "—"}</td>
                <td className="px-3 py-2">{r.sales_person_name || "—"}</td>
                <td className="px-3 py-2 text-right">{fmt(r.grand_total)}</td>
                <td className="px-3 py-2 text-right">{fmt(r.amount_received)}</td>
                <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${TONE[r.payment_status || "unpaid"] || "bg-slate-100"}`}>{r.payment_status || "unpaid"}</span></td>
                <td className="px-3 py-2">{(r.payment_slips || []).length ? `📷 ${(r.payment_slips || []).length}` : "—"}</td>
              </tr>
            ))}
            {view.length === 0 && <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">Order မရှိပါ</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 p-4" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-xl max-w-3xl w-full mx-auto p-5 my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="font-semibold text-lg">Order #{open.order_no}</div>
              <button onClick={() => setOpen(null)} className="text-slate-400 text-xl leading-none">✕</button>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <div><label className="text-xs text-slate-500">ရက်စွဲ</label>
                <input type="date" value={String(form.order_date || "")} onChange={(e) => set("order_date", e.target.value)} className={inp + " w-full"} /></div>
              <div><label className="text-xs text-slate-500">ဆိုင်</label>
                <select value={String(form.shop_id || "")} onChange={(e) => set("shop_id", e.target.value)} className={inp + " w-full"}>
                  {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="text-xs text-slate-500">Sale Rep</label>
                <select value={String(form.sales_person_id || "")}
                  onChange={(e) => { const r = reps.find((x) => x.id === e.target.value);
                    setForm((f) => ({ ...f, sales_person_id: e.target.value, sales_person_name: r?.name || null })); }}
                  className={inp + " w-full"}>
                  <option value="">—</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <div><label className="text-xs text-slate-500">Customer</label>
                <input value={String(form.customer_name || "")} onChange={(e) => set("customer_name", e.target.value)} className={inp + " w-full"} /></div>
              <div><label className="text-xs text-slate-500">ဖုန်း</label>
                <input value={String(form.phone || "")} onChange={(e) => set("phone", e.target.value)} className={inp + " w-full"} /></div>
              <div><label className="text-xs text-slate-500">မြို့</label>
                <input value={String(form.city || "")} onChange={(e) => set("city", e.target.value)} className={inp + " w-full"} /></div>
              <div className="sm:col-span-3"><label className="text-xs text-slate-500">လိပ်စာ</label>
                <input value={String(form.delivery_address || "")} onChange={(e) => set("delivery_address", e.target.value)} className={inp + " w-full"} /></div>
            </div>

            <div className="text-sm font-medium mb-2">ပစ္စည်းများ</div>
            <div className="overflow-x-auto mb-2">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 text-left"><tr>
                  <th className="py-1">Barcode</th><th className="py-1">ပစ္စည်း</th>
                  <th className="py-1 w-24 text-right">ဈေးနှုန်း</th><th className="py-1 w-20 text-right">အရေ</th>
                  <th className="py-1 w-28 text-right">ပေါင်း</th><th className="w-8"></th>
                </tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-1"><input value={it.barcode || ""} onChange={(e) => setItems((v) => v.map((x, j) => j === i ? { ...x, barcode: e.target.value } : x))} className={inp + " w-full"} /></td>
                      <td className="py-1 pr-1"><input value={it.description || ""} onChange={(e) => setItems((v) => v.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} className={inp + " w-full"} /></td>
                      <td className="py-1 pr-1"><input type="number" value={it.unit_price} onChange={(e) => setItems((v) => v.map((x, j) => j === i ? { ...x, unit_price: Number(e.target.value) } : x))} className={inp + " w-full text-right"} /></td>
                      <td className="py-1 pr-1"><input type="number" value={it.qty} onChange={(e) => setItems((v) => v.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} className={inp + " w-full text-right"} /></td>
                      <td className="py-1 text-right">{fmt(Number(it.unit_price || 0) * Number(it.qty || 0))}</td>
                      <td className="py-1 text-right"><button onClick={() => setItems((v) => v.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-600">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setItems((v) => [...v, { barcode: "", description: "", unit_price: 0, qty: 1 }])}
              className="text-sm text-blue-600 mb-4">+ ပစ္စည်း ထည့်မည်</button>

            <div className="grid sm:grid-cols-4 gap-3 mb-4">
              <div><label className="text-xs text-slate-500">Discount</label>
                <div className="flex gap-1">
                  <select value={String(form.discount_type || "amount")} onChange={(e) => set("discount_type", e.target.value)} className={inp}>
                    <option value="amount">ငွေ</option><option value="percent">%</option></select>
                  <input type="number" value={Number(form.discount_value || 0)} onChange={(e) => set("discount_value", Number(e.target.value))} className={inp + " w-full text-right"} /></div></div>
              <div><label className="text-xs text-slate-500">Delivery Fee</label>
                <input type="number" value={Number(form.delivery_fee || 0)} onChange={(e) => set("delivery_fee", Number(e.target.value))} className={inp + " w-full text-right"} /></div>
              <div><label className="text-xs text-slate-500">Delivery Status</label>
                <input value={String(form.delivery_status || "")} onChange={(e) => set("delivery_status", e.target.value)} className={inp + " w-full"} /></div>
              <div><label className="text-xs text-slate-500">Order Status</label>
                <input value={String(form.status || "")} onChange={(e) => set("status", e.target.value)} className={inp + " w-full"} /></div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-sm mb-4">
              <div className="flex justify-between"><span>ပစ္စည်းပေါင်း</span><span>{fmt(calc.sub)}</span></div>
              <div className="flex justify-between"><span>Discount</span><span>− {fmt(calc.disc)}</span></div>
              <div className="flex justify-between"><span>Delivery</span><span>+ {fmt(form.delivery_fee)}</span></div>
              <div className="flex justify-between font-semibold border-t border-slate-200 mt-1 pt-1">
                <span>စုစုပေါင်း</span><span>{fmt(calc.total)}</span></div>
              <div className="flex justify-between text-slate-500"><span>ရရှိပြီး</span><span>{fmt(open.amount_received)}</span></div>
            </div>

            {(open.payment_slips || []).length > 0 && (
              <div className="mb-4">
                <div className="text-sm font-medium mb-2">Payment Slip</div>
                <div className="flex flex-wrap gap-2">
                  {(open.payment_slips || []).map((u, i) => (
                    <img key={i} src={u} alt="" onClick={() => setPhoto(u)} className="h-24 w-24 object-cover rounded-lg border border-slate-200 cursor-zoom-in" />))}
                </div>
              </div>
            )}

            <div className="text-sm font-medium mb-2">ပေးချေမှု မှတ်တမ်း</div>
            {pays.map((p) => (
              <div key={p.id} className="border-t border-slate-100 py-2 text-sm">
                <div className="flex justify-between items-start">
                  <span>{p.paid_at} · {p.channel_name || "—"}{p.ref ? ` · ${p.ref}` : ""}</span>
                  <span className="flex items-center gap-3"><span className="font-medium">{fmt(p.amount)}</span>
                    <button onClick={() => delPay(p)} className="text-slate-300 hover:text-red-600">✕</button></span>
                </div>
                <div className="text-xs text-slate-400">{p.actor_name || "—"}{p.note ? ` · ${p.note}` : ""}</div>
                {(p.slips || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(p.slips || []).map((u, i) => (
                      <img key={i} src={u} alt="" onClick={() => setPhoto(u)} className="h-20 w-20 object-cover rounded-lg border border-slate-200 cursor-zoom-in" />))}
                  </div>)}
              </div>
            ))}
            <div className="grid sm:grid-cols-5 gap-2 mt-2 mb-4">
              <input type="number" placeholder="ပမာဏ" value={newPay.amount} onChange={(e) => setNewPay({ ...newPay, amount: e.target.value })} className={inp} />
              <select value={newPay.channel_name} onChange={(e) => setNewPay({ ...newPay, channel_name: e.target.value })} className={inp}>
                <option value="">Channel</option>
                {chans.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
              <input placeholder="Ref" value={newPay.ref} onChange={(e) => setNewPay({ ...newPay, ref: e.target.value })} className={inp} />
              <input type="date" value={newPay.paid_at} onChange={(e) => setNewPay({ ...newPay, paid_at: e.target.value })} className={inp} />
              <button onClick={addPay} disabled={busy || !newPay.amount} className="bg-slate-800 text-white rounded-lg px-3 text-sm disabled:opacity-50">ထည့်မည်</button>
            </div>

            {edits.length > 0 && (
              <details className="mb-4">
                <summary className="text-sm font-medium cursor-pointer">ပြင်ဆင်မှတ်တမ်း ({edits.length})</summary>
                <div className="mt-2 max-h-48 overflow-y-auto">
                  {edits.map((e) => (
                    <div key={e.id} className="text-xs border-b border-slate-100 py-1">
                      <span className="font-medium">{e.field}</span>
                      <span className="text-slate-400"> · {e.edited_by} · {new Date(e.edited_at).toLocaleString()}</span>
                      <div><span className="text-red-600 line-through">{JSON.stringify(e.old_value)}</span>
                        <span className="text-slate-400"> → </span>
                        <span className="text-green-700">{JSON.stringify(e.new_value)}</span></div>
                    </div>))}
                </div>
              </details>
            )}

            {msg && <p className={`text-sm mb-2 ${msg.includes("သိမ်း") ? "text-green-700" : "text-red-600"}`}>{msg}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="bg-blue-600 text-white rounded-lg px-5 py-2 text-sm disabled:opacity-50">သိမ်းမည်</button>
              <button onClick={() => setOpen(null)} className="border border-slate-200 rounded-lg px-4 py-2 text-sm">ပိတ်မည်</button>
            </div>
          </div>
        </div>
      )}

      {photo && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setPhoto(null)}>
          <img src={photo} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

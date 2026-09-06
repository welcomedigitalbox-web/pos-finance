-- =====================================================================
-- 20260907000002: Payment-method accounts, and pulling purchase orders
-- Repo path: supabase/migrations/20260907000002_method_accounts_and_po_pull.sql
--
-- Two things the first migration left too blunt:
--
--   1. Every non-cash sale landed in one "Bank" account, so KBZPay and
--      Wave money could not be reconciled against their own statements.
--      Payment methods now map to accounts, one row per method.
--
--   2. Merchandising raises purchase orders in the POS, but finance had
--      no sight of them - a payable only existed if someone retyped it.
--      fin_pull_purchase_orders() brings them across the same way sales
--      come across, once each, with the payments already recorded
--      against them.
--
-- Idempotent - safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Wallet accounts
--
-- Flagged as bank accounts so they show up in the bank book, in cash and
-- bank balances, and in every "which account did the money land in"
-- selector without further wiring.
-- ---------------------------------------------------------------------
insert into public.fin_accounts (code, name, name_my, type, is_bank, sort_order)
values
  ('1110','KBZPay',      'ကေဘီဇက် ပေး',  'asset', true, 21),
  ('1120','Wave Money',  'ဝေ့ဗ် မန်နီ',    'asset', true, 22),
  ('1130','Card / POS Terminal','ကတ် စက်','asset', true, 23)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Which account a payment method settles into
--
-- Keyed on the method string the POS actually writes (sales.payment_method,
-- po_payments.method), lower-cased. A method with no row here falls back to
-- the store's cash account when it is a cash-like method, and to the default
-- bank account otherwise - so a new method in the POS never breaks a pull,
-- it just lands somewhere obvious until someone maps it.
-- ---------------------------------------------------------------------
create table if not exists public.fin_method_accounts (
  method_code text primary key,
  account_id  uuid not null references public.fin_accounts(id) on delete restrict,
  label       text,
  updated_at  timestamptz not null default now()
);

alter table public.fin_method_accounts enable row level security;

drop policy if exists "read fin_method_accounts" on public.fin_method_accounts;
create policy "read fin_method_accounts" on public.fin_method_accounts
  for select to authenticated using (public.is_finance());

drop policy if exists "admin write fin_method_accounts" on public.fin_method_accounts;
create policy "admin write fin_method_accounts" on public.fin_method_accounts
  for all to authenticated using (public.fin_is_admin()) with check (public.fin_is_admin());

grant select, insert, update, delete on public.fin_method_accounts to authenticated;

insert into public.fin_method_accounts (method_code, account_id, label)
select m.code, a.id, m.label
from (values
  ('kpay',       '1110', 'KBZPay'),
  ('kbzpay',     '1110', 'KBZPay'),
  ('kbz_pay',    '1110', 'KBZPay'),
  ('wave',       '1120', 'Wave Money'),
  ('wavepay',    '1120', 'Wave Money'),
  ('wave_money', '1120', 'Wave Money'),
  ('card',       '1130', 'Card / POS terminal'),
  ('visa',       '1130', 'Card / POS terminal'),
  ('master',     '1130', 'Card / POS terminal'),
  ('bank',       '1100', 'Bank transfer'),
  ('transfer',   '1100', 'Bank transfer'),
  ('banktransfer','1100','Bank transfer')
) as m(code, account_code, label)
join public.fin_accounts a on a.code = m.account_code
on conflict (method_code) do nothing;

-- Cash-like methods deliberately have no row: they follow the store's own
-- cash account, which differs per branch.
create or replace function public.fin_method_account(p_method text, p_store_id text default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select account_id from public.fin_method_accounts
      where method_code = lower(trim(coalesce(p_method, '')))),
    case
      when lower(trim(coalesce(p_method, 'cash'))) in ('', 'cash', 'cod', 'cash_on_delivery')
        then public.fin_store_cash_account(p_store_id)
      else public.fin_setting_account('bank_account')
    end);
$$;

revoke all on function public.fin_method_account(text, text) from public, anon;
grant execute on function public.fin_method_account(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Sale pull now routes by method rather than cash-or-everything-else
-- ---------------------------------------------------------------------
create or replace function public.fin_pull_pos_sales(
  p_store text,
  p_from  date,
  p_to    date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  v_count integer := 0;
  v_channel text;
  v_paid numeric;
  v_account_code text;
begin
  if not public.fin_can_write(p_store) then
    raise exception 'Not allowed to write finance rows for store %', p_store;
  end if;

  -- The table is aliased: without it, "s.id" in the sub-select binds to the
  -- loop's own record variable, which has no value yet when the query is
  -- planned, and the whole pull fails with "record s is not assigned yet".
  for s in
    select * from public.sales sa
    where sa.store_id = p_store
      and sa.created_at::date between p_from and p_to
      and sa.order_status <> 'cancelled'
      and not exists (
        select 1 from public.fin_vouchers v
        where v.source_type = 'pos_sale' and v.source_id = sa.id)
  loop
    v_channel := case
      when s.order_type = 'wholesale' then 'wholesale'
      when s.order_type in ('online','delivery') then 'online'
      when s.sale_rep_id is not null then 'salesman'
      else 'showroom' end;

    v_paid := greatest(coalesce(s.total, 0) - coalesce(s.balance_due, 0), 0);
    select code into v_account_code from public.fin_accounts
     where id = public.fin_method_account(s.payment_method, s.store_id);

    perform public.fin_save_voucher(jsonb_build_object(
      'kind', 'sale',
      'voucher_date', s.created_at::date::text,
      'store_id', s.store_id,
      'channel', v_channel,
      'sale_rep_id', s.sale_rep_id,
      'sale_rep_name', s.sale_rep_name,
      'party_type', case when s.customer_id is not null then 'customer' else 'other' end,
      'party_id', s.customer_id,
      'party_name', coalesce(s.customer_name, 'Walk-in'),
      'trade_discount', coalesce(s.discount_amount, 0),
      'tax_percent', coalesce(s.vat_percent, 0),
      'source_type', 'pos_sale',
      'source_id', s.id,
      'note', 'POS ' || coalesce(s.sale_ref, ''),
      'items', jsonb_build_array(jsonb_build_object(
        'description', 'POS sale ' || coalesce(s.sale_ref, ''),
        'qty', 1,
        'unit_price', coalesce(s.subtotal, s.total),
        'account_code', case v_channel
          when 'wholesale' then '4010'
          when 'online'    then '4020'
          else '4000' end
      )),
      'payment', case when v_paid > 0 then jsonb_build_object(
        'amount', v_paid,
        'method', s.payment_method,
        'account_code', v_account_code
      ) else null end
    ));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.fin_pull_pos_sales(text, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Pull purchase orders into payables
--
-- A purchase order becomes a bill once the goods arrive, so only POs that
-- are received or partially received are pulled by default; pass
-- p_include_ordered to bring in orders that have been placed but not yet
-- delivered (for a business that books the liability on order).
--
-- The amount owed follows what was actually received where that is
-- recorded, otherwise the ordered quantity. Payments already entered in
-- the POS come across with the bill, and a later payment on a PO already
-- pulled is added on the next run - each po_payments row is mirrored once,
-- tracked by its id in fin_payments.reference.
--
-- purchase_orders carries no branch, so the caller says which set of books
-- the purchase belongs to.
-- ---------------------------------------------------------------------
create or replace function public.fin_pull_purchase_orders(
  p_store text,
  p_from  date,
  p_to    date,
  p_include_ordered boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  po        record;
  pay       record;
  v_items   jsonb;
  v_voucher uuid;
  v_vouchers integer := 0;
  v_payments integer := 0;
  v_supplier text;
  v_code    text;
begin
  if not public.fin_can_write(p_store) then
    raise exception 'Not allowed to write finance rows for store %', p_store;
  end if;

  for po in
    select o.*, s.name as supplier_name
    from public.purchase_orders o
    left join public.suppliers s on s.id = o.supplier_id
    where o.order_date between p_from and p_to
      and (
        o.status in ('received','partial')
        or (p_include_ordered and o.status = 'ordered')
      )
      and not exists (
        select 1 from public.fin_vouchers v
        where v.source_type = 'pos_po' and v.source_id = o.id)
  loop
    v_supplier := coalesce(po.supplier_name, 'Unknown supplier');

    -- One voucher line per ordered product, valued at its cost. Lines with
    -- nothing received and nothing ordered are skipped rather than posted
    -- as zeroes.
    select jsonb_agg(jsonb_build_object(
             'description', coalesce(pr.name, 'Item'),
             'product_id', i.product_id,
             'qty', i.billed_qty,
             'unit_price', i.unit_cost,
             'account_code', '5100'))
      into v_items
    from (
      select poi.product_id,
             poi.unit_cost,
             case
               when po.status = 'ordered' then poi.qty
               when coalesce(poi.received_qty, 0) > 0 then poi.received_qty
               else poi.qty
             end as billed_qty
      from public.purchase_order_items poi
      where poi.po_id = po.id
    ) i
    left join public.products pr on pr.id = i.product_id
    where i.billed_qty > 0;

    if v_items is null then
      continue;
    end if;

    v_voucher := public.fin_save_voucher(jsonb_build_object(
      'kind', 'purchase',
      'voucher_date', po.order_date::text,
      'due_date', po.expected_date::text,
      'store_id', p_store,
      'party_type', 'supplier',
      'party_id', po.supplier_id,
      'party_name', v_supplier,
      'source_type', 'pos_po',
      'source_id', po.id,
      'note', 'PO ' || coalesce(po.po_number, '') ||
              case when po.payment_term is not null
                   then ' · ' || po.payment_term else '' end,
      'items', v_items
    ));

    v_vouchers := v_vouchers + 1;
  end loop;

  -- Payments, including ones made against a PO pulled on an earlier run.
  for pay in
    select pp.*, v.id as voucher_id, v.party_id, v.party_name, v.store_id
    from public.po_payments pp
    join public.fin_vouchers v
      on v.source_type = 'pos_po' and v.source_id = pp.po_id
    where v.store_id = p_store
      and not exists (
        select 1 from public.fin_payments fp
        where fp.reference = 'po_payment:' || pp.id::text)
  loop
    select code into v_code from public.fin_accounts
     where id = public.fin_method_account(pay.method, pay.store_id);

    perform public.fin_record_payment(jsonb_build_object(
      'payment_date', pay.paid_at::text,
      'direction', 'out',
      'store_id', pay.store_id,
      'account_code', v_code,
      'method', pay.method,
      'party_type', 'supplier',
      'party_id', pay.party_id,
      'party_name', pay.party_name,
      'amount', pay.amount,
      'reference', 'po_payment:' || pay.id::text,
      'note', pay.note,
      'allocations', jsonb_build_array(jsonb_build_object(
        'voucher_id', pay.voucher_id, 'amount', pay.amount))
    ));

    v_payments := v_payments + 1;
  end loop;

  return jsonb_build_object('vouchers', v_vouchers, 'payments', v_payments);
end;
$$;

grant execute on function public.fin_pull_purchase_orders(text, date, date, boolean) to authenticated;

-- The pull reads these two POS tables, so a finance login needs to see them.
drop policy if exists "finance read purchase_orders" on public.purchase_orders;
create policy "finance read purchase_orders" on public.purchase_orders
  for select to authenticated using (public.is_finance());

drop policy if exists "finance read purchase_order_items" on public.purchase_order_items;
create policy "finance read purchase_order_items" on public.purchase_order_items
  for select to authenticated using (public.is_finance());

drop policy if exists "finance read po_payments" on public.po_payments;
create policy "finance read po_payments" on public.po_payments
  for select to authenticated using (public.is_finance());

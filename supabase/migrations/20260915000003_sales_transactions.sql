-- =====================================================================
-- 20260915000003: One sales list across every counter
-- Repo path: supabase/migrations/20260915000003_sales_transactions.sql
--
-- Sales arrive from two places - the till and the Messenger CRM - and
-- finance had no single list of them. The ledger knows what is owed but
-- not how the sale was taken, whether it shipped, or what the customer
-- paid with: that detail lives in `sales` and `msgr_orders`.
--
-- fin_sales_transactions joins the two sides: the ledger's voucher and
-- balance, plus the operational status each source carries. One row per
-- sale, every branch, filterable by date, branch, sale type, payment
-- status, payment method and delivery status.
--
-- fin_sale_receipt() returns one sale in full - header and lines - for
-- the receipt view, reading the line items from whichever source the
-- sale came from.
--
-- Idempotent - safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Finance can read the CRM's order tables
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['msgr_orders','msgr_order_items','msgr_order_payments','msgr_contacts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "finance read %s" on public.%I', t, t);
      execute format(
        'create policy "finance read %s" on public.%I '
        'for select to authenticated using (public.is_finance())', t, t);
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. The list
--
-- payment_status is computed from the money, not copied from either
-- app's own wording, so "paid" means the same thing on both halves of
-- the list. Each source's own status is kept beside it as source_status.
-- ---------------------------------------------------------------------
create or replace view public.fin_sales_transactions as
select
  'pos'::text                         as source,
  s.id                                as source_id,
  coalesce(s.sale_ref, s.id::text)    as reference,
  s.created_at::date                  as sale_date,
  s.created_at                        as sale_at,
  s.store_id,
  case
    when s.order_type = 'wholesale'            then 'wholesale'
    when s.order_type in ('online','delivery') then 'online_retail'
    else 'walk_in'
  end                                 as sale_type,
  coalesce(s.customer_name, 'Walk-in') as customer_name,
  s.customer_id,
  s.payment_method,
  case
    when sp.collected >= coalesce(s.total, 0) then 'paid'
    when sp.collected <= 0                    then 'unpaid'
    else 'partial'
  end                                 as payment_status,
  s.order_status                      as delivery_status,
  s.order_status                      as source_status,
  coalesce(s.total, 0)                as total,
  sp.collected                        as paid_amount,
  greatest(coalesce(s.total, 0) - sp.collected, 0) as balance,
  s.sale_rep_name,
  s.cashier,
  v.voucher_no,
  v.id                                as voucher_id
from public.sales s
left join public.fin_vouchers v
  on v.source_type = 'pos_sale' and v.source_id = s.id
-- Once a sale is in the books, the ledger is what "paid" means - it carries
-- every receipt against the sale, including ones taken after the till was
-- closed. Before it is booked, the till's own figure stands in.
cross join lateral (
  select coalesce(
    v.paid_amount + v.discount_taken,
    greatest(coalesce(s.total, 0) - coalesce(s.balance_due, 0), 0)
  ) as collected
) sp
where s.order_status <> 'cancelled'
  and public.fin_can_read(s.store_id)

union all

select
  'online'::text,
  o.id,
  coalesce('#' || o.order_no::text, o.id::text),
  coalesce(o.order_date, o.created_at::date),
  o.created_at,
  public.fin_shop_store(o.shop_id),
  'online_' || lower(coalesce(nullif(o.sale_type, ''), 'retail')),
  coalesce(nullif(o.customer_name, ''), o.phone, 'Online customer'),
  c.customer_id,
  o.payment_method,
  case
    when p.collected >= coalesce(o.grand_total, 0) then 'paid'
    when p.collected <= 0                          then 'unpaid'
    else 'partial'
  end,
  o.delivery_status,
  o.status,
  coalesce(o.grand_total, 0),
  p.collected,
  greatest(coalesce(o.grand_total, 0) - p.collected, 0),
  o.sales_person_name,
  o.created_by_name,
  v.voucher_no,
  v.id
from public.msgr_orders o
-- What the customer has actually handed over: the deposit recorded on the
-- order, or the payment rows against it, whichever is further along. The
-- CRM updates one or the other depending on how the money arrived.
left join public.msgr_contacts c on c.id = o.contact_id
left join public.fin_vouchers v
  on v.source_type = 'msgr_order' and v.source_id = o.id
cross join lateral (
  select coalesce(
    v.paid_amount + v.discount_taken,
    greatest(
      coalesce(o.amount_received, o.advance_payment, 0),
      coalesce((select sum(mp.amount) from public.msgr_order_payments mp
                 where mp.order_id = o.id), 0))
  ) as collected
) p
where coalesce(o.status, '') not in ('cancelled', 'void')
  and public.fin_can_read(public.fin_shop_store(o.shop_id));

grant select on public.fin_sales_transactions to authenticated;

-- ---------------------------------------------------------------------
-- 3. One sale in full, for the receipt view
--
-- Lines come from whichever app took the sale; the POS keeps a product
-- name per line, the CRM a free-text description, so both are returned
-- under the same keys.
-- ---------------------------------------------------------------------
create or replace function public.fin_sale_receipt(p_source text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_head  jsonb;
  v_lines jsonb;
  v_pays  jsonb;
  v_store text;
begin
  if p_source = 'pos' then
    select to_jsonb(t) into v_head
      from (select * from public.fin_sales_transactions
             where source = 'pos' and source_id = p_id) t;
    if v_head is null then return null; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'description', i.product_name,
             'qty', i.qty,
             'unit_price', i.unit_price,
             'line_total', i.line_total) order by i.created_at), '[]'::jsonb)
      into v_lines
    from public.sale_items i where i.sale_id = p_id;

    select to_jsonb(x) into v_pays from (
      select s.payment_method, s.amount_received, s.change_amount,
             s.advance_payment, s.balance_due, s.discount_amount,
             s.vat_amount, s.subtotal, s.note, s.delivery_address
      from public.sales s where s.id = p_id) x;

  elsif p_source = 'online' then
    select to_jsonb(t) into v_head
      from (select * from public.fin_sales_transactions
             where source = 'online' and source_id = p_id) t;
    if v_head is null then return null; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'description', coalesce(nullif(i.description, ''), i.barcode),
             'qty', i.qty,
             'unit_price', i.unit_price,
             'line_total', i.line_total) order by i.sort_order), '[]'::jsonb)
      into v_lines
    from public.msgr_order_items i where i.order_id = p_id;

    select to_jsonb(x) into v_pays from (
      select o.payment_method, o.amount_received, o.advance_payment,
             o.delivery_fee, o.discount, o.subtotal, o.note,
             o.delivery_address, o.city, o.phone, o.delivery_method,
             o.order_channel_name,
             (select coalesce(jsonb_agg(jsonb_build_object(
                'amount', p.amount, 'channel', p.channel_name,
                'paid_at', p.paid_at, 'ref', p.ref) order by p.paid_at), '[]'::jsonb)
              from public.msgr_order_payments p where p.order_id = o.id) as payments
      from public.msgr_orders o where o.id = p_id) x;
  else
    return null;
  end if;

  v_store := v_head->>'store_id';
  if not public.fin_can_read(v_store) then
    return null;
  end if;

  return v_head || jsonb_build_object('lines', v_lines, 'detail', v_pays);
end;
$$;

grant execute on function public.fin_sale_receipt(text, uuid) to authenticated;

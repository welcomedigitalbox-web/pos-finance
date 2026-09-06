-- =====================================================================
-- 20260907000003: Pull everything, in batches
-- Repo path: supabase/migrations/20260907000003_pull_all.sql
--
-- Both pulls demanded a date range, so the first run after go-live -
-- when the whole back catalogue needs to come across - meant guessing
-- dates until nothing new appeared. The range is now optional: null on
-- either side means unbounded.
--
-- Pulling everything at once can outlast the API's statement timeout on
-- a busy shop, so each call stops after p_limit records and reports how
-- many it took. The screen presses again until a run comes back short,
-- which is also what makes the operation safe to repeat.
--
-- Idempotent - safe to re-run.
-- =====================================================================

create or replace function public.fin_pull_pos_sales(
  p_store text,
  p_from  date default null,
  p_to    date default null,
  p_limit integer default 500
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

  for s in
    select * from public.sales sa
    where sa.store_id = p_store
      and (p_from is null or sa.created_at::date >= p_from)
      and (p_to   is null or sa.created_at::date <= p_to)
      and sa.order_status <> 'cancelled'
      and not exists (
        select 1 from public.fin_vouchers v
        where v.source_type = 'pos_sale' and v.source_id = sa.id)
    order by sa.created_at
    limit greatest(coalesce(p_limit, 500), 1)
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

create or replace function public.fin_pull_purchase_orders(
  p_store text,
  p_from  date default null,
  p_to    date default null,
  p_include_ordered boolean default false,
  p_limit integer default 500
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
    where (p_from is null or o.order_date >= p_from)
      and (p_to   is null or o.order_date <= p_to)
      and (
        o.status in ('received','partial')
        or (p_include_ordered and o.status = 'ordered')
      )
      and not exists (
        select 1 from public.fin_vouchers v
        where v.source_type = 'pos_po' and v.source_id = o.id)
    order by o.order_date
    limit greatest(coalesce(p_limit, 500), 1)
  loop
    v_supplier := coalesce(po.supplier_name, 'Unknown supplier');

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

    perform public.fin_save_voucher(jsonb_build_object(
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

  for pay in
    select pp.*, v.id as voucher_id, v.party_id, v.party_name, v.store_id
    from public.po_payments pp
    join public.fin_vouchers v
      on v.source_type = 'pos_po' and v.source_id = pp.po_id
    where v.store_id = p_store
      and not exists (
        select 1 from public.fin_payments fp
        where fp.reference = 'po_payment:' || pp.id::text)
    order by pp.paid_at
    limit greatest(coalesce(p_limit, 500), 1)
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

grant execute on function public.fin_pull_pos_sales(text, date, date, integer) to authenticated;
grant execute on function public.fin_pull_purchase_orders(text, date, date, boolean, integer) to authenticated;

-- The three-argument sale pull is replaced by the four-argument one; drop
-- the old signature so PostgREST does not have two to choose between.
drop function if exists public.fin_pull_pos_sales(text, date, date);
drop function if exists public.fin_pull_purchase_orders(text, date, date, boolean);

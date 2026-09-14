-- =====================================================================
-- 20260914000002: Mirror POS finance staff into fin_users
-- Repo path: supabase/migrations/20260914000002_sync_finance_staff.sql
--
-- Access already derives from the POS profile at the policy level, but
-- the deployed app still reads fin_users to decide what to show. Keeping
-- that table filled from the POS staff list means the finance department
-- signs in with the accounts they already have, nobody is created twice,
-- and no code has to change for it.
--
--   admin, owner            -> fin_admin,   every branch
--   finance_manager         -> fin_manager, every branch
--   accountant              -> accountant,  their own branches
--   department = 'finance'  -> accountant,  their own branches
--
-- A person who leaves the finance department is deactivated here rather
-- than deleted, so their history and any explicit page list survive. A
-- row an administrator set by hand is not overwritten: the sync only
-- touches rows it created itself (created_by = 'pos_sync').
--
-- Idempotent - safe to re-run.
-- =====================================================================

create or replace function public.fin_sync_one_profile(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p          public.profiles%rowtype;
  v_role     text;
  v_all      boolean;
  v_existing public.fin_users%rowtype;
begin
  select * into p from public.profiles where id = p_id;
  if not found then return; end if;

  v_role := case
    when p.role in ('admin', 'owner')  then 'fin_admin'
    when p.role = 'finance_manager'    then 'fin_manager'
    when p.role = 'accountant'         then 'accountant'
    when p.department = 'finance'      then 'accountant'
    else null
  end;

  v_all := v_role in ('fin_admin', 'fin_manager');

  select * into v_existing from public.fin_users where id = p_id;

  -- Never touch a row an administrator created or edited by hand.
  if found and coalesce(v_existing.created_by, '') <> 'pos_sync' then
    return;
  end if;

  if v_role is null then
    -- Left the finance department: keep the row, close the door.
    if found then
      update public.fin_users set is_active = false where id = p_id;
    end if;
    return;
  end if;

  insert into public.fin_users (id, email, name, role, all_stores, is_active, created_by, note)
  values (p_id, coalesce(p.email, p_id::text), p.email, v_role, v_all, true, 'pos_sync',
          'Synced from the POS staff list')
  on conflict (id) do update
    set email      = excluded.email,
        name       = coalesce(public.fin_users.name, excluded.name),
        role       = excluded.role,
        all_stores = excluded.all_stores,
        is_active  = true;

  -- Branch scope follows the POS profile for anyone who does not cover
  -- every branch anyway.
  delete from public.fin_user_stores where user_id = p_id;
  if not v_all then
    insert into public.fin_user_stores (user_id, store_id)
    select p_id, us.store_id from public.user_stores us where us.user_id = p_id
    union
    select p_id, p.store_id where p.store_id is not null
    on conflict do nothing;
  end if;
end;
$$;

-- Keep it in step: a new hire, a role change or a department move in POS
-- admin lands here on save.
create or replace function public.fin_profiles_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fin_sync_one_profile(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_fin_sync on public.profiles;
create trigger profiles_fin_sync
  after insert or update of role, department, store_id, email on public.profiles
  for each row execute function public.fin_profiles_sync_trigger();

-- The same for the branch list, which lives in its own table.
create or replace function public.fin_user_stores_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fin_sync_one_profile(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists user_stores_fin_sync on public.user_stores;
create trigger user_stores_fin_sync
  after insert or delete on public.user_stores
  for each row execute function public.fin_user_stores_sync_trigger();

-- Backfill everyone currently on the POS staff list.
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    perform public.fin_sync_one_profile(r.id);
  end loop;
end $$;

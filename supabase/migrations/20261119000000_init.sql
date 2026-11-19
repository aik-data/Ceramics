-- Ceramics Fundraiser — initial schema
-- Families sign in with one shared Supabase Auth user (settings.family_email).
-- Admins are Supabase Auth users listed in public.admins.
-- Families never read tables directly; they use the security-definer RPCs below.

create extension if not exists pgcrypto;

-- ───────────────────────── Tables ─────────────────────────

create table public.settings (
  id               int primary key default 1 check (id = 1),
  fundraiser_name  text not null default 'Student Ceramics Sale',
  school_name      text not null default 'Our School',
  intro            text not null default 'Every piece was handmade by a student artist. All proceeds support our art program.',
  goal_cents       int  not null default 250000 check (goal_cents >= 0),
  sale_opens_at    timestamptz,
  sale_closes_at   timestamptz,
  checkout_paused  boolean not null default false,
  overdue_hours    int  not null default 48 check (overdue_hours > 0),
  donate_url       text not null default 'https://www.futurefund.com/',
  notify_emails    text[] not null default '{}',
  expenses_cents   int  not null default 0 check (expenses_cents >= 0),
  family_email     text not null default 'family@ceramics-fundraiser.invalid',
  timezone         text not null default 'America/Los_Angeles',
  updated_at       timestamptz not null default now()
);
insert into public.settings (id) values (1);

create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create table public.pickup_options (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  pickup_date date,
  start_time time,
  end_time   time,
  location   text,
  note       text,
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table public.pieces (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  artist          text not null default '',
  description     text not null default '',
  category        text not null default '',
  suggested_cents int  not null check (suggested_cents >= 0),
  quantity        int  not null default 1 check (quantity >= 0),
  photos          text[] not null default '{}',
  hidden          boolean not null default false,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create sequence public.order_no_seq start 1001;

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  order_no              text not null unique default ('CER-' || nextval('public.order_no_seq')),
  created_at            timestamptz not null default now(),
  parent_name           text not null,
  email                 text not null,
  phone                 text not null default '',
  student_name          text not null,
  student_class         text not null,
  pickup_option_id      uuid references public.pickup_options(id) on delete set null,
  pickup_label          text not null default '',
  notes                 text not null default '',
  status                text not null default 'new'
                         check (status in ('new','invoice_sent','paid','released')),
  seen_at               timestamptz,
  invoice_sent_at       timestamptz,
  paid_at               timestamptz,
  amount_received_cents int,
  released_at           timestamptz,
  notified_at           timestamptz
);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  piece_id        uuid not null references public.pieces(id),
  qty             int  not null check (qty > 0),
  suggested_cents int  not null,
  title           text not null,
  artist          text not null,
  released        boolean not null default false
);
create index on public.order_items (piece_id);
create index on public.order_items (order_id);

create table public.donations (
  id           uuid primary key default gen_random_uuid(),
  amount_cents int  not null check (amount_cents > 0),
  donated_on   date not null default current_date,
  name         text not null default '',
  note         text not null default '',
  created_at   timestamptz not null default now()
);

create table public.activity (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  admin_email text,
  order_id    uuid references public.orders(id) on delete cascade,
  action      text not null,
  detail      text not null default ''
);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or coalesce(lower(auth.jwt() ->> 'email'), '') = (select lower(family_email) from public.settings where id = 1);
$$;

create or replace function public.sale_state() returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.sale_opens_at is not null and now() < s.sale_opens_at then 'upcoming'
    when s.sale_closes_at is not null and now() >= s.sale_closes_at then 'closed'
    when s.checkout_paused then 'paused'
    else 'open' end
  from public.settings s where s.id = 1;
$$;

-- Availability per piece (held = New / Invoice sent, sold = Paid)
create or replace view public.piece_stock with (security_invoker = true) as
select p.id as piece_id,
       coalesce(sum(oi.qty) filter (where o.status in ('new','invoice_sent')), 0)::int as held,
       coalesce(sum(oi.qty) filter (where o.status = 'paid'), 0)::int as sold,
       (p.quantity - coalesce(sum(oi.qty) filter (where o.status in ('new','invoice_sent','paid')), 0))::int as available
from public.pieces p
left join public.order_items oi on oi.piece_id = p.id and not oi.released
left join public.orders o on o.id = oi.order_id
group by p.id, p.quantity;

create or replace function public.raised_cents() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_received_cents) from public.orders where status = 'paid'), 0)
       + coalesce((select sum(amount_cents) from public.donations), 0);
$$;

-- ───────────────────────── Family RPCs ─────────────────────────

-- Anyone (even signed out) can see the basics needed for the sign-in / coming-soon page.
create or replace function public.get_public_info() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'fundraiser_name', s.fundraiser_name,
    'school_name',     s.school_name,
    'intro',           s.intro,
    'sale_opens_at',   s.sale_opens_at,
    'sale_closes_at',  s.sale_closes_at,
    'sale_state',      public.sale_state(),
    'donate_url',      s.donate_url,
    'timezone',        s.timezone,
    'family_email',    s.family_email
  ) from public.settings s where s.id = 1;
$$;

create or replace function public.get_gallery() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  result json;
begin
  if not public.is_member() then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if public.sale_state() = 'upcoming' and not public.is_admin() then
    raise exception 'SALE_NOT_OPEN';
  end if;

  select json_build_object(
    'goal_cents',   s.goal_cents,
    'raised_cents', public.raised_cents(),
    'pieces', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'title', p.title, 'artist', p.artist, 'description', p.description,
        'category', p.category, 'suggested_cents', p.suggested_cents, 'quantity', p.quantity,
        'photos', p.photos, 'held', st.held, 'sold', st.sold, 'available', greatest(st.available, 0)
      ) order by p.sort, p.created_at)
      from public.pieces p join public.piece_stock st on st.piece_id = p.id
      where not p.hidden), '[]'::json),
    'pickup_options', coalesce((
      select json_agg(json_build_object(
        'id', po.id, 'label', po.label, 'pickup_date', po.pickup_date, 'start_time', po.start_time,
        'end_time', po.end_time, 'location', po.location, 'note', po.note
      ) order by po.sort, po.pickup_date nulls last, po.start_time)
      from public.pickup_options po where po.active), '[]'::json)
  ) into result
  from public.settings s where s.id = 1;

  return result;
end;
$$;

-- Atomic checkout: locks each piece row, checks stock, creates the order.
-- p: { parent_name, email, phone, student_name, student_class, pickup_option_id, notes,
--      items: [{ piece_id, qty }] }
create or replace function public.place_order(p jsonb) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_order   public.orders;
  v_item    record;
  v_piece   public.pieces;
  v_avail   int;
  v_pickup  public.pickup_options;
  v_label   text;
begin
  if not public.is_member() then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if public.sale_state() <> 'open' then
    raise exception 'SALE_NOT_OPEN';
  end if;

  if coalesce(trim(p->>'parent_name'),'') = '' or coalesce(trim(p->>'email'),'') = ''
     or coalesce(trim(p->>'student_name'),'') = '' or coalesce(trim(p->>'student_class'),'') = '' then
    raise exception 'MISSING_FIELDS';
  end if;
  if (p->>'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'BAD_EMAIL';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'EMPTY_CART';
  end if;

  select * into v_pickup from public.pickup_options
   where id = nullif(p->>'pickup_option_id','')::uuid and active;
  if not found then
    raise exception 'BAD_PICKUP';
  end if;
  v_label := v_pickup.label;

  -- 1) Lock pieces in a stable order (avoids deadlocks) and check stock.
  create temp table if not exists _cart (piece_id uuid, qty int, suggested_cents int, title text, artist text) on commit drop;
  delete from _cart;
  for v_item in
    select (i->>'piece_id')::uuid as piece_id, sum((i->>'qty')::int)::int as qty
      from jsonb_array_elements(p->'items') i
     group by 1 order by 1
  loop
    if v_item.qty is null or v_item.qty <= 0 then
      raise exception 'BAD_QTY';
    end if;
    select * into v_piece from public.pieces where id = v_item.piece_id and not hidden for update;
    if not found then
      raise exception 'NOT_AVAILABLE:%', 'a piece';
    end if;
    select available into v_avail from public.piece_stock where piece_id = v_piece.id;
    if v_item.qty > v_avail then
      raise exception 'NOT_AVAILABLE:%', v_piece.title;
    end if;
    insert into _cart values (v_piece.id, v_item.qty, v_piece.suggested_cents, v_piece.title, v_piece.artist);
  end loop;

  -- 2) Create the order (only now, so failed checkouts don't use up order numbers).
  insert into public.orders (parent_name, email, phone, student_name, student_class,
                             pickup_option_id, pickup_label, notes)
  values (trim(p->>'parent_name'), lower(trim(p->>'email')), coalesce(trim(p->>'phone'),''),
          trim(p->>'student_name'), trim(p->>'student_class'), v_pickup.id, v_label,
          left(coalesce(trim(p->>'notes'),''), 1000))
  returning * into v_order;

  insert into public.order_items (order_id, piece_id, qty, suggested_cents, title, artist)
  select v_order.id, piece_id, qty, suggested_cents, title, artist from _cart;

  return json_build_object('order_id', v_order.id, 'order_no', v_order.order_no);
end;
$$;

-- ───────────────────────── Admin RPCs ─────────────────────────

create or replace function public.admin_set_family_password(new_password text) returns void
language plpgsql volatile security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if length(coalesce(new_password,'')) < 6 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where lower(email) = (select lower(family_email) from public.settings where id = 1);
  if not found then raise exception 'FAMILY_USER_MISSING'; end if;
end;
$$;

-- ───────────────────────── Row-level security ─────────────────────────

alter table public.settings       enable row level security;
alter table public.admins         enable row level security;
alter table public.pickup_options enable row level security;
alter table public.pieces         enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.donations      enable row level security;
alter table public.activity       enable row level security;

create policy admin_all on public.settings       for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.admins         for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.pickup_options for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.pieces         for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.orders         for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.order_items    for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.donations      for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.activity       for all using (public.is_admin()) with check (public.is_admin());

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.get_public_info() to anon, authenticated;
grant execute on function public.get_gallery() to authenticated;
grant execute on function public.place_order(jsonb) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.sale_state() to anon, authenticated;
grant execute on function public.raised_cents() to authenticated;
grant execute on function public.admin_set_family_password(text) to authenticated;
grant usage, select on sequence public.order_no_seq to authenticated;

-- ───────────────────────── Photo storage ─────────────────────────

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy photos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());
create policy photos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_admin());
create policy photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

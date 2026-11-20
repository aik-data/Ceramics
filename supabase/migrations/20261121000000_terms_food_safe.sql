-- Reservation terms (families must agree before reserving), food-safe pieces.

alter table public.settings add column if not exists terms text not null default '';
alter table public.pieces   add column if not exists food_safe boolean not null default false;
alter table public.orders   add column if not exists terms_agreed_at timestamptz;

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
    'instructions',    s.instructions,
    'terms',           s.terms,
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
        'photos', p.photos, 'food_safe', p.food_safe,
        'held', st.held, 'sold', st.sold, 'available', greatest(st.available, 0)
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

create or replace function public.place_order(p jsonb) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_order   public.orders;
  v_item    record;
  v_piece   public.pieces;
  v_avail   int;
  v_cart    jsonb := '[]'::jsonb;
begin
  if not public.is_member() then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if public.sale_state() <> 'open' then
    raise exception 'SALE_NOT_OPEN';
  end if;

  if coalesce(trim(p->>'parent_name'),'') = '' or coalesce(trim(p->>'email'),'') = ''
     or coalesce(trim(p->>'phone'),'') = '' then
    raise exception 'MISSING_FIELDS';
  end if;
  if (p->>'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'BAD_EMAIL';
  end if;
  if coalesce(p->>'agreed_terms', 'false') <> 'true' then
    raise exception 'TERMS_REQUIRED';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'EMPTY_CART';
  end if;

  -- 1) Lock pieces in a stable order (avoids deadlocks) and check stock.
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
    v_cart := v_cart || jsonb_build_object('piece_id', v_piece.id, 'qty', v_item.qty,
      'suggested_cents', v_piece.suggested_cents, 'title', v_piece.title, 'artist', v_piece.artist);
  end loop;

  -- 2) Create the reservation (only now, so failed checkouts don't use up numbers).
  insert into public.orders (parent_name, email, phone, notes, terms_agreed_at)
  values (trim(p->>'parent_name'), lower(trim(p->>'email')), trim(p->>'phone'),
          left(coalesce(trim(p->>'notes'),''), 1000), now())
  returning * into v_order;

  insert into public.order_items (order_id, piece_id, qty, suggested_cents, title, artist)
  select v_order.id, c.piece_id, c.qty, c.suggested_cents, c.title, c.artist
    from jsonb_to_recordset(v_cart) as c(piece_id uuid, qty int, suggested_cents int, title text, artist text);

  return json_build_object('order_id', v_order.id, 'order_no', v_order.order_no);
end;
$$;

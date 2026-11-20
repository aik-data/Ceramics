-- Reserve-and-donate flow (Cal High policy):
-- families reserve, then donate the suggested amount through a FutureFund link,
-- keep their receipt, and pick up on one of the pickup days.

-- Editable instructions shown to families and copied into the admin alert.
-- {link} = the FutureFund donation link, {pickup_days} = the active pickup days.
alter table public.settings add column if not exists instructions text not null default
  'Once you have reserved your item, go to this link {link} and donate the suggested amount. Save your receipt — you will need it to pick up your item before or after school on {pickup_days}.';

-- Pickup tracking.
alter table public.orders add column if not exists picked_up_at timestamptz;

-- Student fields are no longer collected.
alter table public.orders alter column student_name set default '';
alter table public.orders alter column student_class set default '';

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
    'timezone',        s.timezone,
    'family_email',    s.family_email
  ) from public.settings s where s.id = 1;
$$;

-- Checkout: name, email, phone (required) and notes. No student or pickup choice.
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
  insert into public.orders (parent_name, email, phone, notes)
  values (trim(p->>'parent_name'), lower(trim(p->>'email')), trim(p->>'phone'),
          left(coalesce(trim(p->>'notes'),''), 1000))
  returning * into v_order;

  insert into public.order_items (order_id, piece_id, qty, suggested_cents, title, artist)
  select v_order.id, c.piece_id, c.qty, c.suggested_cents, c.title, c.artist
    from jsonb_to_recordset(v_cart) as c(piece_id uuid, qty int, suggested_cents int, title text, artist text);

  return json_build_object('order_id', v_order.id, 'order_no', v_order.order_no);
end;
$$;

-- Family confirmation emails + self-service cancellation via a private link.

alter table public.settings add column if not exists email_families boolean not null default false;
alter table public.settings add column if not exists reply_to text not null default '';

alter table public.orders add column if not exists cancel_token uuid not null default gen_random_uuid();
alter table public.orders add column if not exists cancelled_by_family_at timestamptz;
alter table public.orders add column if not exists cancel_notified_at timestamptz;
create unique index if not exists orders_cancel_token_key on public.orders (cancel_token);

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
    'email_families',  s.email_families,
    'contact_email',   s.reply_to,
    'timezone',        s.timezone,
    'family_email',    s.family_email
  ) from public.settings s where s.id = 1;
$$;

-- Return the cancel token with the new reservation so the confirmation page can link to it.
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

  insert into public.orders (parent_name, email, phone, notes, terms_agreed_at)
  values (trim(p->>'parent_name'), lower(trim(p->>'email')), trim(p->>'phone'),
          left(coalesce(trim(p->>'notes'),''), 1000), now())
  returning * into v_order;

  insert into public.order_items (order_id, piece_id, qty, suggested_cents, title, artist)
  select v_order.id, c.piece_id, c.qty, c.suggested_cents, c.title, c.artist
    from jsonb_to_recordset(v_cart) as c(piece_id uuid, qty int, suggested_cents int, title text, artist text);

  return json_build_object('order_id', v_order.id, 'order_no', v_order.order_no, 'cancel_token', v_order.cancel_token);
end;
$$;

-- Look up a reservation from its private cancel link (no sign-in needed; the token is the secret).
-- Returns only what the cancel page needs: first name, pieces, status.
create or replace function public.get_reservation_by_token(t uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'order_no',   o.order_no,
    'first_name', split_part(o.parent_name, ' ', 1),
    'created_at', o.created_at,
    'state', case when o.status = 'released' then 'cancelled'
                  when o.status = 'paid' and o.picked_up_at is not null then 'picked_up'
                  else 'reserved' end,
    'cancelled_by_family', o.cancelled_by_family_at is not null,
    'items', coalesce((select json_agg(json_build_object('title', i.title, 'qty', i.qty, 'suggested_cents', i.suggested_cents))
                       from public.order_items i where i.order_id = o.id and not i.released), '[]'::json),
    'total_cents', coalesce((select sum(i.qty * i.suggested_cents) from public.order_items i where i.order_id = o.id and not i.released), 0)
  ) from public.orders o where o.cancel_token = t;
$$;

-- Cancel from the private link: allowed any time until pickup.
create or replace function public.cancel_reservation(t uuid) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where cancel_token = t for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_order.status = 'released' then raise exception 'ALREADY_CANCELLED'; end if;
  if v_order.status = 'paid' and v_order.picked_up_at is not null then raise exception 'ALREADY_PICKED_UP'; end if;

  update public.order_items set released = true where order_id = v_order.id;
  update public.orders set status = 'released', released_at = now(), cancelled_by_family_at = now()
   where id = v_order.id;
  insert into public.activity (order_id, action, detail, admin_email)
  values (v_order.id, 'Cancelled by family', 'Pieces returned to the sale', null);

  return json_build_object('order_no', v_order.order_no);
end;
$$;

grant execute on function public.get_reservation_by_token(uuid) to anon, authenticated;
grant execute on function public.cancel_reservation(uuid) to anon, authenticated;

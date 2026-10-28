-- Reviews are submitted through a random, single-use sale link. The link
-- confirms a sale exists; it does not verify the respondent's identity.
create table public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  sale_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  customer_name text check (customer_name is null or length(trim(customer_name)) between 1 and 80),
  comment text not null check (length(trim(comment)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (sale_id, shop_id),
  foreign key (sale_id, shop_id) references public.sales(id, shop_id) on delete cascade
);
create index customer_reviews_shop_created on public.customer_reviews (shop_id, created_at desc);
alter table public.customer_reviews enable row level security;
create policy customer_reviews_owner_read on public.customer_reviews for select to authenticated
using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = (select auth.uid())));
revoke all on public.customer_reviews from public, anon, authenticated;
grant select on public.customer_reviews to authenticated;

create table public.review_invites (
  sale_id uuid not null,
  shop_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (sale_id, shop_id),
  foreign key (sale_id, shop_id) references public.sales(id, shop_id) on delete cascade
);
alter table public.review_invites enable row level security;
revoke all on public.review_invites from public, anon, authenticated;

create function public.issue_review_invite(p_shop_id uuid, p_sale_id uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid review token' using errcode = '22023'; end if;
  if not exists (select 1 from public.shops s where s.id = p_shop_id and s.owner_id = (select auth.uid()))
    or not exists (select 1 from public.sales s where s.id = p_sale_id and s.shop_id = p_shop_id) then
    raise exception 'Sale unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from public.customer_reviews r where r.sale_id = p_sale_id and r.shop_id = p_shop_id) then
    raise exception 'This sale already has a review' using errcode = '23505';
  end if;
  insert into public.review_invites (sale_id, shop_id, token_hash, expires_at)
  values (p_sale_id, p_shop_id, p_token_hash, now() + interval '30 days')
  on conflict (sale_id, shop_id) do update set token_hash = excluded.token_hash,
    expires_at = excluded.expires_at, used_at = null, created_at = now();
end;
$$;

create function public.review_invite_details(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shopName', s.name, 'saleDate', sale.created_at)
  from public.review_invites i
  join public.shops s on s.id = i.shop_id
  join public.sales sale on sale.id = i.sale_id and sale.shop_id = i.shop_id
  where i.token_hash = p_token_hash and i.expires_at > now() and i.used_at is null
    and not exists (select 1 from public.customer_reviews r where r.sale_id = i.sale_id and r.shop_id = i.shop_id)
  limit 1;
$$;

create function public.submit_customer_review(p_token_hash text, p_rating integer, p_comment text, p_customer_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invite public.review_invites%rowtype;
  review_id uuid;
begin
  if p_rating not between 1 and 5 or length(trim(coalesce(p_comment, ''))) not between 1 and 1000
    or (p_customer_name is not null and length(trim(p_customer_name)) not between 1 and 80) then
    raise exception 'Invalid review' using errcode = '22023';
  end if;
  select * into invite from public.review_invites
    where token_hash = p_token_hash and expires_at > now() and used_at is null for update;
  if not found then raise exception 'Review link unavailable' using errcode = '22023'; end if;
  insert into public.customer_reviews (shop_id, sale_id, rating, comment, customer_name)
    values (invite.shop_id, invite.sale_id, p_rating, trim(p_comment), nullif(trim(p_customer_name), ''))
    returning id into review_id;
  update public.review_invites set used_at = now() where sale_id = invite.sale_id and shop_id = invite.shop_id;
  return review_id;
end;
$$;

revoke execute on function public.issue_review_invite(uuid, uuid, text) from public, anon;
revoke execute on function public.review_invite_details(text) from public;
revoke execute on function public.submit_customer_review(text, integer, text, text) from public;
grant execute on function public.issue_review_invite(uuid, uuid, text) to authenticated;
grant execute on function public.review_invite_details(text) to anon, authenticated;
grant execute on function public.submit_customer_review(text, integer, text, text) to anon, authenticated;

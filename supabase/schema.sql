-- Lume Fotos: execute uma vez no SQL Editor do projeto Supabase.
begin;
create extension if not exists vector with schema extensions;
create table public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
create policy "Admin reads own permission" on public.admins for select to authenticated using (user_id = auth.uid());
create function public.is_lume_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function public.is_lume_admin() from public;
grant execute on function public.is_lume_admin() to authenticated;
create table public.events(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), slug text unique not null, event_date date not null, published boolean not null default false, created_at timestamptz not null default now());
create table public.photos(id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade, storage_path text unique not null, name text not null, face_count integer not null check(face_count>0), created_at timestamptz not null default now());
create table public.faces(id bigint generated always as identity primary key, photo_id uuid not null references public.photos(id) on delete cascade, event_id uuid not null references public.events(id) on delete cascade, descriptor extensions.vector(128) not null);
create index on public.photos(event_id);
create index on public.faces(event_id);
create index on public.faces(photo_id);
alter table public.events enable row level security;
alter table public.photos enable row level security;
alter table public.faces enable row level security;
create policy "Published events are visible" on public.events for select to anon, authenticated using (published);
create policy "Admins manage events" on public.events for all to authenticated using (public.is_lume_admin()) with check (public.is_lume_admin());
create policy "Admins manage photos" on public.photos for all to authenticated using (public.is_lume_admin()) with check (public.is_lume_admin());
create policy "Admins manage faces" on public.faces for all to authenticated using (public.is_lume_admin()) with check (public.is_lume_admin());
grant select on public.events to anon;
grant select, insert, update, delete on public.events,public.photos,public.faces to authenticated;
grant select on public.admins to authenticated;
grant usage,select on sequence public.faces_id_seq to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('event-photos','event-photos',false,15728640,array['image/jpeg','image/png','image/webp']);
create policy "Admins manage event images" on storage.objects for all to authenticated using(bucket_id='event-photos' and public.is_lume_admin()) with check(bucket_id='event-photos' and public.is_lume_admin());
create function public.match_event_photos(event_slug text, query_descriptor extensions.vector(128)) returns table(id uuid,name text,storage_path text,distance double precision) language sql stable security definer set search_path = public, extensions as $$
 select p.id,p.name,p.storage_path,min(f.descriptor <-> query_descriptor) as distance
 from public.faces f join public.photos p on p.id=f.photo_id and p.event_id=f.event_id join public.events e on e.id=f.event_id
 where e.slug=event_slug and e.published and (f.descriptor <-> query_descriptor)<0.52
 group by p.id,p.name,p.storage_path order by distance limit 100;
$$;
revoke all on function public.match_event_photos(text,extensions.vector) from public, anon, authenticated;
grant execute on function public.match_event_photos(text,extensions.vector) to service_role;
create table public.search_limits(key text primary key, window_start timestamptz not null, attempts integer not null);
alter table public.search_limits enable row level security;
create function public.allow_photo_search(rate_key text) returns boolean language plpgsql security definer set search_path = '' as $$
declare total integer;
begin
 delete from public.search_limits where window_start < now()-interval '1 hour';
 insert into public.search_limits(key,window_start,attempts) values(rate_key,now(),1)
 on conflict(key) do update set attempts=case when public.search_limits.window_start<now()-interval '1 minute' then 1 else public.search_limits.attempts+1 end,
 window_start=case when public.search_limits.window_start<now()-interval '1 minute' then now() else public.search_limits.window_start end returning attempts into total;
 return total<=12;
end;
$$;
revoke all on function public.allow_photo_search(text) from public,anon,authenticated;
grant execute on function public.allow_photo_search(text) to service_role;
commit;

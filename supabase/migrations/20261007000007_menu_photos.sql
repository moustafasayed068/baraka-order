-- Menu photos: public read, only the owner (signed in with 2FA) can write.
-- Uploads are re-encoded to WebP on the server, so only image/webp is accepted here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', true, 2097152, '{image/webp}')
on conflict (id) do nothing;

create policy "owner uploads menu photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and public.is_owner());
create policy "owner replaces menu photos" on storage.objects for update to authenticated
  using (bucket_id = 'menu-photos' and public.is_owner());
create policy "owner deletes menu photos" on storage.objects for delete to authenticated
  using (bucket_id = 'menu-photos' and public.is_owner());

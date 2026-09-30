-- Batch 2, part 3: storage rules for product photos and vendor ID documents.
-- Builds on the product-images bucket from the payout-review migration.

-- ---------------------------------------------------------------------------
-- product-images (public read)
-- ---------------------------------------------------------------------------

-- Photos are compressed in the browser to under 300 KB. The bucket accepts up
-- to 1 MB, so an upload that skipped compression is still refused. The 5 MB
-- limit applies to the original file, in the browser, before compression.
update storage.buckets
   set file_size_limit = 1048576,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'product-images';

-- Uploads go to <vendor_id>/<product_id>/<file>, where the product belongs to
-- the calling approved vendor. Replaces the looser Batch 1 insert rule.
drop policy product_images_vendor_insert on storage.objects;
create policy product_images_vendor_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select public.current_vendor_id())::text
    and exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[2]
        and p.vendor_id = (select public.current_vendor_id())
    )
  );

-- Admins may look at and remove product photos (moderation) but not upload.
drop policy product_images_admin_all on storage.objects;
create policy product_images_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
create policy product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- vendor-documents (private)
-- ---------------------------------------------------------------------------

-- ID documents: never public. The owner uploads and reads their own file
-- (<user_id>/<file>). Admins read through short-lived signed links made by
-- the app (60 seconds). Nobody else, and no anonymous access of any kind.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-documents', 'vendor-documents', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy vendor_documents_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy vendor_documents_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vendor-documents'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy vendor_documents_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy vendor_documents_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'vendor-documents' and (select public.is_admin()));

-- signed direct uploads bypass the app server, so the size cap moves to the
-- bucket itself (16MB for task briefs and candidate submissions).
-- the local dev shim's storage.buckets lacks the column real Supabase has;
-- on hosted Supabase the table isn't ours to alter, so only add it when missing
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    alter table storage.buckets add column file_size_limit bigint;
  end if;
end $$;
update storage.buckets set file_size_limit = 16777216 where id in ('briefs', 'submissions');

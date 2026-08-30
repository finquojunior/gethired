-- signed direct uploads bypass the app server, so the size cap moves to the
-- bucket itself (16MB for task briefs and candidate submissions).
-- the local dev shim's storage.buckets lacks the column real Supabase has
alter table storage.buckets add column if not exists file_size_limit bigint;
update storage.buckets set file_size_limit = 16777216 where id in ('briefs', 'submissions');

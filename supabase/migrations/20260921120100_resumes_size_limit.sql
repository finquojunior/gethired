-- Resume direct uploads (careers apply + staff walk-in add) bypass the app
-- server, so the 5 MB cap has to live on the bucket like briefs/submissions do.
update storage.buckets set file_size_limit = 5242880 where id = 'resumes';

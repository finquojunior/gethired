# gethired — production deploy checklist (Vercel + Supabase)

## 1. Supabase project
1. Create the project; note the **pooled** connection string (port 6543,
   "Transaction" mode) — serverless must use the pooler, never the direct
   connection.
2. Push the schema: `supabase link --project-ref <ref>` then `supabase db push`
   (applies all migrations in `supabase/migrations/`, including storage
   buckets: resumes, submissions, posters — all private).
3. Create your first admin (SQL editor):
   ```sql
   insert into auth.users (id, email) values (gen_random_uuid(), 'you@company.com');
   insert into public.profiles (id, full_name, role, password_hash)
   select id, 'Your Name', 'admin', '<hash>' from auth.users where email = 'you@company.com';
   ```
   Generate `<hash>` locally:
   `node -e "const{randomBytes,scryptSync}=require('crypto');const s=randomBytes(16).toString('hex');console.log(s+':'+scryptSync(process.argv[1],s,64).toString('hex'))" 'yourpassword'`
   (After that, add everyone else through /app/team.)

## 2. Vercel project — environment variables (all required)
| Var | Value |
| --- | --- |
| `DATABASE_URL` | the **pooled** Supabase connection string (port 6543) |
| `APP_URL` | `https://hiring.yourdomain.com` (portal links in emails use this) |
| `SESSION_SECRET` | 32+ random chars (`openssl rand -hex 32`) |
| `CRON_SECRET` | random string — Vercel cron sends it automatically |
| `SUPABASE_URL` | project URL (uploads go to Supabase Storage; deploy fails closed without it) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (server-side only, never NEXT_PUBLIC) |
| `RESEND_API_KEY` + `EMAIL_FROM` | for real email delivery (domain must be verified in Resend) |
| `ORG_NAME`, `ORG_TZ` | branding + timezone (defaults: Finquo Junior, Asia/Kolkata) |

vercel.json already schedules `/api/cron` hourly.

## 3. Platform hardening (do these in the dashboards)
- Vercel: enable **Bot Protection / WAF** (app-level rate limits are
  per-instance only; the platform layer is the real shield for a social blast)
- Supabase: keep the Data API disabled or untouched — the app talks SQL only;
  confirm daily backups are on (default on paid tiers)
- DNS: the subdomain gets HTTPS automatically; HSTS is already sent

## 4. Pre-launch smoke (5 minutes, on the deployed URL)
1. `/api/health` → `{"ok":true}`
2. `/app` unauthenticated → redirected to /login; log in as your admin
3. Create a real opening → publish form → open → apply from your phone via
   the public link (with a `?utm_source=test`) → confirm the application,
   resume preview, confirmation email, and portal link all work
4. `/api/cron` without the secret → 401/503
5. Settings → Errors is empty; Emails shows the confirmation as sent

## 5. Known limits (accepted for this scale)
- App-level rate limits are per serverless instance (platform WAF covers the gap)
- `scripts/purge.mjs` (data retention) deletes local files only; on Supabase
  Storage, purge via the dashboard or extend the script when retention starts
  to matter
- Session revocation = password change + 7-day cookie expiry; no per-device
  session list (fine for a small internal team)

## Verified before this checklist was written
- Auth: unauthenticated /app → login; forged/expired cookies rejected; files
  API 403s; login rate-limited (10/15min/IP); careers + portal stay public
- Load: 150 concurrent full applications (resume uploads included) completed
  in 525 ms locally — 100% success, 150 unique portal tokens, zero races
- `npm audit`: 0 vulnerabilities; Next.js at latest 15.x patch
- Storage: fails closed on Vercel unless Supabase Storage is configured

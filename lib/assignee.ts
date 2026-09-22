/**
 * A person's fixed pastel: their id hashed onto one of 10 hues, painted at low
 * alpha so it reads as a light tint on both light and dark backgrounds.
 * ponytail: 10 hues, so two people share a colour past 10 staff; a per-profile
 * colour column is the upgrade if that bites.
 */
export function assigneeTint(userId: string, alpha = 0.22): string {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${(h % 10) * 36} 70% 55% / ${alpha})`;
}

/** Who may be assigned candidates in an opening ($1): global staff plus its Team tab members. */
export const ASSIGNABLE_SQL = `select p.id, p.full_name from public.profiles p
  where p.role in ('admin', 'hr')
     or exists (select 1 from public.opening_members m where m.opening_id = $1 and m.user_id = p.id)
  order by p.full_name`;
export type Person = { id: string; full_name: string };

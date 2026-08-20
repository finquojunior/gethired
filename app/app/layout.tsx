import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import NavLink from '@/components/NavLink';
import RememberPage from '@/components/RememberPage';

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="sticky top-0 z-20 flex w-full shrink-0 items-center justify-between gap-4 bg-ink px-4 py-3 text-white md:h-screen md:w-52 md:flex-col md:items-stretch md:overflow-y-auto md:py-6">
        <div className="flex items-center gap-6 md:block">
          <Link href="/app" className="font-display text-xl font-bold tracking-tight">
            gethired<span className="text-pine-wash">·</span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm md:mt-8 md:flex-col">
            <NavLink href="/app/openings">Openings</NavLink>
            <NavLink href="/app/candidates">Candidates</NavLink>
            <NavLink href="/app/interviews">Interviews</NavLink>
            <NavLink href="/app/team">Team</NavLink>
            <NavLink href="/app/emails">Emails</NavLink>
            <NavLink href="/app/reports">Reports</NavLink>
            <NavLink href="/app/settings">Settings</NavLink>
            <Link href="/careers" className="rounded px-2 py-1.5 text-white/70 hover:bg-white/10">
              Careers page ↗
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/60 md:flex-col md:items-start md:gap-1.5">
          <span>{user.name} · {user.role}</span>
          <form method="post" action="/api/logout">
            <button className="rounded border border-white/20 px-2 py-0.5 hover:bg-white/10">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
        <RememberPage />
        {children}
      </main>
    </div>
  );
}

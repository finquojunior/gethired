import Link from 'next/link';
import { currentUser, isStaff } from '@/lib/auth';
import NavLink from '@/components/NavLink';
import RememberPage from '@/components/RememberPage';
import Toaster from '@/components/Toaster';

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const nav = (
    <>
      <NavLink href="/app">Dashboard</NavLink>
      <NavLink href="/app/openings">Openings</NavLink>
      <NavLink href="/app/candidates">Candidates</NavLink>
      <NavLink href="/app/tasks">Tasks</NavLink>
      <NavLink href="/app/interviews">Interviews</NavLink>
      {isStaff(user) && <NavLink href="/app/team">Team</NavLink>}
      <NavLink href="/app/emails">Emails</NavLink>
      {isStaff(user) && <NavLink href="/app/reports">Reports</NavLink>}
      {isStaff(user) && <NavLink href="/app/settings">Settings</NavLink>}
      <a href="/careers" target="_blank" rel="noopener" className="rounded px-2 py-1.5 text-white/70 hover:bg-white/10">
        Careers page ↗
      </a>
    </>
  );
  const userBlock = (
    <div className="flex items-center gap-3 text-xs text-white/60 md:flex-col md:items-start md:gap-1.5">
      <span>{user.name} · {user.role}</span>
      <form method="post" action="/api/logout">
        <button className="rounded border border-white/20 px-2 py-0.5 hover:bg-white/10">
          Sign out
        </button>
      </form>
    </div>
  );
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="z-20 w-full shrink-0 bg-ink px-4 py-3 text-white print:hidden md:sticky md:top-0 md:flex md:h-screen md:w-52 md:flex-col md:justify-between md:overflow-y-auto md:py-6">
        {/* phone: one row + a Menu disclosure; desktop: the full sidebar */}
        <details className="group md:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
            <Link href="/app" className="font-display text-xl font-bold tracking-tight">
              gethired<span className="text-pine-wash">·</span>
            </Link>
            <span className="rounded border border-white/20 px-2 py-1 text-xs">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <nav className="mt-3 flex flex-wrap gap-1 text-sm">{nav}</nav>
          <div className="mt-3 border-t border-white/10 pt-3">{userBlock}</div>
        </details>
        <div className="hidden md:block">
          <Link href="/app" className="font-display text-xl font-bold tracking-tight">
            gethired<span className="text-pine-wash">·</span>
          </Link>
          <nav className="mt-8 flex flex-col gap-1 text-sm">{nav}</nav>
        </div>
        <div className="hidden md:block">{userBlock}</div>
      </aside>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
        <RememberPage />
        <Toaster />
        {children}
      </main>
    </div>
  );
}

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { currentUser, isStaff } from '@/lib/auth';
import AppNav, { type NavItem } from '@/components/AppNav';
import RememberPage from '@/components/RememberPage';
import { Button } from '@/components/ui/button';
import HoverSidebar from '@/components/HoverSidebar';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', hr: 'HR', dept_head: 'Department head', interviewer: 'Interviewer' };

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const staff = isStaff(user);
  const items: NavItem[] = [
    { href: '/app', label: 'Dashboard' },
    { href: '/app/openings', label: 'Openings' },
    { href: '/app/candidates', label: 'Candidates' },
    { href: '/app/tasks', label: 'Tasks' },
    { href: '/app/interviews', label: 'Interviews' },
    ...(staff ? [{ href: '/app/team', label: 'Team' }] : []),
    { href: '/app/emails', label: 'Emails' },
    ...(staff ? [{ href: '/app/reports', label: 'Reports' }, { href: '/app/settings', label: 'Settings' }] : []),
    { href: '/careers', label: 'Careers page', external: true },
  ];
  return (
    // rests collapsed to icons; the gap stays icon-wide so hovering overlays the page instead of reflowing it
    <SidebarProvider defaultOpen={false} className="md:[&_[data-slot=sidebar-gap]]:w-(--sidebar-width-icon)!">
      <HoverSidebar className="print:hidden">
        <SidebarHeader className="px-2 py-5">
          {/* wordmark when expanded, crossfades to the favicon mark when collapsed */}
          <Link href="/app" className="relative flex h-8 items-center px-2 font-display text-xl font-bold tracking-tight whitespace-nowrap text-sidebar-accent-foreground">
            <img src="/icon.svg" alt="" className="absolute left-0 size-8 opacity-0 transition-opacity duration-300 group-data-[collapsible=icon]:opacity-100" />
            <span className="transition-opacity duration-300 group-data-[collapsible=icon]:opacity-0">gethired<span className="text-pine-wash">·</span></span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <AppNav items={items} />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-2 py-4">
          <div className="px-2 text-xs whitespace-nowrap text-sidebar-foreground/70 transition-opacity duration-300 group-data-[collapsible=icon]:opacity-0">
            <div className="truncate font-medium text-sidebar-foreground">{user.name}</div>
            <div>{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
          <form method="post" action="/api/logout">
            <Button type="submit" variant="outline" size="sm" className="mt-1 w-full justify-start overflow-hidden border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <LogOut data-icon="inline-start" />
              Sign out
            </Button>
          </form>
        </SidebarFooter>
      </HoverSidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b border-border px-3 md:hidden print:hidden">
          <SidebarTrigger />
          <Link href="/app" className="font-display text-lg font-bold tracking-tight">
            gethired<span className="text-primary">·</span>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
          <RememberPage />
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

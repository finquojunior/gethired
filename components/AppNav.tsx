'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  Mail,
  Settings,
  UserCog,
  Users,
} from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

const ICONS: Record<string, LucideIcon> = {
  '/app': LayoutDashboard,
  '/app/openings': Briefcase,
  '/app/candidates': Users,
  '/app/tasks': ClipboardList,
  '/app/interviews': CalendarClock,
  '/app/team': UserCog,
  '/app/emails': Mail,
  '/app/reports': BarChart3,
  '/app/settings': Settings,
};

export type NavItem = { href: string; label: string; external?: boolean };

/** Sidebar menu with the active item derived from the current path. */
export default function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? ExternalLink;
        const active = !item.external && (pathname === item.href || (item.href !== '/app' && pathname.startsWith(`${item.href}/`)));
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={active}
              render={
                item.external ? (
                  <a href={item.href} target="_blank" rel="noopener" />
                ) : (
                  <Link href={item.href} aria-current={active ? 'page' : undefined} />
                )
              }
            >
              <Icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

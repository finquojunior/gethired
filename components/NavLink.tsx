'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded px-2 py-1.5 hover:bg-white/10 ${active ? 'bg-white/10 font-medium' : 'text-white/70'}`}
    >
      {children}
    </Link>
  );
}

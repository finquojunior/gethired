'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Sidebar, useSidebar } from '@/components/ui/sidebar';

/** Desktop sidebar that rests as an icon rail and expands over the page while hovered. */
export default function HoverSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const { isMobile, setOpen } = useSidebar();
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const hover = isMobile
    ? {}
    : {
        onMouseEnter: () => {
          clearTimeout(closeTimer.current);
          setOpen(true);
        },
        // short grace period so brushing past the edge doesn't flicker it shut
        onMouseLeave: () => {
          closeTimer.current = setTimeout(() => setOpen(false), 150);
        },
      };
  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        'overflow-hidden duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=expanded]:shadow-xl',
        className,
      )}
      {...hover}
      {...props}
    />
  );
}

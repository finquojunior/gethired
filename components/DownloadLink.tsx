'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Plain download link that shows a "Preparing…" label for a few seconds after
// the click, since a zip/CSV can take a while before the browser reacts.
export default function DownloadLink({
  href,
  children,
  className,
  preparingLabel = 'Preparing…',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  preparingLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={href}
      className={cn(buttonVariants({ variant: 'outline' }), busy && 'pointer-events-none opacity-60', className)}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        setTimeout(() => setBusy(false), 8000);
      }}
    >
      <Download data-icon="inline-start" />
      {busy ? preparingLabel : children}
    </a>
  );
}

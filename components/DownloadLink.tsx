'use client';

import { useState } from 'react';

// Plain download link that shows a "Preparing…" label for a few seconds after
// the click, since a zip/CSV can take a while before the browser reacts.
export default function DownloadLink({
  href,
  children,
  className = 'btn-quiet',
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
      className={`${className} ${busy ? 'pointer-events-none opacity-60' : ''}`}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        setTimeout(() => setBusy(false), 8000);
      }}
    >
      {busy ? preparingLabel : children}
    </a>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// "Continue where you left off" — reads the page recorded by RememberPage.
export default function ContinueChip() {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    setLast(localStorage.getItem('gethired:lastPage'));
  }, []);
  if (!last) return null;
  const label = last.split('?')[0].replace('/app/', '').replace(/\//g, ' › ') || 'last page';
  return (
    <Link
      href={last}
      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-pine hover:border-pine"
    >
      Continue where you left off <span className="font-medium">{label}</span> →
    </Link>
  );
}

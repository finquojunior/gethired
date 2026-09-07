'use client';

import { useEffect } from 'react';
import { toast } from '@/components/Toaster';

// Post-redirect flash: fires one toast through the layout's <Toaster /> and
// strips the query params that triggered it so refresh/back doesn't replay it.
export default function Flash({
  kind,
  message,
  cleanParams = ['ok', 'e'],
}: {
  kind: 'success' | 'error';
  message?: string | null;
  cleanParams?: string[];
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => toast(kind, message), 0);
    const url = new URL(window.location.href);
    for (const p of cleanParams) url.searchParams.delete(p);
    window.history.replaceState(null, '', url);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

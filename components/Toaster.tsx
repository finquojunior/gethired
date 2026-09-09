'use client';

import { useEffect } from 'react';
import { toast as sonner } from 'sonner';

type ToastInput = { kind: 'success' | 'error'; message: string };

/** Fire a toast from anywhere client-side. The sonner <Toaster> is mounted once in app/layout.tsx. */
export function toast(kind: ToastInput['kind'], message: string) {
  if (kind === 'success') sonner.success(message);
  // errors stay until dismissed — the reader needs time to see what to fix
  else sonner.error(message, { duration: Infinity, closeButton: true });
}

// Post-redirect flash: shows `initial` on mount and strips the query params
// that triggered it so refresh/back doesn't replay the popup. Renders nothing.
export default function Toaster({
  initial,
  cleanParams,
}: {
  initial?: ToastInput | null;
  cleanParams?: string[];
}) {
  useEffect(() => {
    if (initial) {
      const t = setTimeout(() => toast(initial.kind, initial.message), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!cleanParams?.length) return;
    const url = new URL(window.location.href);
    for (const p of cleanParams) url.searchParams.delete(p);
    window.history.replaceState(null, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

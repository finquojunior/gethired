'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast as sonner } from 'sonner';

type ToastInput = { kind: 'success' | 'error'; message: string };

/** Fire a toast from anywhere client-side. The sonner <Toaster> is mounted once in app/layout.tsx. */
export function toast(kind: ToastInput['kind'], message: string) {
  if (kind === 'success') sonner.success(message, { duration: 6000 });
  // errors stay until dismissed — the reader needs time to see what to fix
  else sonner.error(message, { duration: Infinity, closeButton: true });
}

/**
 * Post-redirect flash. Fires `input` whenever the URL carries one of `params`,
 * then strips them so refresh/back doesn't replay the popup.
 *
 * Keyed on the live query string, not on mount: a server action that redirects
 * back to the same page is a soft navigation, which re-renders the page with
 * new params but keeps this component mounted. A mount-only effect would skip
 * the toast then and replay it at some unrelated later remount.
 */
export function useFlash(input: ToastInput | null | undefined, params: string[]) {
  const sp = useSearchParams();
  const search = sp.toString();
  useEffect(() => {
    const present = params.some((p) => sp.has(p));
    if (!present) return;
    if (input) toast(input.kind, input.message);
    const url = new URL(window.location.href);
    for (const p of params) url.searchParams.delete(p);
    // null state: Next's patched replaceState then syncs its router (canonical URL,
    // useSearchParams) — passing its own state object back makes it skip that sync
    window.history.replaceState(null, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
}

/** Post-redirect flash for pages that build the message themselves. Renders nothing. */
export default function Toaster({
  initial,
  cleanParams = ['ok', 'e'],
}: {
  initial?: ToastInput | null;
  cleanParams?: string[];
}) {
  useFlash(initial, cleanParams);
  return null;
}

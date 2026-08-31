'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ToastInput = { kind: 'success' | 'error'; message: string };

/** Fire a toast from anywhere client-side. Needs a <Toaster /> on the page. */
export function toast(kind: ToastInput['kind'], message: string) {
  window.dispatchEvent(new CustomEvent<ToastInput>('gh-toast', { detail: { kind, message } }));
}

// Stacked auto-dismissing popups (top center). `initial` shows one toast on
// mount — used for post-redirect flashes; `cleanParams` strips the query
// params that triggered it so refresh/back doesn't replay the popup.
export default function Toaster({
  initial,
  cleanParams,
}: {
  initial?: ToastInput | null;
  cleanParams?: string[];
}) {
  const [toasts, setToasts] = useState<Array<ToastInput & { id: number }>>([]);
  const nextId = useRef(1);

  const push = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    if (initial) push(initial);
    if (cleanParams?.length) {
      const url = new URL(window.location.href);
      for (const p of cleanParams) url.searchParams.delete(p);
      window.history.replaceState(null, '', url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onToast = (e: Event) => push((e as CustomEvent<ToastInput>).detail);
    window.addEventListener('gh-toast', onToast);
    return () => window.removeEventListener('gh-toast', onToast);
  }, [push]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
            t.kind === 'success' ? 'bg-pine-deep' : 'bg-rust'
          }`}
        >
          <span>{t.kind === 'success' ? '✓' : '✕'}</span>
          <span>{t.message}</span>
          <button
            onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
            aria-label="Dismiss"
            className="ml-1 opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

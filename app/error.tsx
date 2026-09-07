'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// Route-level error boundary: shows a friendly recovery UI and reports the
// error (any user, staff or candidate) to the admin error log.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [support, setSupport] = useState('');
  useEffect(() => {
    setSupport(document.querySelector('meta[name="support-email"]')?.getAttribute('content') ?? '');
    fetch('/api/errlog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'client',
        message: error.message,
        stack: error.stack ?? '',
        context: { digest: error.digest ?? '', url: window.location.pathname },
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <div className="mx-auto mb-4 h-3 w-3 rounded-full bg-rust" />
      <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-soft">
        The problem has been reported automatically. You can try again — if it keeps happening,
        {support ? (
          <>
            {' '}email <a href={`mailto:${support}`} className="text-pine underline">{support}</a> and
            tell us what you were doing.
          </>
        ) : (
          ' let the hiring team know what you were doing (reply to any email we sent you).'
        )}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={reset} className="btn-primary min-h-11">
          Try again
        </button>
        <Link href="/careers" className="btn-quiet min-h-11">Open roles</Link>
      </div>
    </main>
  );
}

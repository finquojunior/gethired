'use client';

import { useEffect } from 'react';

// Last-resort boundary (errors in the root layout itself).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch('/api/errlog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'client',
        message: error.message,
        stack: error.stack ?? '',
        context: { digest: error.digest ?? '', url: window.location.pathname, global: true },
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', textAlign: 'center', padding: '6rem 1.5rem' }}>
        <h1>Something went wrong</h1>
        <p>The problem has been reported. Please try again.</p>
        <button onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
          Try again
        </button>
      </body>
    </html>
  );
}

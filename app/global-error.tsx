'use client';

import { useEffect } from 'react';
// the root layout (and its stylesheet) is gone when this renders
import './globals.css';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';

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
      <body>
        <main className="mx-auto max-w-md px-6 py-24">
          <Empty>
            <EmptyHeader>
              <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
              <EmptyDescription>The problem has been reported. Please try again.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="lg" onClick={reset}>Try again</Button>
            </EmptyContent>
          </Empty>
        </main>
      </body>
    </html>
  );
}

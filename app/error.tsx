'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';

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
    <main className="mx-auto max-w-md px-6 py-24">
      <Empty>
        <EmptyHeader>
          <div className="mb-2 h-3 w-3 rounded-full bg-destructive" />
          <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
          <EmptyDescription>
            The problem has been reported automatically. You can try again — if it keeps happening,
            {support ? (
              <>
                {' '}email <a href={`mailto:${support}`}>{support}</a> and
                tell us what you were doing.
              </>
            ) : (
              ' let the hiring team know what you were doing (reply to any email we sent you).'
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-3">
          <Button size="lg" onClick={reset}>Try again</Button>
          <Link href="/careers" className={buttonVariants({ variant: 'outline', size: 'lg' })}>Open roles</Link>
        </EmptyContent>
      </Empty>
    </main>
  );
}

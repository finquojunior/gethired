'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { PROGRESS_EVENT, type Progress } from '@/lib/batch-action';

// Indeterminate progress bar shown while a bulk form action is in flight.
//
// It listens for the enclosing form's native `submit` event rather than
// useFormStatus: bulk moves of two or more go through a confirmation dialog
// that re-submits the form programmatically, and React does not report a
// programmatic submit as pending — so useFormStatus stayed false and the bar
// never showed for exactly the multi-candidate moves that take the longest.
// The submit event fires for both the direct and the confirmed path.
//
// The bar clears when the form stops being pending (ResultForm actions return
// in place), when a redirect lands (pathname/search change), or after a safety
// timeout. Selections big enough to be sent in batches (useActionResult) report
// each finished batch, and the bar fills to match.
const MAX_MS = 30_000;

export default function BulkProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState<number | null>(null);
  const [done, setDone] = useState<Progress | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!pending) setN(null);
  }, [pending]);
  useEffect(() => {
    setN(null);
  }, [pathname, search]);
  useEffect(() => {
    if (n === null) setDone(null);
  }, [n]);
  useEffect(() => {
    const onProgress = (e: Event) => setDone((e as CustomEvent<Progress>).detail);
    window.addEventListener(PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(PROGRESS_EVENT, onProgress);
  }, []);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onSubmit = () => setN(new FormData(form).getAll('appId').length);
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  // belt-and-suspenders: never leave the bar stuck if the redirect URL is unchanged
  // (restarted by each batch, so a long batched run isn't cut off)
  useEffect(() => {
    if (n === null) return;
    const t = setTimeout(() => setN(null), MAX_MS);
    return () => clearTimeout(t);
  }, [n, done]);

  return (
    <div ref={ref} className="w-full basis-full">
      {n !== null && (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {done
              ? `Processed ${done.done} of ${done.total} candidates — please keep this tab open…`
              : `Processing${n > 0 ? ` ${n} candidate${n > 1 ? 's' : ''}` : ''}…`}
          </p>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={done?.total}
            aria-valuenow={done?.done}
          >
            {done ? (
              <div
                className="h-full rounded bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(4, (done.done / done.total) * 100)}%` }}
              />
            ) : (
              <div className="h-full w-1/3 rounded bg-primary animate-progress" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

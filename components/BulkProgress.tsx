'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Indeterminate progress bar shown while a bulk form action is in flight.
//
// It listens for the enclosing form's native `submit` event rather than
// useFormStatus: bulk moves of two or more go through a confirmation dialog
// that re-submits the form programmatically, and React does not report a
// programmatic submit as pending — so useFormStatus stayed false and the bar
// never showed for exactly the multi-candidate moves that take the longest.
// The submit event fires for both the direct and the confirmed path.
//
// The bar clears when the action's redirect lands (pathname/search change), with
// a safety timeout for the rare redirect back to an identical URL.
const MAX_MS = 30_000;

export default function BulkProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState<number | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // the bulk action redirects on completion; hide once that navigation settles
  useEffect(() => {
    setN(null);
  }, [pathname, search]);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onSubmit = () => setN(new FormData(form).getAll('appId').length);
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  // belt-and-suspenders: never leave the bar stuck if the redirect URL is unchanged
  useEffect(() => {
    if (n === null) return;
    const t = setTimeout(() => setN(null), MAX_MS);
    return () => clearTimeout(t);
  }, [n]);

  return (
    <div ref={ref} className="w-full basis-full">
      {n !== null && (
        <>
          <p className="text-xs text-muted-foreground">
            Processing{n > 0 ? ` ${n} candidate${n > 1 ? 's' : ''}` : ''}…
          </p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
            <div className="h-full w-1/3 rounded bg-primary animate-progress" />
          </div>
        </>
      )}
    </div>
  );
}

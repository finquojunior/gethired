'use client';

import { useFormStatus } from 'react-dom';

// Indeterminate progress bar shown while a bulk form action is in flight,
// with the number of selected candidates read from the submitted data.
export default function BulkProgress() {
  const { pending, data } = useFormStatus();
  if (!pending) return null;
  const n = data instanceof FormData ? data.getAll('appId').length : 0;
  return (
    <div className="w-full basis-full">
      <p className="text-xs text-ink-soft">
        Processing{n > 0 ? ` ${n} candidate${n > 1 ? 's' : ''}` : ''}…
      </p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-line">
        <div className="h-full w-1/3 rounded bg-pine animate-progress" />
      </div>
    </div>
  );
}

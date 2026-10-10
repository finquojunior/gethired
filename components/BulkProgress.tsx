'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { END_EVENT, PROGRESS_EVENT, type Progress } from '@/lib/batch-action';

// Progress bar shown while a bulk form action is in flight.
//
// It listens for the enclosing form's native `submit` event rather than
// useFormStatus: bulk moves of two or more go through a confirmation dialog
// that re-submits the form programmatically, and React does not report a
// programmatic submit as pending — so useFormStatus stayed false and the bar
// never showed for exactly the multi-candidate moves that take the longest.
// The submit event fires for both the direct and the confirmed path, and the
// run ends on useActionResult's END_EVENT.
//
// Multi-candidate selections run one candidate per request (useActionResult),
// and each finished one ticks the bar. When the run completes the bar stays
// full with a "Done" line for a moment before clearing; it also clears when a
// redirect lands (pathname/search change) or after a safety timeout.
const MAX_MS = 30_000;
const DONE_MS = 2_500;

const VERB: Record<string, string> = {
  pool: 'Moving to the talent pool and emailing',
  reject_send: 'Rejecting and emailing',
  reject_draft: 'Rejecting',
  hire: 'Marking hired and emailing',
  release: 'Releasing and emailing',
  move: 'Moving',
  withdraw: 'Marking withdrawn',
  restore: 'Restoring',
  assign: 'Assigning',
};

type Run = { verb: string; total: number; done: number; finished: boolean };

export default function BulkProgress() {
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState<Run | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // the action returned: hold a completed run on "Done", clear anything else.
  // Not useFormStatus: after the confirm dialog's requestSubmit it reports
  // pending → not pending within the same frame, seconds before the run ends.
  useEffect(() => {
    const onEnd = () => setRun((r) => (r && r.total > 1 && r.done >= r.total ? { ...r, finished: true } : null));
    window.addEventListener(END_EVENT, onEnd);
    return () => window.removeEventListener(END_EVENT, onEnd);
  }, []);
  useEffect(() => {
    if (!run?.finished) return;
    const t = setTimeout(() => setRun(null), DONE_MS);
    return () => clearTimeout(t);
  }, [run?.finished]);
  useEffect(() => {
    setRun(null);
  }, [pathname, search]);

  useEffect(() => {
    const onProgress = (e: Event) => {
      const p = (e as CustomEvent<Progress>).detail;
      setRun((r) => r && { ...r, done: p.done, total: p.total });
    };
    window.addEventListener(PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(PROGRESS_EVENT, onProgress);
  }, []);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      const intent = e.submitter instanceof HTMLButtonElement ? e.submitter.value : '';
      const total = new FormData(form).getAll('appId').length;
      setRun({ verb: VERB[intent] ?? 'Processing', total, done: 0, finished: false });
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  // belt-and-suspenders: never leave the bar stuck if the redirect URL is unchanged
  // (restarted by each tick, so a long run isn't cut off)
  useEffect(() => {
    if (!run || run.finished) return;
    const t = setTimeout(() => setRun(null), MAX_MS);
    return () => clearTimeout(t);
  }, [run]);

  const many = run !== null && run.total > 1;
  const pct = run && many ? Math.max(3, (run.done / run.total) * 100) : 0;

  return (
    <div ref={ref} className="w-full basis-full">
      {run && (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium" aria-live="polite">
            {run.finished ? (
              <>
                <CheckCircle2 className="size-4 text-green-600" />
                Done — {run.total} of {run.total} candidates
              </>
            ) : many ? (
              <>
                {run.verb}… {Math.min(run.done + 1, run.total)} of {run.total}{' '}
                <span className="font-normal text-muted-foreground">— please keep this tab open</span>
              </>
            ) : (
              <>{run.verb}{run.total === 1 ? ' 1 candidate' : ''}…</>
            )}
          </p>
          <div
            className="mt-1.5 h-2 w-full overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={many ? run.total : undefined}
            aria-valuenow={many ? run.done : undefined}
          >
            {many ? (
              <div
                className={`h-full rounded transition-[width] duration-300 ${run.finished ? 'bg-green-600' : 'bg-primary'}`}
                style={{ width: `${pct}%` }}
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

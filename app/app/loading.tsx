import { Skeleton } from '@/components/ui/skeleton';

// Streamed in place of the page while its data loads (and on full-page loads
// after a redirect), so the main area shows structure instead of going blank.
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="track">
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="mt-6 h-4 w-3/4 max-w-xl" />
      <Skeleton className="mt-2 h-4 w-1/2 max-w-md" />
      <div className="mt-8 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

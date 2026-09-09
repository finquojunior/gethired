import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-xl px-6 py-16">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-9 w-64" />
      <Skeleton className="mt-6 h-6 w-full" />
      <Skeleton className="mt-8 h-32 rounded-xl" />
      <Skeleton className="mt-4 h-48 rounded-xl" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';

// Real back navigation: restores the previous page with its filters and
// scroll, falling back to a sensible parent when there's no history.
export default function BackButton({ fallback = '/app' }: { fallback?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
    >
      ← Back
    </button>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Real back navigation: restores the previous page with its filters and
// scroll, falling back to a sensible parent when there's no history.
export default function BackButton({ fallback = '/app' }: { fallback?: string }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mb-3 -ml-2 text-muted-foreground"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
    >
      <ArrowLeft data-icon="inline-start" />
      Back
    </Button>
  );
}

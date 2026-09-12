'use client';

import { useFlash } from '@/components/Toaster';

// Post-redirect flash: fires one toast through the layout's <Toaster /> and
// strips the query params that triggered it. See useFlash for why it keys on
// the URL rather than on mount.
export default function Flash({
  kind,
  message,
  cleanParams = ['ok', 'e'],
}: {
  kind: 'success' | 'error';
  message?: string | null;
  cleanParams?: string[];
}) {
  useFlash(message ? { kind, message } : null, cleanParams);
  return null;
}

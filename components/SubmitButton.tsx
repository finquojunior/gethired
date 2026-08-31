'use client';

import { useFormStatus } from 'react-dom';
import { useEffect, useRef, type ComponentProps } from 'react';
import { toast } from '@/components/Toaster';

// Shared submit button for server-action forms: disables and shows a working
// label while the enclosing form is pending, so actions can't double-fire.
// When the action finishes it fires a success toast (a thrown error routes to
// the error page instead, so the toast only shows for completed actions).
export default function SubmitButton({
  children,
  pendingLabel = 'Working…',
  doneMessage = 'Done',
  disabled,
  ...props
}: ComponentProps<'button'> & { pendingLabel?: string; doneMessage?: string }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && doneMessage) toast('success', doneMessage);
    wasPending.current = pending;
  }, [pending, doneMessage]);
  return (
    <button {...props} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}

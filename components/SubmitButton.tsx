'use client';

import { useFormStatus } from 'react-dom';
import type { ComponentProps } from 'react';

// Shared submit button for server-action forms: disables and shows a working
// label while the enclosing form is pending, so actions can't double-fire.
export default function SubmitButton({
  children,
  pendingLabel = 'Working…',
  disabled,
  ...props
}: ComponentProps<'button'> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button {...props} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}

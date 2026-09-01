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
  const { pending, data } = useFormStatus();
  // pending is form-wide; only the button that actually submitted shows its
  // pending label and fires the toast. The submitted FormData carries just the
  // clicked button's name/value, which is how we tell.
  const mine =
    props.name == null ||
    !(data instanceof FormData) ||
    data.get(String(props.name)) === String(props.value ?? '');
  const wasMine = useRef(false);
  useEffect(() => {
    if (wasMine.current && !pending && doneMessage) toast('success', doneMessage);
    wasMine.current = pending && mine;
  }, [pending, mine, doneMessage]);
  return (
    <button {...props} disabled={pending || disabled}>
      {pending && mine ? pendingLabel : children}
    </button>
  );
}

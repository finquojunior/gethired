'use client';

import { useFormStatus } from 'react-dom';
import { useEffect, useRef, type ComponentProps } from 'react';
import { toast } from '@/components/Toaster';

// Shared submit button for server-action forms: disables and shows a working
// label while the enclosing form is pending, so actions can't double-fire.
// `doneMessage` (opt-in) toasts when the action completes without throwing —
// only use it where the action can't silently no-op. `confirmText` asks
// window.confirm first and cancels the submit when declined; it may contain
// `{n}` (number of `appId` values in the form) and `{stage}` (label of the
// selected `stageId` option), and `confirmMin` skips the prompt below that n.
export default function SubmitButton({
  children,
  pendingLabel = 'Working…',
  doneMessage,
  confirmText,
  confirmMin = 1,
  disabled,
  onClick,
  ...props
}: ComponentProps<'button'> & {
  pendingLabel?: string;
  doneMessage?: string;
  confirmText?: string;
  confirmMin?: number;
}) {
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
    <button
      {...props}
      disabled={pending || disabled}
      onClick={(e) => {
        if (confirmText) {
          const form = e.currentTarget.form;
          const n = (form ? new FormData(form).getAll('appId').length : 0) || 1; // forms without appId confirm as one
          const sel = form?.elements.namedItem('stageId');
          const stage = sel instanceof HTMLSelectElement ? sel.selectedOptions[0]?.text ?? '' : '';
          const text = confirmText.replace('{n}', String(n)).replace('{stage}', stage);
          if (n >= confirmMin && !window.confirm(text)) {
            e.preventDefault();
            return;
          }
        }
        onClick?.(e);
      }}
    >
      {pending && mine ? pendingLabel : children}
    </button>
  );
}

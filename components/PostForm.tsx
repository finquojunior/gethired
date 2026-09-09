'use client';

import { useRef, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { toast } from '@/components/Toaster';

// Plain-POST form that flips its buttons to a pending label on submit, so
// candidates see something happening while the request is in flight.
export default function PostForm({
  pendingText = 'Sending…',
  submitToast,
  confirmText,
  confirmTitle,
  ...props
}: React.ComponentProps<'form'> & {
  pendingText?: string;
  submitToast?: string;
  /** ask before submitting (irreversible actions: cancel booking, withdraw) */
  confirmText?: string;
  confirmTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);
  const submitter = useRef<HTMLElement | null>(null);

  const markPending = (f: HTMLFormElement) => {
    if (submitToast) toast('success', submitToast);
    // after this tick, so button values still ride along in the POST
    setTimeout(() => {
      f.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
        b.textContent = pendingText;
      });
    }, 0);
  };

  return (
    <>
      <form
        {...props}
        onSubmit={(e) => {
          const f = e.currentTarget;
          if (confirmText && !confirmed.current) {
            e.preventDefault();
            submitter.current = (e.nativeEvent as SubmitEvent).submitter;
            setOpen(true);
            return;
          }
          confirmed.current = false;
          markPending(f);
        }}
      />
      {confirmText && (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={confirmTitle ?? 'Please confirm'}
          description={confirmText}
          destructive
          onConfirm={() => {
            confirmed.current = true;
            const el = submitter.current;
            const form = el instanceof HTMLButtonElement ? el.form : null;
            if (form) form.requestSubmit(el as HTMLButtonElement);
          }}
        />
      )}
    </>
  );
}

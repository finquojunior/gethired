'use client';

import { toast } from '@/components/Toaster';

// Plain-POST form that flips its buttons to a pending label on submit, so
// candidates see something happening while the request is in flight.
export default function PostForm({
  pendingText = 'Sending…',
  submitToast,
  confirmText,
  ...props
}: React.ComponentProps<'form'> & {
  pendingText?: string;
  submitToast?: string;
  /** ask before submitting (irreversible actions: cancel booking, withdraw) */
  confirmText?: string;
}) {
  return (
    <form
      {...props}
      onSubmit={(e) => {
        const f = e.currentTarget;
        if (confirmText && !window.confirm(confirmText)) {
          e.preventDefault();
          return;
        }
        if (submitToast) toast('success', submitToast);
        // after this tick, so button values still ride along in the POST
        setTimeout(() => {
          f.querySelectorAll('button').forEach((b) => {
            b.disabled = true;
            b.textContent = pendingText;
          });
        }, 0);
      }}
    />
  );
}

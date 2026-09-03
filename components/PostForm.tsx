'use client';

import { toast } from '@/components/Toaster';

// Plain-POST form that flips its buttons to a pending label on submit, so
// candidates see something happening while the request is in flight.
export default function PostForm({
  pendingText = 'Sending…',
  submitToast,
  ...props
}: React.ComponentProps<'form'> & { pendingText?: string; submitToast?: string }) {
  return (
    <form
      {...props}
      onSubmit={(e) => {
        const f = e.currentTarget;
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

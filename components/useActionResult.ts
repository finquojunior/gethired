'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/Toaster';
import { pipelineFlash } from '@/app/app/candidates/flash';
import { BATCH, END_EVENT, runBatched, type ActionResult } from '@/lib/batch-action';

export type { ActionResult } from '@/lib/batch-action';

/**
 * Runs a server action that returns its outcome instead of redirecting: toasts
 * the flash for the result, then refreshes the page in place.
 *
 * Redirecting actions put the outcome in the response, so a lost or 503'd
 * response takes the page with it — and when the click landed before hydration
 * the browser was doing a native form POST, so an empty body rendered as a
 * blank page with no error boundary to catch it. Here the work is a plain call:
 * if the response never comes we say so and refresh, because the action almost
 * always completed.
 *
 * `submit` stays awaited for the whole round trip so `useFormStatus` inside the
 * form reports pending and SubmitButton shows its working label.
 */
export function useActionResult(
  action: (fd: FormData) => Promise<ActionResult>,
  onDone?: () => void
) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const submit = async (formData: FormData) => {
    setPending(true);
    try {
      const result = await runBatched(action, formData);
      // a redirect thrown inside the action (forbidden, login) resolves with nothing:
      // Next has already navigated, there is no outcome to toast
      if (!result) return;
      if (result.error === 'timeout') {
        // The work usually went through even when the response is lost; show the truth.
        toast('error', 'No response from the server — refreshing to show the current state.');
        onDone?.();
        router.refresh();
        return;
      }
      const flash = pipelineFlash(result.ok, result.error);
      if (flash) toast(flash.kind, flash.message);
      // refresh on any error too when batches ran: the earlier ones went through
      if (result.ok || formData.getAll('appId').length > BATCH) {
        onDone?.();
        router.refresh();
      }
    } finally {
      setPending(false);
      window.dispatchEvent(new Event(END_EVENT));
    }
  };

  // setPending(true) inside submit runs in the form action's transition, and
  // React holds it until the action ends; a form's onSubmit calls this instead
  // so `pending` is true from the click.
  const start = () => setPending(true);

  return { submit, pending, start };
}

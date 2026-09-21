'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/Toaster';
import { pipelineFlash } from '@/app/app/candidates/flash';

export type ActionResult = { ok?: string; error?: string };

// How long we wait for the server before giving up on the response and
// refreshing anyway — the actions themselves finish in about a second.
const RESPONSE_TIMEOUT_MS = 15_000;

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
      const timeout = new Promise<ActionResult>((resolve) =>
        setTimeout(() => resolve({ error: 'timeout' }), RESPONSE_TIMEOUT_MS)
      );
      let result: ActionResult;
      try {
        result = await Promise.race([action(formData), timeout]);
      } catch {
        result = { error: 'timeout' };
      }
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
      if (result.ok) {
        onDone?.();
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  };

  return { submit, pending };
}

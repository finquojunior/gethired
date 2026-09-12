'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/Toaster';
import { pipelineFlash } from '@/app/app/candidates/flash';

export type ActionResult = { ok?: string; error?: string };

// How long we wait for the server before giving up on the response and
// refreshing anyway — the actions themselves finish in about a second.
const RESPONSE_TIMEOUT_MS = 15_000;

/**
 * Runs a server action from inside a dialog: toasts the flash for its result,
 * and on success (or a lost response) closes the dialog and refreshes the page
 * itself rather than relying on a redirect.
 */
export function useDialogAction(action: (fd: FormData) => Promise<ActionResult>, close: () => void) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const submit = (formData: FormData) =>
    startTransition(async () => {
      const timeout = new Promise<ActionResult>((resolve) =>
        setTimeout(() => resolve({ error: 'timeout' }), RESPONSE_TIMEOUT_MS)
      );
      let result: ActionResult;
      try {
        result = await Promise.race([action(formData), timeout]);
      } catch {
        result = { error: 'timeout' };
      }
      if (result.error === 'timeout') {
        // The save usually went through even when the response is lost; show the truth.
        toast('error', 'No response from the server — refreshing to show the current state.');
        close();
        router.refresh();
        return;
      }
      const flash = pipelineFlash(result.ok, result.error);
      if (flash) toast(flash.kind, flash.message);
      if (result.ok) {
        close();
        router.refresh();
      }
    });
  return { submit, pending };
}

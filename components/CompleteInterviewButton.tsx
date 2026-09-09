'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import StarRating from '@/components/StarRating';
import { toast } from '@/components/Toaster';
import { pipelineFlash } from '@/app/app/candidates/flash';

type Result = { ok?: string; error?: string };

// How long we wait for the server before giving up on the response and
// refreshing anyway — the action itself finishes in about a second.
const RESPONSE_TIMEOUT_MS = 15_000;

/**
 * "Mark completed" for a held interview: opens a prompt for the star rating and
 * an optional note, then calls the server action, which completes the slot,
 * saves the feedback and moves the candidate to Interview review. The dialog
 * closes and refreshes the page itself rather than relying on a redirect.
 */
export default function CompleteInterviewButton({
  action,
  applicationId,
  slotId,
  candidateName,
  when,
}: {
  action: (formData: FormData) => Promise<Result>;
  applicationId: number;
  slotId: number;
  candidateName: string;
  when: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (formData: FormData) =>
    startTransition(async () => {
      const timeout = new Promise<Result>((resolve) =>
        setTimeout(() => resolve({ error: 'timeout' }), RESPONSE_TIMEOUT_MS)
      );
      let result: Result;
      try {
        result = await Promise.race([action(formData), timeout]);
      } catch {
        result = { error: 'timeout' };
      }
      if (result.error === 'timeout') {
        // The save usually went through even when the response is lost; show the truth.
        toast('error', 'No response from the server — refreshing to show the current state.');
        setOpen(false);
        router.refresh();
        return;
      }
      const flash = pipelineFlash(result.ok, result.error);
      if (flash) toast(flash.kind, flash.message);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Mark completed
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form action={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Complete the interview</DialogTitle>
              <DialogDescription>
                {candidateName} · {when}. Rate the interview to close it out — the feedback is saved, the
                interview is marked completed, and the candidate moves to the review stage and is emailed.
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="slotId" value={slotId} />
            <StarRating label="Interview rating" required />
            <Textarea name="comment" aria-label="Feedback note" placeholder="How did the interview go? (optional)" rows={3} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save and complete'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

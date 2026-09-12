'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import StarRating from '@/components/StarRating';
import { useDialogAction, type ActionResult } from '@/components/useDialogAction';

/**
 * "Mark completed" for a held interview: opens a prompt for the star rating and
 * an optional note, then calls the server action, which completes the slot,
 * saves the feedback and moves the candidate to Interview review.
 */
export default function CompleteInterviewButton({
  action,
  applicationId,
  slotId,
  candidateName,
  when,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  applicationId: number;
  slotId: number;
  candidateName: string;
  when: string;
}) {
  const [open, setOpen] = useState(false);
  const { submit, pending } = useDialogAction(action, () => setOpen(false));

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

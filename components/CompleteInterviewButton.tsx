'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import StarRating from '@/components/StarRating';
import SubmitButton from '@/components/SubmitButton';

/**
 * "Mark completed" for a held interview: opens a prompt for the star rating and
 * an optional note, then submits both to the server action, which completes
 * the slot, saves the feedback and moves the candidate to Interview review.
 */
export default function CompleteInterviewButton({
  action,
  applicationId,
  slotId,
  back,
  candidateName,
  when,
}: {
  action: (formData: FormData) => void | Promise<void>;
  applicationId: number;
  slotId: number;
  back?: string;
  candidateName: string;
  when: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Mark completed
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form action={action} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Complete the interview</DialogTitle>
              <DialogDescription>
                {candidateName} · {when}. Rate the interview to close it out — the feedback is saved, the
                interview is marked completed, and the candidate moves to the review stage and is emailed.
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="slotId" value={slotId} />
            {back && <input type="hidden" name="back" value={back} />}
            <StarRating label="Interview rating" required />
            <Textarea name="comment" aria-label="Feedback note" placeholder="How did the interview go? (optional)" rows={3} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Saving…">Save and complete</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

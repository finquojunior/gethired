'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useDialogAction, type ActionResult } from '@/components/useDialogAction';

export type RescheduleRequestView = {
  id: number;
  applicationId: number;
  candidateName: string;
  currentWhen: string | null;
  requestedLabel: string;
  requestedDate: string; // YYYY-MM-DD, org-local
  requestedTime: string; // HH:MM, org-local
  note: string;
  interviewerId: string | null;
  duration: number;
};

/**
 * Approve / Reject for a pending reschedule request. Approve creates the new
 * slot (time and interviewer prefilled from the request, meeting link required)
 * and books the candidate; Reject keeps the original booking and emails them.
 */
export default function RescheduleDecision({
  request: r,
  people,
  approve,
  reject,
  size = 'sm',
}: {
  request: RescheduleRequestView;
  people: { id: string; full_name: string }[];
  approve: (fd: FormData) => Promise<ActionResult>;
  reject: (fd: FormData) => Promise<ActionResult>;
  size?: 'sm' | 'default';
}) {
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  const a = useDialogAction(approve, () => setOpen(null));
  const j = useDialogAction(reject, () => setOpen(null));
  const pending = a.pending || j.pending;

  return (
    <span className="flex items-center gap-2">
      <Button type="button" size={size} onClick={() => setOpen('approve')}>Approve</Button>
      <Button type="button" size={size} variant="outline" onClick={() => setOpen('reject')}>Reject</Button>

      <Dialog open={open === 'approve'} onOpenChange={(o) => !pending && setOpen(o ? 'approve' : null)}>
        <DialogContent>
          <form action={a.submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Reschedule {r.candidateName}</DialogTitle>
              <DialogDescription>
                Creates a new slot at this time and books {r.candidateName} into it. Their current slot
                {r.currentWhen ? ` (${r.currentWhen})` : ''} is released. The candidate and the interviewer are emailed.
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" name="requestId" value={r.id} />
            <input type="hidden" name="applicationId" value={r.applicationId} />
            {r.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">Candidate&apos;s note: {r.note}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <Label htmlFor={`rs-date-${r.id}`}>Date</Label>
                <Input id={`rs-date-${r.id}`} type="date" name="date" defaultValue={r.requestedDate} required />
              </Field>
              <Field>
                <Label htmlFor={`rs-time-${r.id}`}>Time</Label>
                <Input id={`rs-time-${r.id}`} type="time" name="time" defaultValue={r.requestedTime} required />
              </Field>
              <Field>
                <Label htmlFor={`rs-int-${r.id}`}>Interviewer</Label>
                <NativeSelect id={`rs-int-${r.id}`} name="interviewerId" defaultValue={r.interviewerId ?? undefined} required>
                  {people.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>{p.full_name}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <Label htmlFor={`rs-dur-${r.id}`}>Minutes</Label>
                <Input id={`rs-dur-${r.id}`} type="number" name="duration" min={5} defaultValue={r.duration} required />
              </Field>
            </div>
            <Field>
              <Label htmlFor={`rs-link-${r.id}`}>Meeting link / location (sent to the candidate)</Label>
              <Input id={`rs-link-${r.id}`} name="meetingLink" placeholder="https://meet.google.com/… or office address" required />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(null)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>{a.pending ? 'Rescheduling…' : 'Create slot and confirm'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'reject'} onOpenChange={(o) => !pending && setOpen(o ? 'reject' : null)}>
        <DialogContent>
          <form action={j.submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Decline the request</DialogTitle>
              <DialogDescription>
                {r.candidateName} asked for {r.requestedLabel}. Their current booking
                {r.currentWhen ? ` on ${r.currentWhen}` : ''} stays as is, and they are emailed that it stands.
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" name="requestId" value={r.id} />
            <input type="hidden" name="applicationId" value={r.applicationId} />
            <Textarea name="note" aria-label="Reason" placeholder="Optional line for the email, e.g. the panel is unavailable that week." rows={3} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(null)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={pending}>{j.pending ? 'Sending…' : 'Decline and email'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </span>
  );
}

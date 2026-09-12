'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * "Cancel booking" on the candidate portal. Cancelling means one of two things:
 * withdraw the application, or reschedule — so the dialog asks which, and only
 * the withdraw path submits anything.
 */
export default function CancelBookingDialog({ role, withdrawAction }: { role: string; withdrawAction: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="lg" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this interview?</DialogTitle>
            <DialogDescription>
              Are you no longer interested in the {role} position? Withdrawing releases your slot and closes your
              application — we&apos;ll email you a confirmation. If you still want the role but can&apos;t make this
              time, reschedule instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                document.getElementById('reschedule')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            >
              No, I want to reschedule
            </Button>
            <form method="post" action={withdrawAction}>
              <Button type="submit" variant="destructive">Yes, withdraw my application</Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

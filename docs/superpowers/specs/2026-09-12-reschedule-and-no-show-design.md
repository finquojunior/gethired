# Interview reschedule requests and no-show rejection

Agreed 2026-09-12. Two additions to the interview stage.

## Candidate portal, once a slot is booked

Until 1 hour before the slot, the booking card offers:

- **Pick another slot.** The open-slot list appears under the booking. Choosing one
  swaps the booking in a single transaction: old slot released, new one booked,
  candidate gets the booking confirmation, interviewers get cancelled/booked mails.
  No staff action.
- **Request another day.** Date, time (org-local) and a note. Creates a pending
  request. The original slot stays booked until staff decide. Candidate is emailed
  `reschedule_requested`; the interviewer gets `interviewer_reschedule_requested`.
- **Cancel booking.** Opens "Are you no longer interested in this position?" Yes
  withdraws the application (existing withdraw route). No closes the dialog and
  points at the two options above. The unconditional cancel route is removed.

Inside the last hour only withdraw remains. After a decision the portal shows the
outcome: approved shows the new booking; rejected shows a notice with the original
time still standing and the reschedule options still available.

## Staff

- **Interviews page**: "Reschedule requests" section above "To close out". Approve
  opens a dialog prefilled with the requested time, original interviewer, panel and
  duration, plus a required meeting link. Confirming creates the slot, books the
  candidate, releases the old slot (even if it is now in the past), marks the request
  approved, emails `reschedule_approved` with an .ics and `interviewer_booked`.
  Reject takes an optional note and emails `reschedule_rejected`.
- **Candidate page**: the pending request with the same two buttons; timeline rows
  for requested / approved / rejected / no-show.
- **No-show**: on the close-out list and the candidate page for a past, uncompleted
  slot with no pending request. Sets `slots.no_show_at`, rejects the candidate,
  emails `no_show`, frees other future slots. Restore to active clears the mark.
  Close-out excludes slots with a pending request and slots marked no-show.

## Data

- `public.reschedule_requests`: application, slot, stage, requested_at, note,
  status (pending / approved / rejected), decided_by, decided_at, decision_note.
  One pending request per application per stage.
- `public.slots.no_show_at timestamptz`.

## Emails (new default templates, editable in Settings)

`reschedule_requested`, `reschedule_approved`, `reschedule_rejected`, `no_show`,
`interviewer_reschedule_requested`.

## Out of scope

Dashboard count of pending requests; blocking submissions after a task "No".

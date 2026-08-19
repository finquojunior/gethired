import { q } from '@/lib/db';
import { appUrl, attemptSend, sendEmail } from '@/lib/email';
import { fmtDateTimeFull } from '@/lib/tz';

// The periodic work: deliver/retry the outbox, interview reminders, feedback
// nudges, auto-close openings. Called by /api/cron, the outbox "process now"
// button, and the local ticker in instrumentation.ts.
export async function runCronWork() {
  // 1. deliver due outbox rows (incl. delayed rejections and failed retries)
  const { rows: due } = await q<{ id: number }>(
    `select id from public.email_log
     where status in ('pending', 'failed') and send_after <= now() and attempts < 3
     order by id limit 100`
  );
  for (const r of due) await attemptSend(r.id);

  // 2. interview reminders (24h ahead, once)
  const { rows: upcoming } = await q<{
    application_id: number;
    name: string;
    email: string;
    title: string;
    starts_at: Date;
    duration_mins: number;
    interviewer: string;
    meeting_link: string;
  }>(
    `select a.id as application_id, a.name, a.email, o.title,
            sl.starts_at, sl.duration_mins, p.full_name as interviewer, sl.meeting_link
     from public.slots sl
     join public.applications a on a.id = sl.application_id
     join public.openings o on o.id = a.opening_id
     join public.profiles p on p.id = sl.interviewer_id
     where sl.starts_at between now() and now() + interval '24 hours'
       and a.status = 'active'
       and not exists (
         select 1 from public.email_log e
         where e.application_id = a.id and e.template = 'interview_reminder'
           and e.created_at > now() - interval '2 days'
       )`
  );
  for (const r of upcoming) {
    await sendEmail({
      applicationId: r.application_id,
      template: 'interview_reminder',
      to: r.email,
      vars: {
        name: r.name,
        role: r.title,
        when: fmtDateTimeFull(r.starts_at),
        duration: String(r.duration_mins),
        interviewer: r.interviewer,
        link: r.meeting_link,
      },
    });
  }

  // 3. feedback nudges: interview ended, no feedback from that interviewer
  const { rows: pendingFeedback } = await q<{
    application_id: number;
    name: string;
    title: string;
    interviewer_email: string | null;
  }>(
    `select distinct a.id as application_id, a.name, o.title,
            (select u.email from auth.users u where u.id = sl.interviewer_id) as interviewer_email
     from public.slots sl
     join public.applications a on a.id = sl.application_id
     join public.openings o on o.id = a.opening_id
     where sl.starts_at + make_interval(mins => sl.duration_mins) < now()
       and sl.starts_at > now() - interval '2 days'
       and a.status = 'active'
       and not exists (
         select 1 from public.feedback f
         where f.application_id = a.id and f.author_id = sl.interviewer_id
       )
       and not exists (
         select 1 from public.email_log e
         where e.application_id = a.id and e.template = 'feedback_nudge'
           and e.created_at > now() - interval '2 days'
       )`
  );
  for (const r of pendingFeedback) {
    if (!r.interviewer_email) continue;
    await sendEmail({
      applicationId: r.application_id,
      template: 'feedback_nudge',
      to: r.interviewer_email,
      vars: {
        name: r.name,
        role: r.title,
        profile_link: appUrl(`/app/candidates/${r.application_id}`),
      },
    });
  }

  // 4. auto-close openings past their close date
  const { rowCount: closed } = await q(
    `update public.openings set status = 'closed'
     where status = 'open' and close_at is not null and close_at <= now()`
  );

  return {
    delivered: due.length,
    reminded: upcoming.length,
    nudged: pendingFeedback.length,
    closed: closed ?? 0,
  };
}

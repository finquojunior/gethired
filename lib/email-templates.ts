// Default email templates: subject/body/vars. Pure data, no node imports — so
// this stays importable (and testable) without pulling in the DB pool.
// Staff can override subject/body per key in public.email_templates.

// candidate-facing sign-off, appended to every template a candidate receives
const SIGN = `\n\n— The {{org}} hiring team\nQuestions? Reply to this email or write to {{support_email}}.`;

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; vars: string[] }> = {
  application_received: {
    subject: 'Application received — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nThanks for applying for {{role}}. We've received your application and will be in touch.\n\nTrack your application status any time:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'portal_link'],
  },
  interview_invite: {
    subject: 'Interview round — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nGood news — you're moving to the interview round for {{role}}.\n\nPick an interview slot that works for you here:\n{{portal_link}}\n\nSee you soon!` + SIGN,
    vars: ['name', 'role', 'portal_link'],
  },
  task_assigned: {
    subject: 'Your task for {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYou've progressed to the task round for {{role}}.\n\n{{brief}}\n\nSubmit your work here:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'brief', 'portal_link'],
  },
  booking_confirmation: {
    subject: 'Interview confirmed — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYour interview for {{role}} is confirmed:\n\n{{when}} ({{duration}} minutes) with {{interviewer}}.\n{{link}}\n\nNeed to change it? Use your status page up to 24 hours before.\n` + SIGN,
    vars: ['name', 'role', 'when', 'duration', 'interviewer', 'link'],
  },
  interview_reminder: {
    subject: 'Reminder: your interview tomorrow — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nA reminder about your interview for {{role}}:\n\n{{when}} ({{duration}} minutes) with {{interviewer}}.\n{{link}}\n\nGood luck!\n` + SIGN,
    vars: ['name', 'role', 'when', 'duration', 'interviewer', 'link'],
  },
  stage_update: {
    subject: 'Application update — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYour application for {{role}} is now at the {{stage}} stage.\n\nTrack your application any time:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'stage', 'portal_link'],
  },
  hired: {
    subject: 'Congratulations — {{role}} at {{org}}!',
    body: `Hi {{name}},\n\nCongratulations! We're delighted to let you know you've been selected for {{role}}.\n\nOur team will reach out shortly with the next steps and your offer details.\n\nWelcome aboard!` + SIGN,
    vars: ['name', 'role'],
  },
  rejection: {
    subject: 'Update on your application — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nThank you for applying for {{role}}. After careful review we won't be moving forward with your application this time.\n\nWe'd love to see you apply again for future roles — see what's open at {{careers_link}}\n` + SIGN,
    vars: ['name', 'role', 'careers_link'],
  },
  booking_cancelled: {
    subject: 'Interview cancelled — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYour interview for {{role}} on {{when}} has been cancelled by our team.\n\nIf there are open slots you can pick a new time on your status page:\n{{portal_link}}\n\nOtherwise we'll be in touch to reschedule.\n` + SIGN,
    vars: ['name', 'role', 'when', 'portal_link'],
  },
  task_received: {
    subject: 'We received your task — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nThanks — we've received your task submission for {{role}}:\n\n{{items}}\n\nYou can add a newer version any time before the deadline from your status page:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'items', 'portal_link'],
  },
  task_reminder: {
    subject: 'Reminder: your task is due {{deadline}} — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nA quick reminder that your task for {{role}} is due {{deadline}}.\n\nSubmit it here:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'deadline', 'portal_link'],
  },
  withdrawn: {
    subject: 'Application withdrawn — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYou've withdrawn your application for {{role}}. Thanks for your interest — we'd be glad to see you apply again in future.\n\nIf this was a mistake, reply to this email and we'll restore it.\n` + SIGN,
    vars: ['name', 'role'],
  },
  task_review: {
    subject: 'Your task for {{role}} is under review — {{org}}',
    body: `Hi {{name}},\n\nThanks for sending in your task for {{role}}. Your submission is now under review and we'll get back to you with the next step.\n\nYour application status:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'portal_link'],
  },
  interview_review: {
    subject: 'Thanks for interviewing — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nThanks for taking the time to interview for {{role}}. Your interview is complete and your application is now under review; we'll be in touch with the outcome.\n\nYour application status:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'portal_link'],
  },
  interviewer_booked: {
    subject: 'Interview booked: {{name}} — {{role}}',
    body: `{{name}} booked an interview with you for {{role}}:\n\n{{when}} ({{duration}} minutes).\n\nCandidate profile: {{profile_link}}\n`,
    vars: ['name', 'role', 'when', 'duration', 'profile_link'],
  },
  interviewer_cancelled: {
    subject: 'Interview cancelled: {{name}} — {{role}}',
    body: `The interview with {{name}} for {{role}} on {{when}} was cancelled and the slot has been freed.\n`,
    vars: ['name', 'role', 'when'],
  },
  reschedule_requested: {
    subject: 'We received your reschedule request — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nWe've received your request to move your {{role}} interview to {{requested}}.\n\nUntil the team confirms, your current interview slot on {{when}} still stands — please keep it free. We'll email you as soon as there's a decision, usually within a working day.\n\nYou can check the status any time:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'when', 'requested', 'portal_link'],
  },
  reschedule_approved: {
    subject: 'Interview rescheduled — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYour reschedule request has been approved. Your {{role}} interview is now:\n\n{{when}} ({{duration}} minutes) with {{interviewer}}.\n{{link}}\n\nYour previous slot has been released. A calendar invite is attached.\n\nYour status page:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'when', 'duration', 'interviewer', 'link', 'portal_link'],
  },
  reschedule_rejected: {
    subject: 'About your reschedule request — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nUnfortunately we couldn't accommodate your request to move the interview to {{requested}}.\n\nYour interview remains scheduled for {{when}}. {{reason}}\n\nIf that time doesn't work, you can still pick another open slot on your status page up to an hour before the interview:\n{{portal_link}}\n` + SIGN,
    vars: ['name', 'role', 'when', 'requested', 'reason', 'portal_link'],
  },
  no_show: {
    subject: 'Update on your application — {{role}} at {{org}}',
    body: `Hi {{name}},\n\nYour interview for {{role}} was scheduled for {{when}}, but you did not attend and we didn't hear from you beforehand. As a result, we are closing your application for this role.\n\nIf something serious prevented you from attending, reply to this email and let us know — we'll take a look.\n\nYou're welcome to apply for future roles — see what's open at {{careers_link}}\n` + SIGN,
    vars: ['name', 'role', 'when', 'careers_link'],
  },
  interviewer_reschedule_requested: {
    subject: 'Reschedule requested: {{name}} — {{role}}',
    body: `{{name}} has asked to move their {{role}} interview from {{when}} to {{requested}}.\n\nTheir note: {{note}}\n\nThe current slot stays booked until someone approves or rejects the request here: {{requests_link}}\n`,
    vars: ['name', 'role', 'when', 'requested', 'note', 'requests_link'],
  },
  feedback_nudge: {
    subject: 'Feedback pending: {{name}} — {{role}}',
    body: `Your interview with {{name}} for {{role}} has ended, and no feedback has been recorded yet.\n\nAdd your verdict here: {{profile_link}}\n`,
    vars: ['name', 'role', 'profile_link'],
  },
};

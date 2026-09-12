#!/usr/bin/env node
// LOCAL-ONLY sample data for reviewing the app on the embedded Postgres.
// Wipes every application/opening table and re-creates a realistic pipeline.
// Logins (all password "devadmin"): dev-admin@example.com (admin),
// priya@example.com (hr), arjun@example.com (dept_head, Development),
// sara@example.com (interviewer).
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const c = new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', database: 'gethired' });
await c.connect();
const hash = (pw) => { const s = randomBytes(16).toString('hex'); return `${s}:${scryptSync(pw, s, 64).toString('hex')}`; };
const ADMIN = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-000000000002';
const HEAD = '00000000-0000-0000-0000-000000000003';
const IV = '00000000-0000-0000-0000-000000000004';
const daysAgo = (d, h = 10) => new Date(Date.now() - d * 86400e3 - (10 - h) * 3600e3);

await c.query(`truncate public.audit_log, public.error_log, public.email_log, public.feedback, public.notes, public.submissions,
  public.task_responses, public.stage_history, public.slots, public.applications, public.opening_members, public.forms,
  public.stages, public.openings, public.user_departments, public.departments restart identity cascade`);

for (const [id, email, name, role] of [[HR, 'priya@example.com', 'Priya Nair', 'hr'], [HEAD, 'arjun@example.com', 'Arjun Menon', 'dept_head'], [IV, 'sara@example.com', 'Sara Thomas', 'interviewer']]) {
  await c.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email`, [id, email]);
  await c.query(`insert into public.profiles (id, full_name, role, password_hash) values ($1, $2, $3, $4)
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, password_hash = excluded.password_hash`, [id, name, role, hash('devadmin')]);
}
const { rows: depts } = await c.query(`insert into public.departments (name) values ('Creative'), ('Development'), ('Content'), ('Marketing') returning id, name`);
const dept = Object.fromEntries(depts.map((d) => [d.name, d.id]));
await c.query(`insert into public.user_departments (user_id, department_id) values ($1, $2)`, [HEAD, dept.Development]);

const schema = {
  pages: [
    { title: 'About you', fields: [
      { id: 'portfolio', type: 'url', label: 'Portfolio or GitHub', help: 'A link we can open', required: true },
      { id: 'exp', type: 'multiple_choice', label: 'Years of relevant experience', required: true, options: ['0–1', '1–3', '3–5', '5+'], points: { '0–1': 1, '1–3': 2, '3–5': 3, '5+': 4 } },
      { id: 'stack', type: 'checkboxes', label: 'Which of these have you shipped to production?', options: ['React', 'Node.js', 'Postgres', 'Figma'] },
    ] },
    { title: 'Fit', fields: [
      { id: 'why', type: 'long_text', label: 'Why this role?', required: true },
      { id: 'relocate', type: 'yes_no', label: 'Can you work from our Kochi office?', required: true, points: { Yes: 2, No: 0 } },
      { id: 'notice', type: 'dropdown', label: 'Notice period', options: ['Immediate', '15 days', '30 days', '60 days'] },
    ] },
  ],
};
const openings = [
  ['senior-full-stack-developer', 'Senior Full Stack Developer', 'Development', 'open', 'Kochi (hybrid)', 'Full-time', '₹18–28 LPA', 'Own the hiring platform end to end: Next.js, Postgres, and a small team that ships weekly.'],
  ['graphic-designer-intern', 'Graphic Designer Intern', 'Creative', 'open', 'Remote', 'Internship', '₹15,000/month', 'Six-month internship on the brand team. Figma, motion basics, and a lot of social creatives.'],
  ['content-writer-intern', 'Content Writer Intern', 'Content', 'open', 'Kochi', 'Internship', '₹12,000/month', 'Write for the blog, the newsletter, and the careers site. Portfolio matters more than a degree.'],
  ['social-media-intern', 'Social Media Intern', 'Marketing', 'draft', 'Remote', 'Internship', '', ''],
];
const O = {};
for (const [slug, title, department, status, location, type, salary, desc] of openings) {
  const { rows: [o] } = await c.query(
    `insert into public.openings (slug, title, department, status, location, employment_type, salary_range, description, created_by, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - interval '30 days') returning id`,
    [slug, title, department, status, location, type, salary, desc, ADMIN]);
  const { rows: [f] } = await c.query(`insert into public.forms (opening_id, schema, is_published, version) values ($1, $2, true, 1) returning id`, [o.id, JSON.stringify(schema)]);
  await c.query(`insert into public.forms (opening_id, schema, is_published, version) values ($1, $2, false, 2)`, [o.id, JSON.stringify(schema)]);
  const stageRows = [['Applied', 'screen'], ['Shortlist', 'screen'], ['Task', 'task'], ['Task review', 'task_review'], ['Interview', 'interview'], ['Interview review', 'interview_review'], ['Offer', 'offer']];
  const S = {};
  for (const [i, [name, kind]] of stageRows.entries()) {
    const { rows: [s] } = await c.query(
      `insert into public.stages (opening_id, name, kind, position, brief, brief_links, task_days, submission_fields) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [o.id, name, kind, i,
        kind === 'task' ? `Build a small feature end to end and send us the repo.\n\nWe look at how you structure the work, not at polish. Two evenings is plenty.` : '',
        kind === 'task' ? 'https://github.com/vercel/next.js\nhttps://www.postgresql.org/docs/' : '',
        kind === 'task' ? 5 : 0,
        JSON.stringify(kind === 'task' ? [{ id: 'repo', title: 'Repository link', kind: 'link', required: true }, { id: 'notes', title: 'Short write-up (PDF)', kind: 'file', required: false }] : [])]);
    S[name] = s.id;
  }
  O[slug] = { id: o.id, formId: f.id, S, title };
}
await c.query(`insert into public.opening_members (opening_id, user_id, member_role) values ($1, $2, 'requester'), ($3, $4, 'interviewer')`,
  [O['senior-full-stack-developer'].id, HEAD, O['graphic-designer-intern'].id, IV]);

const first = ['Aarav', 'Diya', 'Ishaan', 'Meera', 'Rohan', 'Ananya', 'Kabir', 'Nila', 'Vihaan', 'Sana', 'Aditya', 'Lakshmi', 'Farhan', 'Riya', 'Nikhil', 'Zara', 'Devika', 'Arjun', 'Hana', 'Yusuf', 'Tara', 'Manav', 'Anjali', 'Rehan', 'Pooja', 'Siddharth', 'Neha', 'Imran', 'Kavya', 'Joel'];
const last = ['Menon', 'Iyer', 'Khan', 'Nair', 'Pillai', 'Thomas', 'Verma', 'Das', 'Rahman', 'Shetty', 'Joseph', 'Kurup', 'Bose', 'Mathew', 'Reddy'];
const plans = [
  ['senior-full-stack-developer', [['Applied', 5], ['Shortlist', 3], ['Task', 4], ['Interview', 5], ['Offer', 1]], 2, 1],
  ['graphic-designer-intern', [['Applied', 4], ['Task', 2], ['Interview', 1]], 1, 0],
  ['content-writer-intern', [['Applied', 3], ['Shortlist', 1]], 1, 1],
];
let n = 0;
const apps = [];
for (const [slug, dist, rejected, hired] of plans) {
  const o = O[slug];
  const make = async (stage, status, i) => {
    const name = `${first[n % first.length]} ${last[(n * 7) % last.length]}`;
    const email = `${name.toLowerCase().replace(/ /g, '.')}${n}@example.com`;
    n++;
    const exp = ['0–1', '1–3', '3–5', '5+'][n % 4];
    const answers = { portfolio: `https://github.com/${name.split(' ')[0].toLowerCase()}`, exp, stack: ['React', 'Node.js'].slice(0, (n % 2) + 1), why: 'I have followed the team for a while and want to work on a product used by real candidates every day.', relocate: n % 3 ? 'Yes' : 'No', notice: '30 days' };
    const score = { '0–1': 1, '1–3': 2, '3–5': 3, '5+': 4 }[exp] + (answers.relocate === 'Yes' ? 2 : 0);
    const { rows: [a] } = await c.query(
      `insert into public.applications (opening_id, form_id, name, email, phone, answers, score, max_score, current_stage_id, status, tags, created_at, consented_at, resume_path)
       values ($1,$2,$3,$4,$5,$6,$7,6,$8,$9,$10,$11,$11,$12) returning id, portal_token`,
      [o.id, o.formId, name, email, `+91 98${String(10000000 + n * 7919).slice(0, 8)}`, JSON.stringify(answers), score, o.S[stage], status,
        n % 4 === 0 ? ['strong-portfolio'] : n % 5 === 0 ? ['referral', 'urgent'] : [], daysAgo(20 - (n % 18), 9 + (n % 8)), n % 3 ? '' : `resumes/${'0123456789abcdef01234567'}.pdf`]);
    // history up to the current stage
    const order = ['Applied', 'Shortlist', 'Task', 'Interview', 'Offer'];
    for (let k = 1; k <= order.indexOf(stage); k++) {
      await c.query(`insert into public.stage_history (application_id, from_stage_id, to_stage_id, changed_by, created_at) values ($1,$2,$3,$4,$5)`,
        [a.id, o.S[order[k - 1]], o.S[order[k]], ADMIN, daysAgo(14 - k * 3, 11)]);
    }
    await c.query(`insert into public.email_log (application_id, template, to_email, subject, body, status, sent_at, service, created_at)
      values ($1,'application_received',$2,$3,$4,'sent',$5,'resend',$5)`, [a.id, email, `Application received — ${o.title} at Finquo Junior`, `Hi ${name},\n\nThanks for applying for ${o.title}.`, daysAgo(20 - (n % 18), 9)]);
    if (stage === 'Task') {
      await c.query(`insert into public.email_log (application_id, template, to_email, subject, body, status, sent_at, service) values ($1,'task_assigned',$2,$3,'Your task…','sent',now() - interval '4 days','resend')`, [a.id, email, `Your task for ${o.title} at Finquo Junior`]);
      await c.query(`insert into public.task_responses (application_id, stage_id, response) values ($1,$2,$3)`, [a.id, o.S.Task, i % 3 === 2 ? 'no' : 'yes']);
      if (i % 2 === 0) {
        await c.query(`insert into public.submissions (application_id, stage_id, field_id, title, file_path, link_url, note, file_name, created_at) values
          ($1,$2,'repo','Repository link','', $3, 'Deployed at vercel too', '', now() - interval '2 days'),
          ($1,$2,'notes','Short write-up (PDF)','submissions/0123456789abcdef01234567.pdf','', '', 'writeup-final.pdf', now() - interval '2 days')`, [a.id, o.S.Task, `https://github.com/${name.split(' ')[0].toLowerCase()}/hiring-task`]);
      }
    }
    if (stage === 'Interview') {
      await c.query(`insert into public.email_log (application_id, template, to_email, subject, body, status, sent_at, service) values ($1,'interview_invite',$2,$3,'Pick a slot…','sent',now() - interval '1 day','resend')`, [a.id, email, `Interview round — ${o.title} at Finquo Junior`]);
    }
    if (i === 0 && stage === 'Applied') {
      await c.query(`insert into public.email_log (application_id, template, to_email, subject, body, status, error, attempts, service) values ($1,'application_received',$2,'Application received','…','failed','resend 429: rate limited',3,'resend')`, [a.id, email]);
    }
    apps.push({ id: a.id, name, email, token: a.portal_token, opening: slug, stage, status });
    return a;
  };
  for (const [stage, count] of dist) for (let i = 0; i < count; i++) await make(stage, 'active', i);
  for (let i = 0; i < rejected; i++) {
    const a = await make('Shortlist', 'rejected', i);
    await c.query(`insert into public.email_log (application_id, template, to_email, subject, body, status) values ($1,'rejection',$2,$3,'Thank you…',$4)`,
      [a.id, apps.at(-1).email, `Update on your application — ${o.title} at Finquo Junior`, i === 0 ? 'draft' : 'sent']);
  }
  for (let i = 0; i < hired; i++) await make('Offer', 'hired', i);
}

// interview slots: Senior FSD tomorrow evening, 20-minute slots, most booked; Creative next week, none booked
const fsd = O['senior-full-stack-developer'];
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(17, 0, 0, 0);
const inFsdInterview = apps.filter((a) => a.opening === 'senior-full-stack-developer' && a.stage === 'Interview');
for (let i = 0; i < 8; i++) {
  const starts = new Date(tomorrow.getTime() + i * 20 * 60e3);
  const booked = inFsdInterview[i];
  await c.query(`insert into public.slots (opening_id, stage_id, interviewer_id, starts_at, duration_mins, meeting_link, panel, application_id) values ($1,$2,$3,$4,20,'https://meet.google.com/abc-defg-hij',$5,$6)`,
    [fsd.id, fsd.S.Interview, HEAD, starts, i % 2 ? [IV] : [], booked && i < 4 ? booked.id : null]);
  if (booked && i < 4) {
    await c.query(`insert into public.email_log (application_id, template, to_email, subject, body, status, sent_at, service) values ($1,'booking_confirmation',$2,'Interview confirmed — Senior Full Stack Developer at Finquo Junior','…','sent',now() - interval '20 hours','gmail')`, [booked.id, booked.email]);
  }
}
const gd = O['graphic-designer-intern'];
const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 6); nextWeek.setHours(11, 0, 0, 0);
for (let i = 0; i < 3; i++) {
  await c.query(`insert into public.slots (opening_id, stage_id, interviewer_id, starts_at, duration_mins, meeting_link, panel) values ($1,$2,$3,$4,30,'Office, 3rd floor',$5)`,
    [gd.id, gd.S.Interview, IV, new Date(nextWeek.getTime() + i * 30 * 60e3), []]);
}
// a past interview with feedback pending, plus some feedback and notes
const past = inFsdInterview[4];
if (past) {
  await c.query(`insert into public.slots (opening_id, stage_id, interviewer_id, starts_at, duration_mins, application_id) values ($1,$2,$3, now() - interval '26 hours', 20, $4)`, [fsd.id, fsd.S.Interview, IV, past.id]);
}
for (const a of apps.filter((x) => x.stage === 'Task' || x.stage === 'Interview').slice(0, 5)) {
  await c.query(`insert into public.feedback (application_id, stage_id, author_id, rating, comment) values ($1,$2,$3,$4,$5)`,
    [a.id, O[a.opening].S[a.stage], HR, 3 + (a.id % 3), 'Clear thinking in the write-up, a bit slow on the live coding part. Would move forward.']);
  await c.query(`insert into public.notes (application_id, author_id, body) values ($1,$2,'Referred by the design team lead — prioritise.')`, [a.id, ADMIN]);
}
await c.query(`insert into public.email_templates (key, subject, body) values ('interview_reminder', 'Reminder: your interview tomorrow — {{role}}', 'Hi {{name}},\n\nSee you at {{when}}.') on conflict (key) do nothing`);

console.log(`seeded ${apps.length} applications across ${Object.keys(O).length} openings`);
const sample = apps.find((a) => a.stage === 'Interview' && a.opening === 'senior-full-stack-developer' && !inFsdInterview.slice(0, 4).includes(a));
const taskOne = apps.find((a) => a.stage === 'Task');
console.log(`portal (interview, can book): http://localhost:3002/c/${sample?.token}`);
console.log(`portal (task round):         http://localhost:3002/c/${taskOne?.token}`);
// sample rows above point at these two files; a one-page PDF so the resume preview and downloads work
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 24 Tf 72 760 Td (Sample document - seed-dev) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;
for (const kind of ['resumes', 'submissions']) {
  mkdirSync(`db/files/${kind}`, { recursive: true });
  writeFileSync(`db/files/${kind}/0123456789abcdef01234567.pdf`, PDF);
}
await c.end();

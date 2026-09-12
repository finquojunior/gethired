import Link from 'next/link';
import BackButton from '@/components/BackButton';
import { notFound } from 'next/navigation';
import { q } from '@/lib/db';
import SubmitButton from '@/components/SubmitButton';
import RichTextArea from '@/components/RichTextArea';
import { canAccessOpening, currentUser, departmentScope, isStaff } from '@/lib/auth';
import { POSTER_ACCEPT } from '@/lib/uploads';
import { fmtDate } from '@/lib/tz';
import { AlertTriangle } from 'lucide-react';
import Flash from '@/components/Flash';
import DownloadLink from '@/components/DownloadLink';
import OpeningTabs from '@/components/OpeningTabs';
import { cloneOpening, deleteOpeningData, updateOpening } from '../actions';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const {
    rows: [o],
  } = await q<{ title: string }>('select title from public.openings where id = $1', [Number(id)]);
  return { title: o ? o.title : 'Opening' };
}

export default async function OpeningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { e, ok } = await searchParams;
  const user = await currentUser();
  const {
    rows: [o],
  } = await q<{
    id: number;
    slug: string;
    title: string;
    department: string;
    description: string;
    status: string;
    location: string;
    employment_type: string;
    salary_range: string;
    close_at: Date | null;
    notes: string;
    consent_text: string;
    poster_path: string;
    published_version: number | null;
    applications: string;
    stage_count: number;
    task_stages: number;
    task_missing: number;
    open_slots: number;
    has_interview: boolean;
    team_count: number;
  }>(
    `select o.*,
            (select version from public.forms f where f.opening_id = o.id and f.is_published) as published_version,
            (select count(*) from public.applications a where a.opening_id = o.id) as applications,
            (select count(*)::int from public.stages s where s.opening_id = o.id) as stage_count,
            (select count(*)::int from public.stages s where s.opening_id = o.id and s.kind = 'task') as task_stages,
            (select count(*)::int from public.stages s where s.opening_id = o.id and s.kind = 'task'
               and s.brief = '' and s.brief_file_path = '' and s.brief_links = '') as task_missing,
            (select count(*)::int from public.slots sl where sl.opening_id = o.id
               and sl.application_id is null and sl.starts_at > now()) as open_slots,
            exists (select 1 from public.stages s where s.opening_id = o.id and s.kind = 'interview') as has_interview,
            (select count(*)::int from public.opening_members m where m.opening_id = o.id) as team_count
     from public.openings o where o.id = $1`,
    [Number(id)]
  );
  if (!o || !(await canAccessOpening(user, Number(id)))) notFound();
  const myDepartments = await departmentScope(user);
  const { rows: allDepartments } = await q<{ name: string }>(`select name from public.departments order by name`);
  // staff pick any department; members pick among theirs (the current one always stays selectable)
  const deptOptions = [...new Set([o.department, ...(myDepartments ?? allDepartments.map((d) => d.name))].filter(Boolean))];

  const href = (tab: string) => `/app/openings/${o.id}/${tab}`;
  const setup: Array<{ ok: boolean; text: string; href: string; warn?: boolean }> = [
    {
      ok: !!o.published_version,
      text: o.published_version ? `Application form published (v${o.published_version})` : 'Application form not published — candidates cannot apply',
      href: href('form'),
      warn: !o.published_version && o.status === 'open',
    },
    { ok: o.stage_count > 0, text: `${o.stage_count} stage${o.stage_count === 1 ? '' : 's'}`, href: href('stages') },
    ...(o.task_stages > 0
      ? [{ ok: o.task_missing === 0, text: o.task_missing === 0 ? 'Task brief set' : `Task brief missing on ${o.task_missing} task stage${o.task_missing === 1 ? '' : 's'}`, href: href('task') }]
      : []),
    ...(o.has_interview
      ? [{ ok: o.open_slots > 0, text: o.open_slots > 0 ? `${o.open_slots} open interview slot${o.open_slots === 1 ? '' : 's'}` : 'No open interview slots', href: href('slots') }]
      : []),
    { ok: o.team_count > 0, text: o.team_count > 0 ? `${o.team_count} team member${o.team_count === 1 ? '' : 's'}` : 'No team members added', href: href('team') },
    { ok: o.status === 'open', text: `Status: ${o.status}`, href: '#status' },
  ];

  return (
    <div>
      <Flash
        kind={ok ? 'success' : 'error'}
        message={ok === 'saved' ? 'Opening saved' : ok === 'created' ? 'Opening created — work through the setup checklist below' : ok === 'cloned' ? 'Draft created — a copy with the same stages, form, task brief and team' : e === 'poster' ? 'Saved — but the poster was not accepted (JPG, PNG, or WebP up to 3 MB).' : e === 'slug' ? 'Not saved — that public link is empty or already used.' : e === 'department' ? 'Not saved — pick a department you belong to from the list.' : null}
      />
      <BackButton fallback="/app/openings" />
      <div className="track flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{o.title}</h1>
        <div className="flex flex-wrap gap-2 pb-1">
          <Link href={`/app/openings/${o.id}/applications`} className={buttonVariants()}>
            Pipeline ({o.applications})
          </Link>
          {isStaff(user) && (
            <form action={cloneOpening}>
              <input type="hidden" name="openingId" value={o.id} />
              <SubmitButton variant="outline" pendingLabel="Cloning…" title="New draft opening with the same stages, form, task brief, and team">
                Clone opening
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
      <OpeningTabs openingId={o.id} current="overview" />

      {o.status === 'open' && (
        <p className="mt-4 text-sm text-muted-foreground">
          Public link:{' '}
          <a href={`/careers/${o.slug}`} target="_blank" rel="noopener" className="font-medium text-primary underline">
            /careers/{o.slug}
          </a>{' '}
          — use this in your Meta ads.
        </p>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-display text-lg font-semibold">Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {setup.map((s) => (
              <li key={s.text} className={s.warn ? 'text-destructive' : ''}>
                <span aria-hidden className={`mr-2 ${s.ok ? 'text-primary' : 'text-amber'}`}>{s.ok ? '✓' : '○'}</span>
                <Link href={s.href} className="hover:underline">{s.text}</Link>
              </li>
            ))}
          </ul>
          {o.status === 'open' && !o.published_version && (
            <Alert variant="destructive" className="mt-3">
              <AlertTriangle />
              <AlertTitle>This opening is open but has no published form</AlertTitle>
              <AlertDescription>
                The public page shows nothing to fill in. <Link href={href('form')}>Publish the form</Link>.
              </AlertDescription>
            </Alert>
          )}
          {o.status === 'draft' && (
            <p className="mt-2 text-xs text-muted-foreground">
              Order of play: publish the form, check the stages, set the task brief and interview slots if you use those
              stages, then set the status to <strong>open</strong> below. Paused hides the public page but keeps the
              pipeline; closed ends applications for good.
            </p>
          )}
        </CardContent>
      </Card>

      {e === 'slug' && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle />
          <AlertTitle>That public link is empty or already used by another opening — pick a different one.</AlertTitle>
        </Alert>
      )}

      <form action={updateOpening} className="mt-8 max-w-2xl space-y-4">
        <input type="hidden" name="id" value={o.id} />
        <Field>
          <Label htmlFor="title">Title *</Label>
          <Input id="title" name="title" defaultValue={o.title} required />
        </Field>
        <Field>
          <Label htmlFor="slug">
            Public link — /careers/…
          </Label>
          <Input id="slug" name="slug" defaultValue={o.slug} required className="font-mono" />
          <p className="mt-1 text-xs text-muted-foreground">
            The link doesn&apos;t change automatically when the title changes. Careful editing it
            after sharing — links already posted in ads keep pointing at the old address.
          </p>
        </Field>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field className="flex-1">
            <Label htmlFor="department">Department</Label>
            <NativeSelect className="w-full" id="department" name="department" defaultValue={o.department}>
              {(isStaff(user) || !o.department) && <NativeSelectOption value="">— none —</NativeSelectOption>}
              {deptOptions.map((d) => (
                <NativeSelectOption key={d} value={d}>{d}</NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="w-44">
            <Label htmlFor="status">Status</Label>
            <NativeSelect className="w-full" id="status" name="status" defaultValue={o.status}>
              <NativeSelectOption value="draft">draft — not public yet</NativeSelectOption>
              <NativeSelectOption value="open">open — accepting applications</NativeSelectOption>
              <NativeSelectOption value="paused">paused — hidden, pipeline continues</NativeSelectOption>
              <NativeSelectOption value="closed">closed — no more applications</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field className="flex-1">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={o.location} placeholder="e.g. Kochi / Remote" />
          </Field>
          <Field className="flex-1">
            <Label htmlFor="employment_type">Employment type</Label>
            <Input id="employment_type" name="employment_type" defaultValue={o.employment_type} placeholder="Full-time" />
          </Field>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Field className="flex-1">
            <Label htmlFor="salary_range">Salary range (shown publicly if set)</Label>
            <Input id="salary_range" name="salary_range" defaultValue={o.salary_range} placeholder="e.g. ₹4–6 LPA" />
          </Field>
          <Field className="w-44">
            <Label htmlFor="close_date">Auto-close on</Label>
            <Input
              id="close_date"
              type="date"
              name="close_date"
              defaultValue={o.close_at ? fmtDate(o.close_at) : ''} />
          </Field>
        </div>
        <Field>
          <Label htmlFor="description">Description (shown on the public page)</Label>
          <RichTextArea id="description" name="description" rows={6} defaultValue={o.description} />
        </Field>
        <Field>
          <Label htmlFor="notes">
            Important notes (highlighted to candidates before they apply)
          </Label>
          <RichTextArea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={o.notes}
            placeholder={'e.g. Work from office (Kochi). Immediate joiners preferred.\nShortlisted candidates get a task round.'}
          />
        </Field>
        <Field>
          <Label htmlFor="consent_text">
            Consent text (candidates must tick this to apply — leave empty for the standard line)
          </Label>
          <Input
            id="consent_text"
            name="consent_text"
            defaultValue={o.consent_text}
            placeholder="I agree that my details and resume are stored and used for this recruitment process." />
        </Field>
        <Field>
          <Label htmlFor="poster">
            Role poster (shown on the public page — JPG/PNG/WebP, up to 3 MB)
          </Label>
          {e === 'poster' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Poster must be a JPG, PNG, or WebP up to 3 MB.</AlertTitle>
            </Alert>
          )}
          {o.poster_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${o.poster_path}`}
              alt="Current role poster"
              className="mb-2 max-h-48 w-auto! rounded-lg border border-border"
            />
          )}
          <Input id="poster" type="file" name="poster" accept={POSTER_ACCEPT} />
          {o.poster_path && (
            <label className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <input type="checkbox" name="removePoster" value="1" />
              remove current poster
            </label>
          )}
        </Field>
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </form>

      {user.role === 'admin' && (
        <Card className="mt-12 max-w-2xl bg-destructive/5 ring-destructive/40">
          <CardHeader>
            <CardTitle className="font-display text-lg font-semibold text-destructive">Danger zone (admins only)</CardTitle>
            <CardDescription>
              Download a complete archive of this opening — every candidate&apos;s data as
              JSON/CSV plus all resumes, task submissions, and the poster — as a single zip.
              The zip is saved to <strong>your computer only</strong>; the system keeps no copy,
              so store it somewhere safe before deleting below.
            </CardDescription>
          </CardHeader>
          <CardContent>
          <DownloadLink href={`/app/openings/${o.id}/archive`} preparingLabel="Preparing archive…">
            Download full archive (.zip)
          </DownloadLink>
          <Separator className="my-5 bg-destructive/20" />
          <p className="text-sm text-muted-foreground">
            Permanently delete this opening and <strong>everything</strong> under it: all
            applications, resumes, submissions, feedback, notes, emails, slots, forms, and
            stages. This cannot be undone — download the archive first.
          </p>
          {e === 'confirm' && (
            <Alert variant="destructive" className="mt-2">
              <AlertTriangle />
              <AlertTitle>The confirmation didn&apos;t match — type the public link name exactly: {o.slug}</AlertTitle>
            </Alert>
          )}
          <form action={deleteOpeningData} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="openingId" value={o.id} />
            <Field className="min-w-56 flex-1">
              <Label htmlFor="confirmSlug">
                Type <code className="rounded bg-muted px-1">{o.slug}</code> to confirm
              </Label>
              <Input id="confirmSlug" name="confirmSlug" autoComplete="off" />
            </Field>
            <SubmitButton variant="destructive" pendingLabel="Deleting…" confirmText={`Permanently delete "${o.title}" and every candidate, file, and email under it? There is no undo.`}>
              Delete everything
            </SubmitButton>
          </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

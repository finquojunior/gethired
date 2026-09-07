'use client';

import { useEffect, useMemo, useState } from 'react';
import FormFields from '@/components/FormFields';
import { RESUME_ACCEPT, RESUME_EXTS, RESUME_MAX_BYTES } from '@/lib/uploads';
import {
  validateAnswers,
  visibleFields,
  type Answers,
  type FormSchema,
} from '@/lib/form-schema';

const DEFAULT_CONSENT =
  'I agree that my details and resume are stored and used for this recruitment process.';
const RESUME_HELP = `${RESUME_ACCEPT.replace(/\./g, '').toUpperCase().replace(/,/g, ', ')} · up to ${Math.round(RESUME_MAX_BYTES / 1048576)} MB`;

type Draft = { core: { name: string; email: string; phone: string }; answers: Answers };
type Done = { name: string; email: string; portal_url: string };

// sessionStorage: in-progress answers survive a refresh/back; the confirmation
// survives a reload via ?submitted=1. Both are best-effort (private mode etc.).
const store = {
  get<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  del(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  },
};

function uploadErrorText(status: string): string {
  if (status === 'sign 400') return 'That file type is not accepted — use PDF or Word.';
  if (status === 'sign 429') return 'Too many upload attempts — wait a few minutes and try again.';
  if (status === 'sign 404') return 'This role is no longer accepting applications.';
  if (status.startsWith('upload '))
    return 'The resume upload did not complete — check your connection and try again.';
  return 'Could not send your application — check your connection and try again.';
}

// core fields (page 0) + one schema page per step
export default function ApplyForm({
  direct,
  slug,
  formId,
  schema,
  consentText,
}: {
  /** upload the resume browser→storage (Vercel 4.5MB body cap) instead of through the server */
  direct: boolean;
  slug: string;
  formId: number;
  schema: FormSchema;
  consentText?: string;
}) {
  const [step, setStep] = useState(0);
  const [core, setCore] = useState({ name: '', email: '', phone: '' });
  const [resume, setResume] = useState<File | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [consented, setConsented] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [serverError, setServerError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [restored, setRestored] = useState(false);
  const draftKey = `apply:${formId}`;
  const doneKey = `applied:${formId}`;

  // restore a draft (or the confirmation after a reload) once, on mount
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('submitted') === '1') {
      setDone(store.get<Done>(doneKey) ?? { name: '', email: '', portal_url: '' });
      setStatus('done');
    } else {
      const d = store.get<Draft>(draftKey);
      if (d) {
        setCore({ ...d.core });
        setAnswers(d.answers ?? {}); // page 1 still: the resume can't be restored
      }
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (restored && status !== 'done') store.set(draftKey, { core, answers } satisfies Draft);
  }, [restored, status, core, answers, draftKey]);

  const pagesWithFields = useMemo(
    () =>
      schema.pages
        .map((p, i) => ({ page: p, index: i }))
        .filter(({ page }) =>
          page.fields.some((f) => visibleFields(schema, answers).includes(f))
        ),
    [schema, answers]
  );
  const steps = 1 + pagesWithFields.length;
  const isLast = step === steps - 1;

  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (isLast && !consented) errs.consent = 'Please tick the consent box to submit';
    if (step === 0) {
      if (!core.name.trim()) errs.name = 'Enter your name';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(core.email)) errs.email = 'Enter a valid email';
      // catch size/type here, on page 1, instead of at the final submit
      if (!resume) errs.resume = 'Attach your resume (PDF or Word, up to 5 MB)';
      else if (resume.size > RESUME_MAX_BYTES) errs.resume = 'Resume must be 5 MB or smaller';
      else if (!RESUME_EXTS.has(resume.name.slice(resume.name.lastIndexOf('.')).toLowerCase()))
        errs.resume = 'Use PDF or Word format';
    } else {
      const { page } = pagesWithFields[step - 1];
      const all = validateAnswers(schema, answers).errors;
      for (const f of page.fields) if (all[f.id]) errs[f.id] = all[f.id];
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async () => {
    if (!validateStep()) return;
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    setStatus('sending');
    setServerError('');
    try {
      const fd = new FormData();
      fd.set('formId', String(formId));
      fd.set('name', core.name);
      fd.set('email', core.email);
      fd.set('phone', core.phone);
      if (direct) {
        // Vercel caps request bodies at 4.5MB — upload the resume straight to
        // storage and send only the minted path (+ signature) with the form
        const signRes = await fetch(`/careers/${slug}/upload-url`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: resume!.name }),
        });
        if (!signRes.ok) throw new Error(`sign ${signRes.status}`);
        const { url, path, sig } = (await signRes.json()) as { url: string; path: string; sig: string };
        const up = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': resume!.type || 'application/octet-stream' },
          body: resume!,
        });
        if (!up.ok) throw new Error(`upload ${up.status}`);
        fd.set('resumePath', path);
        fd.set('resumeSig', sig);
      } else {
        fd.set('resume', resume!);
      }
      fd.set('answers', JSON.stringify(answers));
      fd.set('consent', consented ? '1' : '');
      // ad-source tracking: pass along any utm_* params from the landing URL
      fd.set('utm', JSON.stringify(Object.fromEntries(new URLSearchParams(window.location.search))));
      const res = await fetch(`/careers/${slug}/apply`, { method: 'POST', body: fd });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { portal_url?: string };
        const d: Done = { name: core.name, email: core.email, portal_url: body.portal_url ?? '' };
        store.del(draftKey);
        store.set(doneKey, d);
        setDone(d);
        setStatus('done');
        const url = new URL(window.location.href);
        url.searchParams.set('submitted', '1');
        window.history.replaceState(null, '', url);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.errors) {
        setErrors(body.errors);
        // jump to the first page that has a problem, not always page 1
        const bad = new Set(Object.keys(body.errors));
        const pageIdx = pagesWithFields.findIndex(({ page }) => page.fields.some((f) => bad.has(f.id)));
        const onCore = ['name', 'email', 'phone', 'resume'].some((k) => bad.has(k));
        setStep(onCore || pageIdx < 0 ? (bad.has('consent') && !onCore ? steps - 1 : 0) : pageIdx + 1);
      }
      setServerError(body.message ?? 'Something went wrong. Please try again.');
    } catch (err) {
      // network drop / storage failure: never leave the button stuck on "Sending…"
      setServerError(uploadErrorText(err instanceof Error ? err.message : ''));
    } finally {
      setStatus((s) => (s === 'done' ? s : 'idle'));
    }
  };

  if (status === 'done') {
    const first = done?.name.split(' ')[0];
    return (
      <div className="py-6 text-center" role="status">
        <div className="mx-auto mb-3 h-3 w-3 rounded-full bg-pine" />
        <h2 className="font-display text-2xl font-semibold">Application received</h2>
        <p className="mt-2 text-ink-soft">
          Thanks{first ? `, ${first}` : ''}. We&apos;ll review it and reach out{done?.email ? ` at ${done.email}` : ''}.
        </p>
        {done?.portal_url && (
          <p className="mt-4 text-sm">
            Your private status page:{' '}
            <a href={done.portal_url} className="break-all font-medium text-pine underline">
              {done.portal_url}
            </a>
          </p>
        )}
        <p className="mt-2 text-sm text-ink-soft">
          We&apos;ve also emailed {done?.portal_url ? 'it' : 'your status link'} to {done?.email || 'you'} — check
          your spam folder if it hasn&apos;t arrived. Save the link: it&apos;s how you track progress, book
          interviews and submit tasks.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {steps > 1 && (
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-ink-soft">
          Step {step + 1} of {steps}
          {step > 0 && ` · ${pagesWithFields[step - 1].page.title}`}
        </p>
      )}

      {step === 0 ? (
        <div className="space-y-5">
          <div>
            <label className="field-label" htmlFor="name">Full name <span className="text-rust">*</span></label>
            <input id="name" className="input" value={core.name} autoComplete="name"
              aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined}
              onChange={(e) => setCore({ ...core, name: e.target.value })} />
            {errors.name && <p id="name-error" className="mt-1 text-sm text-rust">{errors.name}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="email">Email <span className="text-rust">*</span></label>
            <input id="email" type="email" className="input" value={core.email} autoComplete="email"
              aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined}
              onChange={(e) => setCore({ ...core, email: e.target.value })} />
            {errors.email && <p id="email-error" className="mt-1 text-sm text-rust">{errors.email}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" value={core.phone} autoComplete="tel"
              onChange={(e) => setCore({ ...core, phone: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="resume">Resume <span className="text-rust">*</span></label>
            <p id="resume-help" className="-mt-0.5 mb-1 text-xs text-ink-soft">{RESUME_HELP}</p>
            <input
              id="resume"
              type="file"
              accept={RESUME_ACCEPT}
              className="input"
              aria-invalid={Boolean(errors.resume)}
              aria-describedby={errors.resume ? 'resume-help resume-error' : 'resume-help'}
              onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            />
            {resume && !errors.resume && (
              <p className="mt-1 text-xs text-ink-soft">Attached: {resume.name}</p>
            )}
            {errors.resume && <p id="resume-error" className="mt-1 text-sm text-rust">{errors.resume}</p>}
          </div>
        </div>
      ) : (
        <FormFields
          fields={pagesWithFields[step - 1].page.fields.filter((f) =>
            visibleFields(schema, answers).includes(f)
          )}
          answers={answers}
          errors={errors}
          onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
        />
      )}

      {isLast && (
        <div className="mt-6 rounded-md border border-line bg-paper p-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 accent-pine"
            />
            <span>{consentText || DEFAULT_CONSENT}</span>
          </label>
          {errors.consent && <p className="mt-1.5 text-sm text-rust" role="alert">{errors.consent}</p>}
        </div>
      )}

      {serverError && <p className="mt-4 text-sm text-rust" role="alert">{serverError}</p>}

      <div className="mt-6 flex items-center justify-between">
        {step > 0 ? (
          <button type="button" className="btn-quiet min-h-11" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button className="btn-primary min-h-11" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : isLast ? 'Submit application' : 'Continue'}
        </button>
      </div>
    </form>
  );
}

'use client';

import { useMemo, useState } from 'react';
import FormFields from '@/components/FormFields';
import { RESUME_ACCEPT } from '@/lib/uploads';
import {
  validateAnswers,
  visibleFields,
  type Answers,
  type FormSchema,
} from '@/lib/form-schema';

const DEFAULT_CONSENT =
  'I agree that my details and resume are stored and used for this recruitment process.';

// core fields (page 0) + one schema page per step
export default function ApplyForm({
  slug,
  formId,
  schema,
  consentText,
}: {
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
      if (!resume) errs.resume = 'Attach your resume (PDF or Word, up to 5 MB)';
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
    const fd = new FormData();
    fd.set('formId', String(formId));
    fd.set('name', core.name);
    fd.set('email', core.email);
    fd.set('phone', core.phone);
    fd.set('resume', resume!);
    fd.set('answers', JSON.stringify(answers));
    fd.set('consent', consented ? '1' : '');
    // ad-source tracking: pass along any utm_* params from the landing URL
    fd.set('utm', JSON.stringify(Object.fromEntries(new URLSearchParams(window.location.search))));
    const res = await fetch(`/careers/${slug}/apply`, { method: 'POST', body: fd });
    if (res.ok) {
      setStatus('done');
    } else {
      const body = await res.json().catch(() => ({}));
      setStatus('idle');
      if (body.errors) {
        setErrors(body.errors);
        setStep(0);
      }
      setServerError(body.message ?? 'Something went wrong. Please try again.');
    }
  };

  if (status === 'done') {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-3 h-3 w-3 rounded-full bg-pine" />
        <h2 className="font-display text-2xl font-semibold">Application received</h2>
        <p className="mt-2 text-ink-soft">
          Thanks, {core.name.split(' ')[0]}. We&apos;ll review it and reach out at {core.email}.
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
            <input id="name" className="input" value={core.name}
              onChange={(e) => setCore({ ...core, name: e.target.value })} />
            {errors.name && <p className="mt-1 text-sm text-rust">{errors.name}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="email">Email <span className="text-rust">*</span></label>
            <input id="email" type="email" className="input" value={core.email}
              onChange={(e) => setCore({ ...core, email: e.target.value })} />
            {errors.email && <p className="mt-1 text-sm text-rust">{errors.email}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" value={core.phone}
              onChange={(e) => setCore({ ...core, phone: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="resume">Resume <span className="text-rust">*</span></label>
            <input
              id="resume"
              type="file"
              accept={RESUME_ACCEPT}
              className="input"
              onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            />
            {errors.resume && <p className="mt-1 text-sm text-rust">{errors.resume}</p>}
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
          {errors.consent && <p className="mt-1.5 text-sm text-rust">{errors.consent}</p>}
        </div>
      )}

      {serverError && <p className="mt-4 text-sm text-rust">{serverError}</p>}

      <div className="mt-6 flex items-center justify-between">
        {step > 0 ? (
          <button type="button" className="btn-quiet" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button className="btn-primary" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : isLast ? 'Submit application' : 'Continue'}
        </button>
      </div>
    </form>
  );
}

'use client';

// Shared renderer for custom form fields — used by the public apply page and
// the builder's live preview, so conditional logic behaves identically.

import {
  fieldOptions,
  type Answers,
  type AnswerValue,
  type Field,
} from '@/lib/form-schema';

export default function FormFields({
  fields,
  answers,
  errors,
  onChange,
}: {
  fields: Field[];
  answers: Answers;
  errors: Record<string, string>;
  onChange: (id: string, value: AnswerValue) => void;
}) {
  return (
    <div className="space-y-5">
      {fields.map((f) => {
        const group = f.type === 'multiple_choice' || f.type === 'yes_no' || f.type === 'checkboxes';
        const id = `f-${f.id}`;
        const describedBy =
          [f.help && `${id}-help`, errors[f.id] && `${id}-error`].filter(Boolean).join(' ') || undefined;
        const a11y = { id, 'aria-invalid': Boolean(errors[f.id]) || undefined, 'aria-describedby': describedBy };
        const label = (
          <>
            {f.label}
            {f.required && <span className="text-rust"> *</span>}
          </>
        );
        const body = (
          <>
            {f.help && <p id={`${id}-help`} className="-mt-0.5 mb-1 text-xs text-ink-soft">{f.help}</p>}
            <FieldInput field={f} value={answers[f.id]} onChange={(v) => onChange(f.id, v)} a11y={a11y} />
            {errors[f.id] && <p id={`${id}-error`} className="mt-1 text-sm text-rust">{errors[f.id]}</p>}
          </>
        );
        // radios/checkboxes: the group is the control, so fieldset+legend carries the label
        return group ? (
          <fieldset key={f.id} aria-describedby={describedBy} aria-invalid={Boolean(errors[f.id]) || undefined}>
            <legend className="field-label">{label}</legend>
            {body}
          </fieldset>
        ) : (
          <div key={f.id}>
            <label className="field-label" htmlFor={id}>{label}</label>
            {body}
          </div>
        );
      })}
    </div>
  );
}

type A11y = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

function FieldInput({
  field: f,
  value,
  onChange,
  a11y,
}: {
  field: Field;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  a11y: A11y;
}) {
  switch (f.type) {
    case 'short_text':
    case 'email':
    case 'phone':
    case 'url': {
      const type = { short_text: 'text', email: 'email', phone: 'tel', url: 'url' }[f.type];
      return (
        <input {...a11y} type={type} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    }
    case 'long_text':
      return (
        <textarea {...a11y} className="input" rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'number':
      return (
        <input {...a11y} type="number" className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'salary':
      return (
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink-soft">₹ INR</span>
          <input
            {...a11y}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 450000"
            className="input"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'date':
      return (
        <input {...a11y} type="date" className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'dropdown':
      return (
        <select {...a11y} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {fieldOptions(f).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case 'multiple_choice':
    case 'yes_no':
      return (
        <div className="space-y-1.5">
          {fieldOptions(f).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={f.id}
                checked={value === o}
                onChange={() => onChange(o)}
                className="accent-pine"
              />
              {o}
            </label>
          ))}
        </div>
      );
    case 'checkboxes': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          {fieldOptions(f).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))
                }
                className="accent-pine"
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
  }
}

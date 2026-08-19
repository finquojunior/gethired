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
      {fields.map((f) => (
        <div key={f.id}>
          <label className="field-label">
            {f.label}
            {f.required && <span className="text-rust"> *</span>}
          </label>
          {f.help && <p className="-mt-0.5 mb-1 text-xs text-ink-soft">{f.help}</p>}
          <FieldInput field={f} value={answers[f.id]} onChange={(v) => onChange(f.id, v)} />
          {errors[f.id] && <p className="mt-1 text-sm text-rust">{errors[f.id]}</p>}
        </div>
      ))}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  switch (f.type) {
    case 'short_text':
    case 'email':
    case 'phone':
    case 'url': {
      const type = { short_text: 'text', email: 'email', phone: 'tel', url: 'url' }[f.type];
      return (
        <input type={type} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    }
    case 'long_text':
      return (
        <textarea className="input" rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'number':
      return (
        <input type="number" className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'date':
      return (
        <input type="date" className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'dropdown':
      return (
        <select className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
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

'use client';

// Shared renderer for custom form fields — used by the public apply page and
// the builder's live preview, so conditional logic behaves identically.

import {
  fieldOptions,
  type Answers,
  type AnswerValue,
  type Field as SchemaField,
} from '@/lib/form-schema';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export default function FormFields({
  fields,
  answers,
  errors,
  onChange,
}: {
  fields: SchemaField[];
  answers: Answers;
  errors: Record<string, string>;
  onChange: (id: string, value: AnswerValue) => void;
}) {
  return (
    <FieldGroup>
      {fields.map((f) => {
        const group = f.type === 'multiple_choice' || f.type === 'yes_no' || f.type === 'checkboxes';
        const id = `f-${f.id}`;
        const invalid = Boolean(errors[f.id]) || undefined;
        const describedBy =
          [f.help && `${id}-help`, errors[f.id] && `${id}-error`].filter(Boolean).join(' ') || undefined;
        const a11y = { id, 'aria-invalid': invalid, 'aria-describedby': describedBy };
        const label = (
          <>
            {f.label}
            {f.required && <span className="text-destructive">*</span>}
          </>
        );
        const body = (
          <>
            {f.help && <FieldDescription id={`${id}-help`}>{f.help}</FieldDescription>}
            <FieldInput field={f} value={answers[f.id]} onChange={(v) => onChange(f.id, v)} a11y={a11y} />
            {errors[f.id] && <FieldError id={`${id}-error`}>{errors[f.id]}</FieldError>}
          </>
        );
        // radios/checkboxes: the group is the control, so fieldset+legend carries the label
        return group ? (
          <FieldSet key={f.id} className="gap-2" aria-describedby={describedBy} aria-invalid={invalid} data-invalid={invalid}>
            <FieldLegend variant="label" className="flex gap-1">{label}</FieldLegend>
            {body}
          </FieldSet>
        ) : (
          <Field key={f.id} data-invalid={invalid}>
            <FieldLabel htmlFor={id} className="gap-1">{label}</FieldLabel>
            {body}
          </Field>
        );
      })}
    </FieldGroup>
  );
}

type A11y = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

function FieldInput({
  field: f,
  value,
  onChange,
  a11y,
}: {
  field: SchemaField;
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
      return <Input {...a11y} type={type} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    }
    case 'long_text':
      return <Textarea {...a11y} rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <Input {...a11y} type="number" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'salary':
      return (
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 shrink-0 items-center rounded-lg border border-input bg-muted px-2.5 text-sm text-muted-foreground">
            ₹ INR
          </span>
          <Input
            {...a11y}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 450000"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'date':
      return <Input {...a11y} type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'dropdown':
      return (
        <NativeSelect {...a11y} className="w-full" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <NativeSelectOption value="">Select…</NativeSelectOption>
          {fieldOptions(f).map((o) => (
            <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>
          ))}
        </NativeSelect>
      );
    case 'multiple_choice':
    case 'yes_no':
      return (
        <div className="space-y-1.5">
          {fieldOptions(f).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="radio" name={f.id} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      );
    case 'checkboxes': {
      const selected = Array.isArray(value) ? value : [];
      if (f.single) {
        // one answer allowed: radios, but the answer stays an array like other checkbox fields
        return (
          <div className="space-y-1.5">
            {fieldOptions(f).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input type="radio" name={f.id} checked={selected[0] === o} onChange={() => onChange([o])} />
                {o}
              </label>
            ))}
          </div>
        );
      }
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
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
  }
}

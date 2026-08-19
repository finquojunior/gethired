// Form definitions live as JSONB on forms.schema. This module is the single
// source of truth for rendering (client), validation (server — the trust
// boundary), and scoring. Keep it dependency-free.

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'dropdown'
  | 'multiple_choice'
  | 'checkboxes'
  | 'number'
  | 'yes_no'
  | 'date'
  | 'email'
  | 'phone'
  | 'url';

export interface Condition {
  fieldId: string;
  op: 'eq' | 'neq' | 'in';
  value: string | string[];
}

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  help?: string;
  required?: boolean;
  options?: string[];
  /** points per option value; scoring only applies to choice-type fields */
  points?: Record<string, number>;
  showIf?: Condition;
}

export interface FormPage {
  title: string;
  fields: Field[];
}

export interface FormSchema {
  pages: FormPage[];
}

export type AnswerValue = string | string[] | number;
export type Answers = Record<string, AnswerValue | undefined>;

export const CHOICE_TYPES: FieldType[] = ['dropdown', 'multiple_choice', 'checkboxes', 'yes_no'];
export const YES_NO_OPTIONS = ['Yes', 'No'];

export function fieldOptions(f: Field): string[] {
  return f.type === 'yes_no' ? YES_NO_OPTIONS : (f.options ?? []);
}

export function allFields(schema: FormSchema): Field[] {
  return schema.pages.flatMap((p) => p.fields);
}

function toValues(v: AnswerValue | undefined): string[] {
  if (v === undefined || v === '') return [];
  return Array.isArray(v) ? v : [String(v)];
}

function conditionMet(cond: Condition, answers: Answers): boolean {
  const have = toValues(answers[cond.fieldId]);
  const want = Array.isArray(cond.value) ? cond.value : [cond.value];
  switch (cond.op) {
    case 'eq':
      return have.includes(String(cond.value));
    case 'neq':
      return have.length > 0 && !have.includes(String(cond.value));
    case 'in':
      return want.some((w) => have.includes(w));
  }
}

/**
 * Fields visible given current answers, in form order. A field whose
 * controller is itself hidden (or missing) is hidden, so hidden chains
 * collapse and stale answers on hidden fields never resurrect dependents.
 */
export function visibleFields(schema: FormSchema, answers: Answers): Field[] {
  const visible: Field[] = [];
  const visibleIds = new Set<string>();
  for (const f of allFields(schema)) {
    const ok =
      !f.showIf || (visibleIds.has(f.showIf.fieldId) && conditionMet(f.showIf, answers));
    if (ok) {
      visible.push(f);
      visibleIds.add(f.id);
    }
  }
  return visible;
}

const isEmpty = (v: AnswerValue | undefined) =>
  v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Server-side validation. Returns errors keyed by field id and `clean`:
 * answers restricted to visible fields with normalized types. Hidden-field
 * answers are dropped — a candidate can't smuggle values past the logic.
 */
export function validateAnswers(
  schema: FormSchema,
  answers: Answers
): { errors: Record<string, string>; clean: Answers } {
  const errors: Record<string, string> = {};
  const clean: Answers = {};
  for (const f of visibleFields(schema, answers)) {
    const raw = answers[f.id];
    if (isEmpty(raw)) {
      if (f.required) errors[f.id] = 'This field is required';
      continue;
    }
    switch (f.type) {
      case 'short_text':
      case 'long_text': {
        const s = String(raw);
        const max = f.type === 'short_text' ? 500 : 5000;
        if (s.length > max) errors[f.id] = `Keep this under ${max} characters`;
        else clean[f.id] = s;
        break;
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) errors[f.id] = 'Enter a number';
        else clean[f.id] = n;
        break;
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors[f.id] = 'Enter a valid date';
        else clean[f.id] = String(raw);
        break;
      }
      case 'email': {
        const s = String(raw).trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) errors[f.id] = 'Enter a valid email address';
        else clean[f.id] = s.slice(0, 320);
        break;
      }
      case 'phone': {
        const s = String(raw).trim();
        if (!/^[+\d][\d\s\-()]{5,20}$/.test(s)) errors[f.id] = 'Enter a valid phone number';
        else clean[f.id] = s;
        break;
      }
      case 'url': {
        const s = String(raw).trim().slice(0, 500);
        try {
          const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
          clean[f.id] = u.href;
        } catch {
          errors[f.id] = 'Enter a valid link';
        }
        break;
      }
      case 'dropdown':
      case 'multiple_choice':
      case 'yes_no': {
        const s = String(raw);
        if (!fieldOptions(f).includes(s)) errors[f.id] = 'Pick one of the listed options';
        else clean[f.id] = s;
        break;
      }
      case 'checkboxes': {
        const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        const opts = fieldOptions(f);
        if (arr.some((v) => !opts.includes(v))) errors[f.id] = 'Pick from the listed options';
        else clean[f.id] = arr;
        break;
      }
    }
  }
  return { errors, clean };
}

/** Sum of option points across visible, answered choice fields. */
export function computeScore(schema: FormSchema, answers: Answers): number {
  let score = 0;
  for (const f of visibleFields(schema, answers)) {
    if (!f.points || !CHOICE_TYPES.includes(f.type)) continue;
    for (const v of toValues(answers[f.id])) score += f.points[v] ?? 0;
  }
  return score;
}

/** Best possible score if every scored field were visible and answered optimally. */
export function computeMaxScore(schema: FormSchema): number {
  let max = 0;
  for (const f of allFields(schema)) {
    if (!f.points || !CHOICE_TYPES.includes(f.type)) continue;
    const vals = Object.values(f.points);
    if (f.type === 'checkboxes') {
      max += vals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    } else {
      max += Math.max(0, ...vals);
    }
  }
  return max;
}

export function newFieldId(): string {
  return 'f_' + Math.random().toString(36).slice(2, 10);
}

export const EMPTY_SCHEMA: FormSchema = { pages: [{ title: 'Questions', fields: [] }] };

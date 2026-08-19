'use client';

import { useMemo, useState, useTransition } from 'react';
import FormFields from '@/components/FormFields';
import {
  CHOICE_TYPES,
  fieldOptions,
  newFieldId,
  visibleFields,
  type Answers,
  type Field,
  type FieldType,
  type FormSchema,
} from '@/lib/form-schema';

const FIELD_TYPES: Array<[FieldType, string]> = [
  ['short_text', 'Short text'],
  ['long_text', 'Long text'],
  ['dropdown', 'Dropdown'],
  ['multiple_choice', 'Multiple choice'],
  ['checkboxes', 'Checkboxes'],
  ['number', 'Number'],
  ['yes_no', 'Yes / No'],
  ['date', 'Date'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['url', 'Link / URL'],
  ['salary', 'Salary (₹ INR)'],
];

export default function FormBuilder({
  openingId,
  initialSchema,
  publishedVersion,
  otherOpenings,
  saveDraft,
  publish,
  fetchQuestions,
}: {
  openingId: number;
  initialSchema: FormSchema;
  publishedVersion: number | null;
  otherOpenings: { id: number; title: string }[];
  saveDraft: (openingId: number, schema: FormSchema) => Promise<void>;
  publish: (openingId: number, schema: FormSchema) => Promise<void>;
  fetchQuestions: (openingId: number) => Promise<Field[]>;
}) {
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});

  const update = (fn: (s: FormSchema) => FormSchema) => {
    setSchema((s) => fn(structuredClone(s)));
    setDirty(true);
  };

  const updateField = (pi: number, fi: number, patch: Partial<Field>) =>
    update((s) => {
      Object.assign(s.pages[pi].fields[fi], patch);
      return s;
    });

  const priorFields = (pi: number, fi: number): Field[] =>
    schema.pages.flatMap((p, i) => p.fields.filter((_, j) => i < pi || (i === pi && j < fi)));

  const importFrom = (sourceId: number) =>
    startTransition(async () => {
      const fields = await fetchQuestions(sourceId);
      if (fields.length === 0) return;
      // fresh ids so imports never collide; conditions are remapped with them
      const idMap = new Map(fields.map((f) => [f.id, newFieldId()]));
      update((s) => {
        s.pages[s.pages.length - 1].fields.push(
          ...fields.map((f) => ({
            ...structuredClone(f),
            id: idMap.get(f.id)!,
            showIf:
              f.showIf && idMap.has(f.showIf.fieldId)
                ? { ...f.showIf, fieldId: idMap.get(f.showIf.fieldId)! }
                : undefined,
          }))
        );
        return s;
      });
    });

  const preview = useMemo(() => visibleFields(schema, previewAnswers), [schema, previewAnswers]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* editor */}
      <div className="space-y-6">
        <section className="rounded-lg border border-dashed border-line bg-paper p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Contact details — built in</h3>
            <span className="text-xs text-ink-soft">🔒 always asked first</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['Full name *', 'Email *', 'Phone', 'Resume upload *'].map((f) => (
              <span key={f} className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs text-ink-soft">
                {f}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Every application starts with these — they can&apos;t be removed or edited, so
            candidates are always reachable and always attach a resume. The questions you build
            below are asked after them.
          </p>
        </section>

        {schema.pages.map((page, pi) => (
          <section key={pi} className="rounded-lg border border-line bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                className="input font-medium"
                value={page.title}
                onChange={(e) => update((s) => ((s.pages[pi].title = e.target.value), s))}
              />
              {schema.pages.length > 1 && (
                <button
                  type="button"
                  className="btn-quiet text-rust"
                  onClick={() => update((s) => (s.pages.splice(pi, 1), s))}
                >
                  Delete page
                </button>
              )}
            </div>

            <div className="space-y-3">
              {page.fields.map((f, fi) => (
                <div key={f.id} className="rounded-md border border-line p-3">
                  <input
                    className="input mb-2"
                    placeholder="Question label"
                    value={f.label}
                    onChange={(e) => updateField(pi, fi, { label: e.target.value })}
                  />
                  <input
                    className="input mb-2 text-xs"
                    placeholder="Help text shown under the question (optional)"
                    value={f.help ?? ''}
                    onChange={(e) => updateField(pi, fi, { help: e.target.value || undefined })}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="input w-40"
                      value={f.type}
                      onChange={(e) => {
                        const type = e.target.value as FieldType;
                        updateField(pi, fi, {
                          type,
                          options: CHOICE_TYPES.includes(type) && type !== 'yes_no' ? (f.options ?? ['Option 1']) : undefined,
                          points: undefined,
                        });
                      }}
                    >
                      {FIELD_TYPES.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <div className="flex-1" />
                    <label className="flex items-center gap-1 text-xs text-ink-soft">
                      <input
                        type="checkbox"
                        checked={!!f.required}
                        onChange={(e) => updateField(pi, fi, { required: e.target.checked })}
                        className="accent-pine"
                      />
                      required
                    </label>
                    <button
                      type="button"
                      title="Move up"
                      className="text-ink-soft hover:text-ink disabled:opacity-30"
                      disabled={fi === 0}
                      onClick={() =>
                        update((s) => {
                          const a = s.pages[pi].fields;
                          [a[fi - 1], a[fi]] = [a[fi], a[fi - 1]];
                          return s;
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Move down"
                      className="text-ink-soft hover:text-ink disabled:opacity-30"
                      disabled={fi === page.fields.length - 1}
                      onClick={() =>
                        update((s) => {
                          const a = s.pages[pi].fields;
                          [a[fi + 1], a[fi]] = [a[fi], a[fi + 1]];
                          return s;
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="Duplicate question"
                      className="text-ink-soft hover:text-ink"
                      onClick={() =>
                        update((s) => {
                          const copy = structuredClone(s.pages[pi].fields[fi]);
                          copy.id = newFieldId();
                          s.pages[pi].fields.splice(fi + 1, 0, copy);
                          return s;
                        })
                      }
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      title="Delete question"
                      className="text-rust"
                      onClick={() => update((s) => (s.pages[pi].fields.splice(fi, 1), s))}
                    >
                      ✕
                    </button>
                  </div>

                  {CHOICE_TYPES.includes(f.type) && f.type !== 'yes_no' && (
                    <div className="mt-2">
                      <label className="text-xs text-ink-soft">Options (one per line)</label>
                      <textarea
                        className="input mt-1"
                        rows={3}
                        value={(f.options ?? []).join('\n')}
                        onChange={(e) =>
                          updateField(pi, fi, { options: e.target.value.split('\n') })
                        }
                        onBlur={(e) =>
                          updateField(pi, fi, {
                            options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                          })
                        }
                      />
                    </div>
                  )}

                  {CHOICE_TYPES.includes(f.type) && (
                    <details className="mt-2" open={!!f.points}>
                      <summary className="cursor-pointer text-xs text-ink-soft">
                        {f.points
                          ? '★ Scoring answers — candidates are ranked by their total points'
                          : 'Score answers (optional) — give points to rank candidates automatically'}
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {fieldOptions(f).map((o) => (
                          <label key={o} className="flex items-center gap-2 text-xs">
                            <span className="w-28 truncate">{o}</span>
                            <input
                              type="number"
                              className="input py-1"
                              value={f.points?.[o] ?? ''}
                              placeholder="0 pts"
                              onChange={(e) => {
                                const points = { ...(f.points ?? {}) };
                                if (e.target.value === '') delete points[o];
                                else points[o] = Number(e.target.value);
                                updateField(pi, fi, {
                                  points: Object.keys(points).length ? points : undefined,
                                });
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                  )}

                  {(() => {
                    const controller = f.showIf
                      ? priorFields(pi, fi).find((pf) => pf.id === f.showIf!.fieldId)
                      : undefined;
                    const controllerOptions = controller ? fieldOptions(controller) : [];
                    const summary = f.showIf
                      ? `👁 Shown only when “${controller?.label || 'earlier question'}” ${
                          f.showIf.op === 'eq' ? 'is' : 'is not'
                        } “${String(f.showIf.value) || '…'}”`
                      : 'Show this question only for some candidates (optional)';
                    return (
                      <details className="mt-2" open={!!f.showIf}>
                        <summary className="cursor-pointer text-xs text-ink-soft">{summary}</summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span>Show only when the answer to</span>
                          <select
                            className="input w-44 py-1"
                            value={f.showIf?.fieldId ?? ''}
                            onChange={(e) => {
                              const fieldId = e.target.value;
                              updateField(pi, fi, {
                                showIf: fieldId
                                  ? { fieldId, op: f.showIf?.op ?? 'eq', value: f.showIf?.value ?? '' }
                                  : undefined,
                              });
                            }}
                          >
                            <option value="">— no condition, always shown —</option>
                            {priorFields(pi, fi).map((pf) => (
                              <option key={pf.id} value={pf.id}>{pf.label || 'Untitled question'}</option>
                            ))}
                          </select>
                          {f.showIf && (
                            <>
                              <select
                                className="input w-24 py-1"
                                value={f.showIf.op}
                                onChange={(e) =>
                                  updateField(pi, fi, {
                                    showIf: { ...f.showIf!, op: e.target.value as 'eq' | 'neq' },
                                  })
                                }
                              >
                                <option value="eq">is</option>
                                <option value="neq">is not</option>
                              </select>
                              {controllerOptions.length > 0 ? (
                                <select
                                  className="input min-w-28 py-1"
                                  value={String(f.showIf.value)}
                                  onChange={(e) =>
                                    updateField(pi, fi, { showIf: { ...f.showIf!, value: e.target.value } })
                                  }
                                >
                                  <option value="">— pick an answer —</option>
                                  {controllerOptions.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="input min-w-24 flex-1 py-1"
                                  placeholder="answer to match"
                                  value={String(f.showIf.value)}
                                  onChange={(e) =>
                                    updateField(pi, fi, { showIf: { ...f.showIf!, value: e.target.value } })
                                  }
                                />
                              )}
                            </>
                          )}
                        </div>
                        {f.showIf && !controller && (
                          <p className="mt-1 text-xs text-rust">
                            The question this depended on was removed — this question is now hidden
                            for everyone. Pick another question or remove the condition.
                          </p>
                        )}
                      </details>
                    );
                  })()}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn-quiet mt-3"
              onClick={() =>
                update((s) => {
                  s.pages[pi].fields.push({ id: newFieldId(), type: 'short_text', label: '' });
                  return s;
                })
              }
            >
              + Add question
            </button>
          </section>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-quiet"
            onClick={() => update((s) => (s.pages.push({ title: `Page ${s.pages.length + 1}`, fields: [] }), s))}
            title="Each page is a separate step for the candidate — use pages to split long forms"
          >
            + Add step (page)
          </button>
          {otherOpenings.length > 0 && (
            <select
              className="input w-56 py-2 text-sm"
              value=""
              disabled={pending}
              onChange={(e) => e.target.value && importFrom(Number(e.target.value))}
            >
              <option value="">Copy questions from…</option>
              {otherOpenings.map((o) => (
                <option key={o.id} value={o.id}>{o.title}</option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="btn-quiet"
            disabled={pending || !dirty}
            onClick={() =>
              startTransition(async () => {
                await saveDraft(openingId, schema);
                setDirty(false);
              })
            }
          >
            {dirty ? 'Save draft' : 'Draft saved'}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await publish(openingId, schema);
                setDirty(false);
              })
            }
          >
            {publishedVersion ? `Publish (replaces v${publishedVersion})` : 'Publish form'}
          </button>
        </div>
        <p className="text-xs text-ink-soft">
          Publishing makes this version live for new applicants; past applications keep the
          version they answered.
        </p>
      </div>

      {/* live preview */}
      <div>
        <div className="sticky top-8 rounded-lg border border-line bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Candidate preview</h2>
            <button
              type="button"
              className="text-xs text-ink-soft underline"
              onClick={() => setPreviewAnswers({})}
            >
              Reset answers
            </button>
          </div>
          <div className="mb-5 space-y-3 border-b border-dashed border-line pb-5 opacity-60">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Step 1 · Contact details (built in)
            </p>
            {['Full name *', 'Email *', 'Phone'].map((l) => (
              <div key={l}>
                <label className="field-label">{l}</label>
                <input className="input" disabled placeholder="Filled by the candidate" />
              </div>
            ))}
            <div>
              <label className="field-label">Resume *</label>
              <input type="file" className="input" disabled />
            </div>
          </div>
          {schema.pages.length > 0 && preview.length > 0 && (
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-soft">
              Your questions{schema.pages.length > 1 ? ` · ${schema.pages.length} steps` : ''}
            </p>
          )}
          <FormFields
            fields={preview}
            answers={previewAnswers}
            errors={{}}
            onChange={(id, v) => setPreviewAnswers((a) => ({ ...a, [id]: v }))}
          />
          {preview.length === 0 && (
            <p className="text-sm text-ink-soft">
              No questions of your own yet — candidates would only fill the contact details above.
              Add questions on the left.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

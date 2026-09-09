'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import FormFields from '@/components/FormFields';
import { toast } from '@/components/Toaster';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ArrowDown, ArrowUp, Copy, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';

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
  publish: (openingId: number, schema: FormSchema) => Promise<{ version: number | null }>;
  fetchQuestions: (openingId: number) => Promise<Field[]>;
}) {
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const [confirm, setConfirm] = useState<{ title: string; text: string; run: () => void } | null>(null);

  // unsaved edits: warn before the tab closes or navigates away
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title}
        description={confirm?.text}
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirm?.run()}
      />
      {/* editor */}
      <div className="space-y-6">
        <Card size="sm" className="border border-dashed bg-muted/40 shadow-none ring-0">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Contact details — built in</CardTitle>
            <CardAction className="text-xs text-muted-foreground">🔒 always asked first</CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {['Full name *', 'Email *', 'Phone', 'Resume upload *'].map((f) => (
                <Badge key={f} variant="outline" className="bg-card text-muted-foreground">
                  {f}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Every application starts with these — they can&apos;t be removed or edited, so
              candidates are always reachable and always attach a resume. The questions you build
              below are asked after them.
            </p>
          </CardContent>
        </Card>

        {schema.pages.map((page, pi) => (
          <Card key={pi}>
            <CardContent>
            <div className="mb-3 flex items-center gap-2">
              <Input
                className="font-medium"
                aria-label={`Page ${pi + 1} title`}
                value={page.title}
                onChange={(e) => update((s) => ((s.pages[pi].title = e.target.value), s))}
              />
              {schema.pages.length > 1 && (
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => {
                    const n = page.fields.length;
                    const run = () => update((s) => (s.pages.splice(pi, 1), s));
                    if (n > 0) {
                      setConfirm({
                        title: 'Delete page?',
                        text: `Delete "${page.title || `Page ${pi + 1}`}" and its ${n} question${n === 1 ? '' : 's'}?`,
                        run,
                      });
                      return;
                    }
                    run();
                  }}
                >
                  Delete page
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {page.fields.map((f, fi) => (
                <div key={f.id} className="rounded-lg border border-border p-3">
                  <Input
                    className="mb-2"
                    aria-label="Question label"
                    placeholder="Question label"
                    value={f.label}
                    onChange={(e) => updateField(pi, fi, { label: e.target.value })}
                  />
                  <Input
                    className="mb-2 text-xs"
                    aria-label="Help text"
                    placeholder="Help text shown under the question (optional)"
                    value={f.help ?? ''}
                    onChange={(e) => updateField(pi, fi, { help: e.target.value || undefined })}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <NativeSelect
                      className="w-40"
                      aria-label="Question type"
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
                        <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <div className="flex-1" />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={!!f.required}
                        onChange={(e) => updateField(pi, fi, { required: e.target.checked })}
                      />
                      required
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Move up"
                      aria-label="Move question up"
                      disabled={fi === 0}
                      onClick={() =>
                        update((s) => {
                          const a = s.pages[pi].fields;
                          [a[fi - 1], a[fi]] = [a[fi], a[fi - 1]];
                          return s;
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Move down"
                      aria-label="Move question down"
                      disabled={fi === page.fields.length - 1}
                      onClick={() =>
                        update((s) => {
                          const a = s.pages[pi].fields;
                          [a[fi + 1], a[fi]] = [a[fi], a[fi + 1]];
                          return s;
                        })
                      }
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Duplicate question"
                      aria-label="Duplicate question"
                      onClick={() =>
                        update((s) => {
                          const copy = structuredClone(s.pages[pi].fields[fi]);
                          copy.id = newFieldId();
                          s.pages[pi].fields.splice(fi + 1, 0, copy);
                          return s;
                        })
                      }
                    >
                      <Copy />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Delete question"
                      aria-label="Delete question"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        const run = () => update((s) => (s.pages[pi].fields.splice(fi, 1), s));
                        if (f.label.trim()) {
                          setConfirm({ title: 'Delete question?', text: `Delete the question "${f.label}"?`, run });
                          return;
                        }
                        run();
                      }}
                    >
                      <X />
                    </Button>
                  </div>

                  {CHOICE_TYPES.includes(f.type) && f.type !== 'yes_no' && (
                    <div className="mt-2">
                      <label className="text-xs text-muted-foreground">Options (one per line)</label>
                      <Textarea
                        className="mt-1"
                        rows={3}
                        value={(f.options ?? []).join('\n')}
                        onChange={(e) =>
                          updateField(pi, fi, { options: e.target.value.split('\n') })
                        }
                        onBlur={(e) =>
                          updateField(pi, fi, {
                            options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                          })
                        } />
                    </div>
                  )}

                  {CHOICE_TYPES.includes(f.type) && (
                    <details className="mt-2" open={!!f.points}>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {f.points
                          ? '★ Scoring answers — candidates are ranked by their total points'
                          : 'Score answers (optional) — give points to rank candidates automatically'}
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {fieldOptions(f).map((o) => (
                          <label key={o} className="flex items-center gap-2 text-xs">
                            <span className="w-28 truncate">{o}</span>
                            <Input
                              type="number"
                              value={f.points?.[o] ?? ''}
                              placeholder="0 pts"
                              onChange={(e) => {
                                const points = { ...(f.points ?? {}) };
                                if (e.target.value === '') delete points[o];
                                else points[o] = Number(e.target.value);
                                updateField(pi, fi, {
                                  points: Object.keys(points).length ? points : undefined,
                                });
                              }} />
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
                        <summary className="cursor-pointer text-xs text-muted-foreground">{summary}</summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span>Show only when the answer to</span>
                          <NativeSelect size="sm" className="w-44"
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
                            <NativeSelectOption value="">— no condition, always shown —</NativeSelectOption>
                            {priorFields(pi, fi).map((pf) => (
                              <NativeSelectOption key={pf.id} value={pf.id}>{pf.label || 'Untitled question'}</NativeSelectOption>
                            ))}
                          </NativeSelect>
                          {f.showIf && (
                            <>
                              <NativeSelect size="sm" className="w-24"
                                value={f.showIf.op}
                                onChange={(e) =>
                                  updateField(pi, fi, {
                                    showIf: { ...f.showIf!, op: e.target.value as 'eq' | 'neq' },
                                  })
                                }
                              >
                                <NativeSelectOption value="eq">is</NativeSelectOption>
                                <NativeSelectOption value="neq">is not</NativeSelectOption>
                              </NativeSelect>
                              {controllerOptions.length > 0 ? (
                                <NativeSelect size="sm" className="min-w-28"
                                  value={String(f.showIf.value)}
                                  onChange={(e) =>
                                    updateField(pi, fi, { showIf: { ...f.showIf!, value: e.target.value } })
                                  }
                                >
                                  <NativeSelectOption value="">— pick an answer —</NativeSelectOption>
                                  {controllerOptions.map((o) => (
                                    <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              ) : (
                                <Input className="min-w-24 flex-1"
                                  placeholder="answer to match"
                                  value={String(f.showIf.value)}
                                  onChange={(e) =>
                                    updateField(pi, fi, { showIf: { ...f.showIf!, value: e.target.value } })
                                  } />
                              )}
                            </>
                          )}
                        </div>
                        {f.showIf && !controller && (
                          <p className="mt-1 text-xs text-destructive">
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

            <Button
              variant="outline"
              type="button"
              className="mt-3"
              onClick={() =>
                update((s) => {
                  s.pages[pi].fields.push({ id: newFieldId(), type: 'short_text', label: '' });
                  return s;
                })
              }
            >
              <Plus data-icon="inline-start" />
              Add question
            </Button>
            </CardContent>
          </Card>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => update((s) => (s.pages.push({ title: `Page ${s.pages.length + 1}`, fields: [] }), s))}
            title="Each page is a separate step for the candidate — use pages to split long forms"
          >
            <Plus data-icon="inline-start" />
            Add step (page)
          </Button>
          {otherOpenings.length > 0 && (
            <NativeSelect
              className="w-56"
              aria-label="Copy questions from"
              value=""
              disabled={pending}
              onChange={(e) => e.target.value && importFrom(Number(e.target.value))}
            >
              <NativeSelectOption value="">Copy questions from…</NativeSelectOption>
              {otherOpenings.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>{o.title}</NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <div className="flex-1" />
          <Button
            variant="outline"
            type="button"
            disabled={pending || !dirty}
            onClick={() =>
              startTransition(async () => {
                await saveDraft(openingId, schema);
                setDirty(false);
                toast('success', 'Draft saved');
              })
            }
          >
            {dirty ? 'Save draft' : 'Draft saved'}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const { version } = await publish(openingId, schema);
                setDirty(false);
                if (version) toast('success', `Published v${version} — live for new applicants`);
                else toast('error', 'Nothing to publish — no draft found');
              })
            }
          >
            {publishedVersion ? `Publish (replaces v${publishedVersion})` : 'Publish form'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Publishing makes this version live for new applicants; past applications keep the
          version they answered.
        </p>
      </div>

      {/* live preview */}
      <div>
        <Card className="sticky top-8">
          <CardHeader>
            <CardTitle className="font-display text-lg font-semibold">Candidate preview</CardTitle>
            <CardAction>
              <Button type="button" variant="link" size="sm" className="text-muted-foreground" onClick={() => setPreviewAnswers({})}>
                Reset answers
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
          <div className="mb-5 space-y-3 border-b border-dashed border-border pb-5 opacity-60">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Step 1 · Contact details (built in)
            </p>
            {['Full name *', 'Email *', 'Phone'].map((l) => (
              <div key={l} className="space-y-1.5">
                <Label>{l}</Label>
                <Input disabled placeholder="Filled by the candidate" />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Resume *</Label>
              <Input type="file" disabled />
            </div>
          </div>
          {schema.pages.length > 0 && preview.length > 0 && (
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              No questions of your own yet — candidates would only fill the contact details above.
              Add questions on the left.
            </p>
          )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

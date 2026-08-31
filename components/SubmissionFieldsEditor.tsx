'use client';

import { useState } from 'react';

export type SubmissionField = {
  id: string;
  title: string;
  kind: 'file' | 'link' | 'either';
  required: boolean;
};

// Row editor for a task's submission requirements; serializes to a hidden
// JSON input the server action parses and validates.
export default function SubmissionFieldsEditor({
  name,
  initial,
}: {
  name: string;
  initial: SubmissionField[];
}) {
  const [items, setItems] = useState<SubmissionField[]>(initial);
  const patch = (i: number, p: Partial<SubmissionField>) =>
    setItems(items.map((it, k) => (k === i ? { ...it, ...p } : it)));

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      {items.map((it, i) => (
        <div key={it.id} className="flex flex-wrap items-center gap-2">
          <input
            value={it.title}
            onChange={(e) => patch(i, { title: e.target.value })}
            placeholder="e.g. Source code, Live demo…"
            maxLength={200}
            className="input w-64"
          />
          <select
            value={it.kind}
            onChange={(e) => patch(i, { kind: e.target.value as SubmissionField['kind'] })}
            className="input w-40"
          >
            <option value="file">File upload</option>
            <option value="link">Link</option>
            <option value="either">File or link</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={it.required}
              onChange={(e) => patch(i, { required: e.target.checked })}
              className="accent-pine"
            />
            required
          </label>
          <button
            type="button"
            onClick={() => setItems(items.filter((_, k) => k !== i))}
            className="text-sm text-rust underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setItems([
            ...items,
            { id: crypto.randomUUID(), title: '', kind: 'either', required: true },
          ])
        }
        className="btn-quiet"
      >
        + Add requirement
      </button>
      {items.length === 0 && (
        <p className="text-xs text-rust">
          No requirements defined — candidates cannot submit anything until you add at least one.
        </p>
      )}
    </div>
  );
}

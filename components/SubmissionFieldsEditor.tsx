'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';

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
          <Input
            value={it.title}
            onChange={(e) => patch(i, { title: e.target.value })}
            placeholder="e.g. Source code, Live demo…"
            maxLength={200} className="w-64" />
          <NativeSelect
            value={it.kind}
            onChange={(e) => patch(i, { kind: e.target.value as SubmissionField['kind'] })} className="w-40"
          >
            <NativeSelectOption value="file">File upload</NativeSelectOption>
            <NativeSelectOption value="link">Link</NativeSelectOption>
            <NativeSelectOption value="either">File or link</NativeSelectOption>
          </NativeSelect>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={it.required}
              onChange={(e) => patch(i, { required: e.target.checked })}
              
            />
            required
          </label>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-destructive"
            onClick={() => setItems(items.filter((_, k) => k !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        onClick={() =>
          setItems([
            ...items,
            { id: crypto.randomUUID(), title: '', kind: 'either', required: true },
          ])
        }
      >
        <Plus data-icon="inline-start" />
        Add requirement
      </Button>
      {items.length === 0 && (
        <p className="text-xs text-destructive">
          No requirements defined — candidates cannot submit anything until you add at least one.
        </p>
      )}
    </div>
  );
}

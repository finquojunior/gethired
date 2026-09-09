'use client';

import { useRef } from 'react';
import { Bold, Italic, List } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

// Textarea with a tiny formatting toolbar: wraps the selected text in the
// markdown markers that lib/richtext.ts renders on the public pages.
export default function RichTextArea({
  name,
  id,
  defaultValue,
  rows = 6,
  placeholder,
}: {
  name: string;
  id?: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after = before) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e) || 'text';
    el.value = value.slice(0, s) + before + selected + after + value.slice(e);
    el.focus();
    el.setSelectionRange(s + before.length, s + before.length + selected.length);
  };

  const bullet = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, value } = el;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    el.value = value.slice(0, lineStart) + '- ' + value.slice(lineStart);
    el.focus();
    el.setSelectionRange(s + 2, s + 2);
  };

  return (
    <div>
      <div className="mb-1 flex gap-1.5">
        <Button type="button" variant="outline" size="icon-xs" onClick={() => wrap('**')} title="Bold selection" aria-label="Bold selection">
          <Bold />
        </Button>
        <Button type="button" variant="outline" size="icon-xs" onClick={() => wrap('*')} title="Italic selection" aria-label="Italic selection">
          <Italic />
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={bullet} title="Bullet point">
          <List data-icon="inline-start" />
          list
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          select text, then B / I — shown formatted on the public page
        </span>
      </div>
      <Textarea ref={ref} name={name} id={id} rows={rows} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}

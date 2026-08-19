'use client';

import { useRef } from 'react';

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

  const btn = 'rounded border border-line bg-card px-2 py-0.5 text-xs hover:border-pine';
  return (
    <div>
      <div className="mb-1 flex gap-1.5">
        <button type="button" className={`${btn} font-bold`} onClick={() => wrap('**')} title="Bold selection">
          B
        </button>
        <button type="button" className={`${btn} italic`} onClick={() => wrap('*')} title="Italic selection">
          I
        </button>
        <button type="button" className={btn} onClick={bullet} title="Bullet point">
          • list
        </button>
        <span className="self-center text-xs text-ink-soft">
          select text, then B / I — shown formatted on the public page
        </span>
      </div>
      <textarea ref={ref} name={name} id={id} rows={rows} defaultValue={defaultValue} placeholder={placeholder} className="input" />
    </div>
  );
}

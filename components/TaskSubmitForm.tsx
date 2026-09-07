'use client';

import { useRef, useState } from 'react';
import { uploadErrorText } from '@/lib/uploads';

type Requirement = {
  id: string;
  title: string;
  kind: 'file' | 'link' | 'either';
  required: boolean;
  /** formatted date of the latest submission for this item, null if none */
  done: string | null;
};

// The candidate's whole task submission as ONE form: every requirement gets
// its inputs, a single submit sends all of them. With direct uploads enabled,
// each chosen file is uploaded straight to storage first (signed URLs), then
// the form posts only paths + links.
export default function TaskSubmitForm({
  action,
  signUrl,
  direct,
  maxBytes,
  accept,
  requirements,
}: {
  action: string;
  signUrl: string;
  direct: boolean;
  maxBytes: number;
  accept?: string;
  requirements: Requirement[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  const passthrough = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    if (passthrough.current) {
      passthrough.current = false;
      return;
    }
    const el = ref.current!;
    const items = requirements.map((r) => {
      const fileEl = el.elements.namedItem(`file_${r.id}`) as HTMLInputElement | null;
      const linkEl = el.elements.namedItem(`link_${r.id}`) as HTMLInputElement | null;
      return { r, fileEl, file: fileEl?.files?.[0], link: (linkEl?.value ?? '').trim() };
    });

    for (const it of items) {
      if (it.r.required && !it.r.done && !it.file && !it.link) {
        e.preventDefault();
        setError(`"${it.r.title}" is required — attach it before submitting.`);
        return;
      }
      if (it.file && it.file.size > maxBytes) {
        e.preventDefault();
        setError(`"${it.r.title}": file is too large — maximum ${Math.round(maxBytes / 1048576)} MB.`);
        return;
      }
    }
    if (!items.some((it) => it.file || it.link)) {
      e.preventDefault();
      setError('Nothing new to submit — attach at least one file or link.');
      return;
    }

    const withFiles = items.filter((it) => it.file);
    if (!direct || withFiles.length === 0) {
      // plain submit carries the files — but repaint the busy state first
      e.preventDefault();
      setBusy(true);
      setTimeout(() => {
        passthrough.current = true;
        el.requestSubmit();
      }, 0);
      return;
    }
    e.preventDefault();
    setBusy(true);
    setError('');
    let current = '';
    try {
      for (const it of withFiles) {
        current = it.r.title;
        const res = await fetch(signUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: it.file!.name }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { url, path, sig } = (await res.json()) as { url: string; path: string; sig?: string };
        const up = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': it.file!.type || 'application/octet-stream' },
          body: it.file!,
        });
        if (!up.ok) throw new Error(String(up.status));
        (el.elements.namedItem(`filePath_${it.r.id}`) as HTMLInputElement).value = path;
        (el.elements.namedItem(`fileSig_${it.r.id}`) as HTMLInputElement).value = sig ?? '';
        (el.elements.namedItem(`fileName_${it.r.id}`) as HTMLInputElement).value = it.file!.name;
        it.fileEl!.value = '';
      }
      passthrough.current = true;
      el.requestSubmit();
    } catch (err) {
      setError(`"${current}": ${uploadErrorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={ref}
      onSubmit={onSubmit}
      method="post"
      action={action}
      encType="multipart/form-data"
      className="mt-4 space-y-3"
    >
      {requirements.map((r) => (
        <fieldset key={r.id} className="space-y-2 rounded-md border border-line p-4">
          <legend className="px-1 text-sm font-medium">
            {r.title}{' '}
            <span className={`text-xs font-normal ${r.required ? 'text-rust' : 'text-ink-soft'}`}>
              {r.required ? 'required' : 'optional'}
            </span>
          </legend>
          {r.done && (
            <p className="text-xs text-pine-deep">
              Submitted {r.done} — attach again to add a new version.
            </p>
          )}
          <input type="hidden" name={`filePath_${r.id}`} defaultValue="" />
          <input type="hidden" name={`fileSig_${r.id}`} defaultValue="" />
          <input type="hidden" name={`fileName_${r.id}`} defaultValue="" />
          {r.kind !== 'link' && (
            <div>
              <label htmlFor={`file_${r.id}`} className="mb-1 block text-xs text-ink-soft">
                {r.kind === 'either' ? 'Upload a file' : 'File'}
              </label>
              <input id={`file_${r.id}`} type="file" name={`file_${r.id}`} accept={accept} className="input" />
            </div>
          )}
          {r.kind !== 'file' && (
            <div>
              <label htmlFor={`link_${r.id}`} className="mb-1 block text-xs text-ink-soft">
                {r.kind === 'either' ? 'or paste a link' : 'Link'}
              </label>
              <input id={`link_${r.id}`} type="url" name={`link_${r.id}`} placeholder="https://…" className="input" />
            </div>
          )}
        </fieldset>
      ))}
      <label htmlFor="task-note" className="sr-only">Note for the team</label>
      <textarea id="task-note" name="note" rows={2} placeholder="Anything we should know? (context)" className="input" />
      <button className="btn-primary min-h-11" disabled={busy}>
        {busy ? 'Sending…' : 'Submit task'}
      </button>
      {error && <p className="text-sm text-rust" role="alert">{error}</p>}
    </form>
  );
}

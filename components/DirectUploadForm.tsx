'use client';

import { useRef, useState } from 'react';

// Form wrapper that, when direct uploads are enabled, intercepts submit,
// uploads the chosen file straight to Supabase Storage via a signed URL from
// signUrl, writes the stored path into hidden `<fileField>Path` (+`…Sig` if
// present) inputs, then lets the form submit normally without the file bytes.
// With direct=false it behaves exactly like a plain <form>.
type Props = {
  direct: boolean;
  signUrl: string;
  fileField: string;
  maxBytes: number;
  children: React.ReactNode;
} & Omit<React.ComponentProps<'form'>, 'onSubmit'>;

export default function DirectUploadForm({ direct, signUrl, fileField, maxBytes, children, ...form }: Props) {
  const ref = useRef<HTMLFormElement>(null);
  const passthrough = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    if (!direct || passthrough.current) {
      passthrough.current = false;
      return;
    }
    const el = ref.current!;
    const input = el.elements.namedItem(fileField) as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return; // no file chosen — nothing to intercept
    e.preventDefault();
    if (file.size > maxBytes) {
      setError(`File is too large — maximum ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(signUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { url, path, sig } = (await res.json()) as { url: string; path: string; sig?: string };
      const up = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!up.ok) throw new Error(String(up.status));

      (el.elements.namedItem(`${fileField}Path`) as HTMLInputElement).value = path;
      const sigEl = el.elements.namedItem(`${fileField}Sig`) as HTMLInputElement | null;
      if (sigEl) sigEl.value = sig ?? '';
      input!.value = ''; // bytes are already in storage — don't post them again
      input!.required = false;
      passthrough.current = true;
      el.requestSubmit();
    } catch {
      setError('Upload failed — check the file type and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={ref} onSubmit={onSubmit} {...form}>
      {children}
      {busy && <p className="mt-2 text-sm text-ink-soft">Uploading file…</p>}
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
    </form>
  );
}

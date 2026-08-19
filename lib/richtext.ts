// Minimal rich text: a markdown subset (**bold**, *italic*, "- " bullets).
// Input is escaped BEFORE any transformation, so stored text can never inject
// HTML — the output is safe for dangerouslySetInnerHTML.

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderRich(text: string): string {
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  const lines = escapeHtml(text).split('\n');
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (/^- /.test(line)) {
      if (!inList) {
        out.push('<ul class="list-disc pl-5 space-y-0.5">');
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(line.trim() === '' ? '<br>' : `<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

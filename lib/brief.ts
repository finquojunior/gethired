// Task brief materials shared by admin UI, candidate portal, and emails.
// A task brief is any combination of: text (stages.brief), an uploaded
// document (stages.brief_file_path), and reference links (stages.brief_links,
// one URL per line). No node imports — used in tests and client-adjacent code.

/** Parse the newline-separated links column into clean http(s) URLs. */
export function briefLinks(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l));
}

/**
 * Compose the {{brief}} email variable from all three materials. docUrl is the
 * candidate's token-gated download link for the brief document ('' if none).
 */
export function composeBriefEmail(brief: string, linksRaw: string, docUrl: string): string {
  const parts = [brief.trim()];
  const links = briefLinks(linksRaw);
  if (links.length > 0) parts.push(`Reference links:\n${links.join('\n')}`);
  if (docUrl) parts.push(`Task brief document:\n${docUrl}`);
  return parts.filter(Boolean).join('\n\n') || 'Task details will follow.';
}

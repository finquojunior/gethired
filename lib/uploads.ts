// Upload limits shared by client forms and server validation. No node imports.
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_EXTS = new Set(['.pdf', '.doc', '.docx']);
export const RESUME_ACCEPT = '.pdf,.doc,.docx';
export const TASK_MAX_BYTES = 16 * 1024 * 1024;
// Task files (briefs + candidate submissions) accept any type except things
// that run when double-clicked. Code goes in a zip.
export const BLOCKED_EXTS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.dll', '.lnk', '.reg',
  '.hta', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1', '.jar',
  '.sh', '.app', '.dmg', '.pkg', '.deb', '.rpm', '.apk', '.iso', '.img',
]);
export const TASK_TYPE_HELP =
  'Any document, image, archive, or media file up to 16 MB. Programs and scripts (.exe, .bat, .js, .sh …) are not accepted — zip them instead.';
/**
 * Storage extension for a task file name, or null when the type is blocked.
 * Odd extensions are dropped (file is stored without one) so paths stay simple.
 */
export function taskExt(name: string): string | null {
  const m = /\.([^./\\]+)$/.exec(name.trim());
  const ext = m ? `.${m[1].toLowerCase()}` : '';
  if (BLOCKED_EXTS.has(ext)) return null;
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}
/** Shape of a path minted by createSignedUpload — what submit endpoints accept back. */
export const uploadedPathRe = (kind: 'briefs' | 'submissions' | 'resumes') =>
  kind === 'resumes'
    ? /^resumes\/[a-f0-9]{24}\.(pdf|doc|docx)$/
    : new RegExp(`^${kind}/[a-f0-9]{24}(?!(${[...BLOCKED_EXTS].join('|').replace(/\./g, '\\.')})$)(\\.[a-z0-9]{1,10})?$`);
export const POSTER_MAX_BYTES = 3 * 1024 * 1024;
export const POSTER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const POSTER_ACCEPT = '.jpg,.jpeg,.png,.webp';

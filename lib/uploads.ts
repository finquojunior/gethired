// Upload limits shared by client forms and server validation. No node imports.
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_EXTS = new Set(['.pdf', '.doc', '.docx']);
export const RESUME_ACCEPT = '.pdf,.doc,.docx';
export const TASK_MAX_BYTES = 16 * 1024 * 1024;
export const TASK_EXTS = new Set(['.pdf', '.doc', '.docx', '.zip']);
export const TASK_ACCEPT = '.pdf,.doc,.docx,.zip';
/** Shape of a path minted by createSignedUpload — what submit endpoints accept back. */
export const uploadedPathRe = (kind: 'briefs' | 'submissions') =>
  new RegExp(`^${kind}/[a-f0-9]{24}\\.(pdf|doc|docx|zip)$`);
export const POSTER_MAX_BYTES = 3 * 1024 * 1024;
export const POSTER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const POSTER_ACCEPT = '.jpg,.jpeg,.png,.webp';

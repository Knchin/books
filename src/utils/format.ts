/** `1 -> "1"`, `240 -> "240"`. Kept as a function so localisation has one home. */
export function formatPage(page: number): string {
  return String(page);
}

/** Human readable byte count for the settings panel. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Strip the extension and tidy the name of a dropped file. */
export function titleFromFileName(name: string): string {
  const withoutExt = name.replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim();
  return withoutExt.length > 0 ? withoutExt : 'Untitled document';
}

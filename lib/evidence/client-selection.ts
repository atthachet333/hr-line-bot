import { MAX_EVIDENCE_FILES } from './types';

export interface SelectableFile {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export function fileSelectionKey(file: SelectableFile): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** Merge incremental picker selections without replacing or duplicating earlier files. */
export function mergeEvidenceFiles<T extends SelectableFile>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map(fileSelectionKey));
  const merged = [...current];
  for (const file of incoming) {
    const key = fileSelectionKey(file);
    if (!seen.has(key) && merged.length < MAX_EVIDENCE_FILES) {
      seen.add(key);
      merged.push(file);
    }
  }
  return merged;
}

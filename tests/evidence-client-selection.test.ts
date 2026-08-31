import { describe, expect, it } from 'vitest';
import { mergeEvidenceFiles } from '@/lib/evidence/client-selection';

const file = (name: string, size: number, lastModified: number) => ({ name, size, lastModified, type: 'image/jpeg' });

describe('mergeEvidenceFiles', () => {
  it('keeps files selected in separate picker operations', () => {
    const first = file('one.jpg', 10, 1);
    const second = file('two.jpg', 20, 2);
    expect(mergeEvidenceFiles(mergeEvidenceFiles([], [first]), [second])).toEqual([first, second]);
  });

  it('does not duplicate name + size + lastModified and caps at five', () => {
    const duplicate = file('same.jpg', 10, 1);
    const result = mergeEvidenceFiles([duplicate], [duplicate, ...Array.from({ length: 8 }, (_, i) => file(`${i}.jpg`, i, i))]);
    expect(result.filter((item) => item.name === 'same.jpg')).toHaveLength(1);
    expect(result).toHaveLength(5);
  });
});

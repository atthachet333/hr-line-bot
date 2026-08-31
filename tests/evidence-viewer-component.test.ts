import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { EvidenceCards, type ViewerItem } from '@/app/liff/evidence/EvidenceViewer';

describe('EvidenceCards', () => {
  it('renders every evidence item with image preview and PDF card', () => {
    const items: ViewerItem[] = [
      { evidenceId: '1', originalName: 'photo.jpg', mimeType: 'image/jpeg', size: 100, uploadedAt: '', legacy: false, objectUrl: 'blob:photo' },
      { evidenceId: '2', originalName: 'receipt.pdf', mimeType: 'application/pdf', size: 200, uploadedAt: '', legacy: false, objectUrl: 'blob:pdf' },
    ];
    const html = renderToStaticMarkup(createElement(EvidenceCards, { items }));
    expect(html).toContain('photo.jpg');
    expect(html).toContain('receipt.pdf');
    expect(html).toContain('blob:photo');
    expect(html).toContain('PDF');
  });
});

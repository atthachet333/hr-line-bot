'use client';

import { EvidenceViewer } from './EvidenceViewer';

/**
 * Base evidence-viewer route. This is the LIFF app's Endpoint URL
 * (https://s2aline.s2aconsultant.com/liff/evidence). LINE opens it with
 * `?requestId=...` (or `?liff.state=...`); EvidenceViewer resolves the requestId
 * from the URL after liff.init(), so the base endpoint never 404s.
 */
export default function EvidenceBasePage() {
  return <EvidenceViewer />;
}

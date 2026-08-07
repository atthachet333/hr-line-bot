'use client';

import { useParams } from 'next/navigation';
import { EvidenceViewer } from '../EvidenceViewer';

export default function EvidenceViewerRoutePage() {
  const params = useParams<{ requestId: string }>();
  const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
  return <EvidenceViewer requestId={requestId} />;
}

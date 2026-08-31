import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { LeaveEvidenceRecord, PublicEvidenceItem } from './types';

export const LEGACY_EVIDENCE_ID = 'legacy';

export function normalizeEvidenceItems(
  request: LeaveRequest,
  records: LeaveEvidenceRecord[],
): PublicEvidenceItem[] {
  if (records.length > 0) {
    return records.map((record) => ({
      evidenceId: record.evidenceId,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
      uploadedAt: record.uploadedAt,
      legacy: false,
    }));
  }
  if (request.evidenceStatus !== 'AVAILABLE' || !request.evidenceRelativePath) return [];
  return [{
    evidenceId: LEGACY_EVIDENCE_ID,
    originalName: request.evidenceOriginalFileName || request.evidenceStoredFileName || 'evidence',
    mimeType: request.evidenceMimeType || 'application/octet-stream',
    size: request.evidenceSize || 0,
    uploadedAt: request.evidenceUploadedAt || request.createdAt,
    legacy: true,
  }];
}

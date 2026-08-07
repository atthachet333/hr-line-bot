/** Leave-evidence domain types (shared by validation, storage, repository). */

export const EVIDENCE_STATUS = ['NONE', 'AVAILABLE', 'UPLOAD_FAILED', 'DELETED'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUS)[number];

/** Metadata stored in the LeaveRequests sheet (NEVER binary/base64/absolute path). */
export interface EvidenceMetadata {
  evidenceStatus: EvidenceStatus;
  evidenceOriginalFileName: string;
  evidenceStoredFileName: string;
  /** employeeId/requestId/storedFileName — relative to the storage root only. */
  evidenceRelativePath: string;
  evidenceMimeType: string;
  evidenceSize: number;
  evidenceUploadedAt: string;
  evidenceSha256: string;
}

export function emptyEvidenceMetadata(): EvidenceMetadata {
  return {
    evidenceStatus: 'NONE',
    evidenceOriginalFileName: '',
    evidenceStoredFileName: '',
    evidenceRelativePath: '',
    evidenceMimeType: '',
    evidenceSize: 0,
    evidenceUploadedAt: '',
    evidenceSha256: '',
  };
}

export type EvidenceErrorCode =
  | 'UNSUPPORTED_EVIDENCE_TYPE'
  | 'EVIDENCE_TOO_LARGE'
  | 'EVIDENCE_CONTENT_MISMATCH'
  | 'EVIDENCE_UPLOAD_FAILED';

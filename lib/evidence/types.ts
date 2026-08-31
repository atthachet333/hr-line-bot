/** Leave-evidence domain types (shared by validation, storage, repository). */

export const EVIDENCE_STATUS = ['NONE', 'AVAILABLE', 'UPLOAD_FAILED', 'DELETED'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUS)[number];

export const MAX_EVIDENCE_FILES = 5;
export const LEAVE_EVIDENCE_COLUMNS = [
  'evidenceId',
  'requestId',
  'employeeId',
  'originalName',
  'storedName',
  'mimeType',
  'size',
  'relativePath',
  'uploadedAt',
  'status',
  'sha256',
] as const;

/** One row in the LeaveEvidence sheet. Paths are always storage-root relative. */
export interface LeaveEvidenceRecord {
  evidenceId: string;
  requestId: string;
  employeeId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  relativePath: string;
  uploadedAt: string;
  status: Extract<EvidenceStatus, 'AVAILABLE' | 'DELETED'>;
  sha256: string;
}

/** Safe metadata returned to the viewer. Never includes a filesystem path. */
export interface PublicEvidenceItem {
  evidenceId: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  legacy: boolean;
}

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
  | 'TOO_MANY_EVIDENCE_FILES'
  | 'EVIDENCE_TOTAL_TOO_LARGE'
  | 'EVIDENCE_CONTENT_MISMATCH'
  | 'EVIDENCE_UPLOAD_FAILED';

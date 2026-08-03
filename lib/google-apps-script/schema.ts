import { z } from 'zod';

/**
 * Contract for every Google Apps Script response. All actions
 * (getBalance / checkin / checkout / transitionLeaveStatus) must return this
 * shape as JSON. HTTP 200 alone is NOT treated as success — `success` + `code`
 * are authoritative.
 */
export const appsScriptEnvelopeSchema = z.object({
  success: z.boolean(),
  code: z.string().min(1),
  message: z.string().optional(),
  data: z.unknown().optional(),
});
export type AppsScriptEnvelope = z.infer<typeof appsScriptEnvelopeSchema>;

// ---- transitionLeaveStatus ----
export const transitionDataSchema = z.object({
  requestId: z.string(),
  previousStatus: z.string().optional(),
  currentStatus: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedByLineUserId: z.string().optional(),
  approvedAt: z.string().optional(),
  rejectedBy: z.string().optional(),
  rejectedByLineUserId: z.string().optional(),
  rejectedAt: z.string().optional(),
  rejectedReason: z.string().optional(),
  approvalSource: z.string().optional(),
});
export type TransitionData = z.infer<typeof transitionDataSchema>;

// ---- getBalance ----
export const balanceDataSchema = z
  .object({
    name: z.string().optional(),
    empId: z.string().optional(),
    position: z.string().optional(),
    department: z.string().optional(),
    sickTotal: z.number().optional(),
    sickUsed: z.number().optional(),
    personalTotal: z.number().optional(),
    personalUsed: z.number().optional(),
    annualTotal: z.number().optional(),
    annualUsed: z.number().optional(),
    history: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type BalanceData = z.infer<typeof balanceDataSchema>;

// ---- attendance ----
export const attendanceDataSchema = z
  .object({
    date: z.string().optional(),
    time: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

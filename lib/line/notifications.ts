/**
 * Backward-compatible re-exports. The employee approval/rejection message
 * builders (Flex + text fallback) now live in `employee-result-flex.ts`.
 */
export {
  approvedEmployeeText,
  rejectedEmployeeText,
  buildApprovedLeaveFlexMessage,
  buildRejectedLeaveFlexMessage,
  buildEmployeeResultMessages,
} from './employee-result-flex';

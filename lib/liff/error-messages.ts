/**
 * Client-safe error codes for the LIFF session / API layer, and their Thai
 * messages. Shared by every LIFF page so wording is consistent.
 */
export type LiffClientErrorCode =
  | 'LIFF_INIT_FAILED'
  | 'LIFF_LOGIN_REQUIRED'
  | 'LIFF_ACCESS_TOKEN_MISSING'
  | 'AUTHENTICATION_ERROR'
  | 'EMPLOYEE_NOT_LINKED'
  | 'BALANCE_NOT_CONFIGURED'
  | 'BALANCE_DATA_INVALID';

export const LIFF_ERROR_MESSAGES: Record<LiffClientErrorCode, string> = {
  LIFF_INIT_FAILED: 'ไม่สามารถเริ่มระบบ LINE ได้ กรุณาปิดหน้านี้แล้วเปิดจากเมนูอีกครั้ง',
  LIFF_LOGIN_REQUIRED: 'กรุณาเข้าสู่ระบบ LINE ใหม่',
  LIFF_ACCESS_TOKEN_MISSING: 'ไม่พบข้อมูลเข้าสู่ระบบ กรุณาปิดหน้านี้แล้วเปิดจากเมนูอีกครั้ง',
  AUTHENTICATION_ERROR: 'เซสชัน LINE หมดอายุ กรุณาลองใหม่หรือเปิดจากเมนูอีกครั้ง',
  EMPLOYEE_NOT_LINKED: 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับข้อมูลพนักงาน',
  BALANCE_NOT_CONFIGURED: 'ยังไม่ได้กำหนดสิทธิ์วันลาของคุณ กรุณาติดต่อฝ่ายบุคคล',
  BALANCE_DATA_INVALID: 'ข้อมูลสิทธิ์วันลาไม่ถูกต้อง กรุณาติดต่อฝ่ายบุคคล',
};

const DEFAULT_MESSAGE = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';

/** Map a client/server error code to a Thai message (with a safe fallback). */
export function liffErrorMessage(code: string | undefined | null, fallback?: string): string {
  if (code && code in LIFF_ERROR_MESSAGES) {
    return LIFF_ERROR_MESSAGES[code as LiffClientErrorCode];
  }
  return fallback || DEFAULT_MESSAGE;
}

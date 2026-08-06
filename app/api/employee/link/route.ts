import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken, readJsonBody } from '@/lib/http/guards';
import { ok, fail } from '@/lib/http/respond';
import { AuthenticationError, BusinessRuleError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskId } from '@/lib/utils/mask';
import { verifyIdentity } from '@/lib/line/identity';
import { linkEmployee, normalizeEmployeeId } from '@/lib/repositories/employee-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/employee/link';
const EMPLOYEE_ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

/**
 * First-time self-service account linking. The employee proves who they are via
 * their verified LINE access token, then supplies their employeeId. The server
 * writes the verified LINE user id into the (blank) Employees row — it never
 * creates employees and never overwrites a different existing link.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const accessToken = bearerToken(req);
    if (!accessToken) {
      throw new AuthenticationError('กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง');
    }
    const identity = await verifyIdentity({ accessToken });
    if (!identity.ok) {
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const lineUserId = identity.identity.lineUserId;

    const body = await readJsonBody<Record<string, unknown>>(req);
    const rawEmployeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    const employeeId = normalizeEmployeeId(rawEmployeeId);
    if (!EMPLOYEE_ID_RE.test(employeeId)) {
      throw new ValidationError('กรุณากรอกรหัสพนักงานให้ถูกต้อง');
    }

    const result = await linkEmployee(employeeId, lineUserId);

    switch (result.status) {
      case 'linked':
      case 'already_linked': {
        if (result.status === 'linked') {
          await auditLog.append({
            requestId: employeeId,
            action: 'EMPLOYEE_LINKED',
            actorLineUserId: lineUserId,
            actorName: result.employee.name,
            detail: `linked ${employeeId}`,
          });
        }
        logger.info('employee_link', {
          route: ROUTE,
          correlationId,
          result: 'ok',
          code: result.status === 'linked' ? 'LINKED' : 'ALREADY_LINKED',
          verifiedLineUserIdMasked: maskId(lineUserId),
        });
        return ok(correlationId, result.status === 'linked' ? 'EMPLOYEE_LINKED' : 'ALREADY_LINKED', {
          linked: true,
          employee: {
            employeeId: result.employee.employeeId,
            name: result.employee.name,
            position: result.employee.position,
            department: result.employee.department,
          },
        });
      }
      case 'employee_not_found':
        throw new BusinessRuleError('EMPLOYEE_NOT_FOUND', 'ไม่พบรหัสพนักงานนี้ในระบบ กรุณาตรวจสอบอีกครั้ง', 404);
      case 'employee_already_linked':
        throw new BusinessRuleError(
          'EMPLOYEE_ALREADY_LINKED',
          'รหัสพนักงานนี้เชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อฝ่ายบุคคล',
          409,
        );
      case 'line_already_linked':
        throw new BusinessRuleError(
          'LINE_ACCOUNT_ALREADY_LINKED',
          'บัญชี LINE นี้เชื่อมกับพนักงานรายอื่นแล้ว กรุณาติดต่อฝ่ายบุคคล',
          409,
        );
      default:
        throw new Error('unreachable link result');
    }
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}

import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken } from '@/lib/http/guards';
import { fail } from '@/lib/http/respond';
import { AuthenticationError, BusinessRuleError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskEmployeeId } from '@/lib/utils/mask';
import { verifyIdentity } from '@/lib/line/identity';
import { findByLineUserId } from '@/lib/repositories/employee-repository';
import { computeBalanceSummary } from '@/lib/services/balance-summary-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'GET /api/balance/me';

/**
 * Live leave-balance summary for the signed-in employee.
 *
 * Identity is derived ONLY from the verified LINE access token → Employees sheet
 * → employeeId. Entitlements come from the Balances sheet (keyed by employeeId);
 * `used` is computed from APPROVED LeaveRequests. No client-supplied id is
 * trusted, and no fabricated 0 balance is returned. Always `no-store`.
 */
export async function GET(req: Request): Promise<NextResponse> {
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

    const employee = await findByLineUserId(lineUserId);
    if (!employee) {
      throw new BusinessRuleError(
        'EMPLOYEE_NOT_LINKED',
        'ยังไม่พบการผูกบัญชีพนักงานของคุณ กรุณาติดต่อฝ่ายบุคคล',
        403,
      );
    }

    const outcome = await computeBalanceSummary(lineUserId, employee.employeeId);

    logger.info('balance_lookup', {
      route: ROUTE,
      correlationId,
      employeeIdMasked: maskEmployeeId(employee.employeeId),
      balanceRowFound: outcome.meta.balanceRowFound,
      entitlementFieldsFound: outcome.meta.entitlementFieldsFound,
      approvedLeaveCount: outcome.meta.approvedLeaveCount,
      result: outcome.ok ? 'ok' : 'error',
      code: outcome.ok ? undefined : outcome.code,
    });

    if (!outcome.ok) {
      throw new BusinessRuleError(outcome.code, outcome.message, 422);
    }

    return noStore(
      NextResponse.json({
        success: true,
        balances: outcome.summary,
        source: { entitlement: 'Balances', used: 'LeaveRequests' },
        correlationId,
      }),
    );
  } catch (err) {
    return noStore(fail(err, correlationId, { route: ROUTE }));
  }
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

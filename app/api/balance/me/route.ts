import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken } from '@/lib/http/guards';
import { fail } from '@/lib/http/respond';
import { AuthenticationError, BusinessRuleError } from '@/lib/errors';
import { logger } from '@/lib/logger';
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
 * → employeeId. `used` is computed server-side from APPROVED LeaveRequests, and
 * entitlements come from the Balances sheet. No client-supplied id is trusted.
 * Always `no-store` so the tab reflects the latest state after an approval.
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

    const balances = await computeBalanceSummary(lineUserId, employee.employeeId);

    logger.info('balance_summary', {
      correlationId,
      route: ROUTE,
      actorType: 'employee',
      result: 'ok',
    });

    return noStore(NextResponse.json({ success: true, balances, correlationId }));
  } catch (err) {
    return noStore(fail(err, correlationId, { route: ROUTE }));
  }
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

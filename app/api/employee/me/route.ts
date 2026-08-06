import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken } from '@/lib/http/guards';
import { fail } from '@/lib/http/respond';
import { AuthenticationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskId } from '@/lib/utils/mask';
import { verifyIdentity } from '@/lib/line/identity';
import { findByLineUserId } from '@/lib/repositories/employee-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'GET /api/employee/me';

/**
 * Report whether the caller's verified LINE account is linked to an employee.
 * Identity is derived ONLY from the verified access token → Employees sheet.
 * No employeeId/userId from the client is trusted. Always `no-store`.
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
      logger.info('employee_me', {
        route: ROUTE,
        correlationId,
        code: 'EMPLOYEE_NOT_LINKED',
        verifiedLineUserIdMasked: maskId(lineUserId),
        employeeLookupResult: 'not_found',
      });
      return noStore(
        NextResponse.json({ success: true, linked: false, code: 'EMPLOYEE_NOT_LINKED', correlationId }),
      );
    }

    return noStore(
      NextResponse.json({
        success: true,
        linked: true,
        employee: {
          employeeId: employee.employeeId,
          name: employee.name,
          position: employee.position,
          department: employee.department,
        },
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

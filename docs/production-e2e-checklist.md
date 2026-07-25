# Production E2E Checklist

Run through this before promoting to production and after each deploy. Items
marked (auto) are covered by automated tests / scripts; the rest require real
LINE + Google credentials and must be verified manually.

## Pre-deploy (auto)
- [ ] `npm run validate:env -- --prod` passes (auto)
- [ ] `npm run validate:sheets` passes against the target spreadsheet
- [ ] `npm run lint` clean (auto)
- [ ] `npm run typecheck` clean (auto)
- [ ] `npm run test` all pass (auto)
- [ ] `npm run build` succeeds (auto)
- [ ] `npm run security:check` — no secrets, audit reviewed (auto)
- [ ] Backup of the Google Sheet taken (see README → Backup)

## Identity & Leave request
- [ ] Employee opens the LIFF from inside LINE
- [ ] LIFF token is verified server-side (a request with a forged token → 401)
- [ ] A user cannot spoof employeeId/name (server resolves identity itself)
- [ ] A request is created exactly once (double-submit / retry → same requestId)
- [ ] `totalDays` is computed on the server (weekends/holidays excluded per config)
- [ ] Overlapping date ranges are rejected (`OVERLAPPING_LEAVE_REQUEST`)
- [ ] Insufficient balance is rejected (`INSUFFICIENT_LEAVE_BALANCE`)
- [ ] Unknown leave type is rejected (`UNKNOWN_LEAVE_TYPE`)
- [ ] Balance service failure does NOT create an approved request

## Manager approval
- [ ] Manager Bot receives the Flex message for a new request
- [ ] Postback reaches `/api/line/manager/webhook`
- [ ] Invalid `x-line-signature` → 401, not processed
- [ ] Postback from a wrong group is rejected
- [ ] A manager who is not the assigned manager is rejected
- [ ] HR admin can approve/reject any request (override)
- [ ] Request with no assigned manager: normal manager denied, HR admin allowed
- [ ] Two managers tapping at once → only the first transition succeeds (atomic)
- [ ] Duplicate webhook delivery (same webhookEventId) does NOT change status twice
- [ ] Reject flow: pick a reason → `rejectedReason` stored

## Employee notification
- [ ] Employee Bot delivers the approval/rejection result
- [ ] If employee notification fails, approval still stands (status unchanged)
- [ ] Failed notification recorded in `employeeNotificationStatus` + audit log
- [ ] `POST /api/internal/leave/:id/retry-employee-notification` re-sends (auth required)
- [ ] Retry does NOT create a new request or change approval status

## Attendance
- [ ] Check-in succeeds and returns the real Apps Script result
- [ ] Duplicate check-in same day is rejected (`ALREADY_CHECKED_IN`)
- [ ] Check-out before check-in is rejected (`NOT_CHECKED_IN`)
- [ ] Duplicate check-out is rejected (`ALREADY_CHECKED_OUT`)
- [ ] Success popup only shows AFTER the server confirms

## Infrastructure
- [ ] `GET /api/health` → 200 `{status:"ok"}`
- [ ] `GET /api/ready` → 200 `{status:"ready"}` (503 when a dependency is down)
- [ ] Operational logs contain NO tokens/secrets/private keys
- [ ] Google Sheet schema matches (LeaveRequests/Employees/AuditLog headers)
- [ ] Rollback procedure reviewed and ready (see README → Rollback)

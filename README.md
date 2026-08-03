# 🚀 HR LINE Bot & LIFF Application

ระบบลางาน–อนุมัติ และลงเวลาเข้า/ออกงานผ่าน LINE โดยใช้ LIFF + Next.js (App Router) + Google Sheets
รองรับ LINE **2 บอต** แยกหน้าที่กันชัดเจน:

- **Employee Bot** — เปิด LIFF ยื่นลางาน / ดูยอดวันลา / เช็กอิน–เช็กเอาต์ และรับผลอนุมัติ
- **Manager Bot** — รับ Flex Message คำขอลา พร้อมปุ่มอนุมัติ/ไม่อนุมัติ และประมวลผลผ่าน Webhook

---

## 🧭 สถาปัตยกรรม / Flow หลัก

```
Employee LIFF (ฟอร์มลางาน)
  → POST /api/leave
  → Verify LINE Identity (ตรวจ LIFF token ฝั่ง Server)
  → Validate + Resolve Employee (จาก Sheet/Apps Script)
  → Save PENDING (Google Sheets)
  → ส่ง Flex Message ไป Manager Bot (ตรวจผล LINE API จริง)
  → Manager กดปุ่ม → POST /api/line/manager/webhook
  → ตรวจ x-line-signature + ตรวจสิทธิ์หัวหน้า (จาก event.source.userId)
  → เปลี่ยนสถานะ PENDING → APPROVED/REJECTED (กันกดซ้ำ + กัน event ซ้ำ)
  → บันทึก Audit Log
  → แจ้งผลกลับพนักงานผ่าน Employee Bot (ตรวจผล LINE API จริง)
```

หลักการออกแบบ:

- **ไม่เชื่อข้อมูลตัวตนจาก Browser** — Server ตรวจ LIFF token กับ LINE แล้วดึง `userId` เอง จากนั้นค้นหาพนักงานฝั่ง Server
- **ไม่คืน `success: true` ถ้า External API ล้มเหลว** — แยกเคส "บันทึกสำเร็จแต่แจ้งเตือนไม่สำเร็จ"
- **Idempotency** — `clientRequestId` กันส่งซ้ำตอนยื่นลา, ตรวจสถานะเดิมก่อนอัปเดต, และ dedupe `webhookEventId`
- **Repository Layer** — แยกโค้ดจัดการ Google Sheets ออกจาก Route Handler เพื่อเปลี่ยน DB ในอนาคตได้ง่าย
- **ไม่มี Secret / Apps Script URL ใน Client Bundle** — ย้ายไป Environment Variable ทั้งหมด

---

## 🗂 โครงสร้างโค้ดที่เพิ่ม

```
lib/
  env.ts                                  # อ่าน env รวมศูนย์ + ตรวจสิทธิ์หัวหน้า
  hooks/use-mounted.ts                    # mount guard (client) แบบ lint-clean
  utils/
    datetime.ts                           # ISO 8601 + Asia/Bangkok + นับวันลา
    request-id.ts                         # สร้าง REQ-YYYYMMDD-XXXXXXXX
  domain/leave-request.ts                 # โมเดล LeaveRequest + สถานะ + ลำดับคอลัมน์
  validation/
    leave.ts                              # validate ฟอร์มลางาน
    attendance.ts                         # validate เช็กอิน/เช็กเอาต์
  line/
    types.ts  signature.ts  postback.ts   # types, ตรวจ signature, encode/parse postback
    client-core.ts                        # push/reply/getProfile + ตรวจ response
    employee-client.ts  manager-client.ts # แยก token 2 บอตชัดเจน
    identity.ts                           # ตรวจ LIFF id/access token กับ LINE
    flex-message.ts  notifications.ts     # Flex สำหรับหัวหน้า + ข้อความแจ้งพนักงาน
  google-apps-script/client.ts            # เรียก Apps Script ฝั่ง Server (timeout/HTTP/JSON)
  sheets/client.ts                        # Google Sheets client (service account)
  repositories/
    employee-repository.ts                # ค้นหาพนักงานจาก lineUserId
    leave-request-repository.ts           # create/find/transition + notification status
    audit-log-repository.ts               # Audit log + dedupe webhookEventId

app/api/
  leave/route.ts                          # ยื่นคำขอลา (จุดกลางจุดเดียว)
  line/manager/webhook/route.ts           # Manager Webhook (อนุมัติ/ปฏิเสธ)
  attendance/check-in/route.ts            # เช็กอิน (ผ่าน Server)
  attendance/check-out/route.ts           # เช็กเอาต์ (ผ่าน Server)
  balance/route.ts                        # ดูยอดวันลา (proxy getBalance เท่านั้น)
```

---

## ⚙️ Environment Variables

ดูรายละเอียดแต่ละค่าใน [`.env.example`](.env.example). สรุปชื่อตัวแปร:

| ตัวแปร | หน้าที่ |
| --- | --- |
| `EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN` | push ผลอนุมัติให้พนักงาน (Employee bot) |
| `EMPLOYEE_LINE_CHANNEL_SECRET` | secret ของ Employee channel (สำรอง) |
| `EMPLOYEE_LIFF_ID` | LIFF ID ของฟอร์มลางาน |
| `EMPLOYEE_LINE_LOGIN_CHANNEL_ID` | channel id สำหรับตรวจ LIFF ID token (fallback = prefix ของ LIFF ID) |
| `MANAGER_LINE_CHANNEL_ACCESS_TOKEN` | ส่ง Flex + reply postback (Manager bot) |
| `MANAGER_LINE_CHANNEL_SECRET` | **จำเป็น** — ตรวจ `x-line-signature` ของ webhook |
| `MANAGER_GROUP_ID` | กลุ่มหัวหน้าที่รับแจ้งเตือน (ถ้ามี) |
| `MANAGER_USER_IDS` | รายชื่อ LINE user id ของหัวหน้า (คั่นด้วย comma) — ใช้ตรวจสิทธิ์ |
| `APP_BASE_URL` | base URL ของแอป |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | service account อ่าน/เขียน Sheet |
| `GOOGLE_SHEET_ID` | รหัส Spreadsheet |
| `GOOGLE_APPS_SCRIPT_URL` | Web app ของ Apps Script (server-only) |
| `SHEET_LEAVE_REQUESTS` / `SHEET_EMPLOYEES` / `SHEET_AUDIT_LOG` | (optional) override ชื่อชีต |
| `NEXT_PUBLIC_LIFF_ID*` | LIFF ID ฝั่ง client (leave/balance/checkin/checkout) |

> ห้ามใส่ token/secret จริงในไฟล์ที่ commit และห้าม log token/secret

---

## 📊 Google Sheets Schema

### ชีต `LeaveRequests`
คอลัมน์ (แถวแรกเป็น header — ระบบสร้าง header อัตโนมัติถ้ายังว่าง):

คอลัมน์เต็ม (canonical) ดูที่หัวข้อ **Google Sheets schema (updated)** ด้านล่าง
ซึ่งรวมคอลัมน์ผู้อนุมัติ (`approvedByLineUserId`, `rejectedByLineUserId`,
`approvalSource`) และคอลัมน์ติดตามการแจ้งเตือน manager/employee.

สถานะที่รองรับ: `PENDING` · `APPROVED` · `REJECTED` · `CANCELLED`
เวลาเก็บเป็น ISO 8601 (UTC) และแสดงผลเป็น `Asia/Bangkok` (ปี พ.ศ.)

### ชีต `Employees` (ใช้ resolve ตัวตน — ค้นด้วยชื่อคอลัมน์ ไม่อิงลำดับ)

```
lineUserId | employeeId | name | position | department | managerLineUserId
```

ตัวอย่าง:

```
Uabc123... | EMP001 | สมชาย ใจดี | Developer | IT | Umanager1...
```

> ถ้าไม่พบใน `Employees` ระบบจะ fallback ไปเรียก Apps Script `action=getBalance`
> (ใช้โครงเดิมที่มีอยู่) หากยังไม่พบจะตอบ error และ **ไม่บันทึกคำขอ**

### ชีต `AuditLog`

```
timestamp | requestId | action | actorLineUserId | actorName |
fromStatus | toStatus | detail | webhookEventId
```

`action` เช่น `CREATE`, `APPROVE`, `REJECT`, `DUPLICATE_ACTION`, `UNAUTHORISED_ACTION`,
`NOTIFY_MANAGER_FAILED`, `NOTIFY_EMPLOYEE_FAILED`
คอลัมน์ `webhookEventId` ใช้ตรวจ event ซ้ำจาก LINE

---

## 🔧 LINE Developers Setup

### Employee Bot
1. สร้าง **Messaging API Channel** (Employee)
2. เก็บ **Channel Access Token** → `EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN`
3. เก็บ **Channel Secret** → `EMPLOYEE_LINE_CHANNEL_SECRET`
4. ให้พนักงาน **เพิ่ม Employee Bot เป็นเพื่อน** (จำเป็นสำหรับ push ผลอนุมัติ)
5. สร้าง **LIFF App** (ฟอร์มลางาน/ยอดวันลา/เช็กอิน/เช็กเอาต์) ตั้ง **Endpoint URL** เป็น
   `https://YOUR_DOMAIN/liff/leave` (และ `/liff/balance`, `/liff/checkin`, `/liff/checkout`)
6. เปิดสิทธิ์ **profile / openid** ให้ LIFF (เพื่อออก ID token)
7. ใส่ LIFF ID ลง `NEXT_PUBLIC_LIFF_ID*` และ `EMPLOYEE_LIFF_ID`
8. ใส่ **LINE Login channel ID** ของ LIFF ลง `EMPLOYEE_LINE_LOGIN_CHANNEL_ID`

### Manager Bot
1. สร้าง **Messaging API Channel แยกต่างหาก** (Manager)
2. เก็บ **Channel Access Token** → `MANAGER_LINE_CHANNEL_ACCESS_TOKEN`
3. เก็บ **Channel Secret** → `MANAGER_LINE_CHANNEL_SECRET`
4. เปิดใช้งาน **Webhook** และตั้ง **Webhook URL**:
   ```
   https://YOUR_DOMAIN/api/line/manager/webhook
   ```
5. กด **Verify** (webhook ต้องตอบ 200 เมื่อ signature ถูกต้อง)
6. เพิ่ม Manager Bot เข้ากลุ่มหัวหน้า → ใส่ `MANAGER_GROUP_ID`
   **หรือ** ระบุ `MANAGER_USER_IDS` เป็นรายชื่อหัวหน้า
7. ปิด auto-reply/greeting ของ Manager bot เพื่อไม่ให้รบกวน

#### วิธีหา Group ID / User ID อย่างปลอดภัย
- **User ID**: ให้หัวหน้าเปิด LIFF/แชทกับบอต แล้วอ่าน `userId` จาก webhook event ชั่วคราว
  (log ฝั่ง server เฉพาะช่วง setup แล้วลบทิ้ง — **ห้าม** hardcode ลง client)
- **Group ID**: หลังเพิ่มบอตเข้ากลุ่ม จะมี event เข้ามาพร้อม `source.groupId` ให้บันทึกค่านั้น

### ข้อจำกัดการ Push Message
พนักงานต้อง **เพิ่ม Employee Bot เป็นเพื่อน** (หรืออยู่ในบริบทที่ LINE อนุญาต) จึงจะได้รับผลอนุมัติ
หากส่งไม่ได้ ระบบ **ไม่ทำให้การอนุมัติล้มเหลว** แต่จะบันทึก `lineNotificationStatus=EMPLOYEE_NOTIFY_FAILED`
พร้อม error ไว้ใน Sheet/Audit log เพื่อให้ตรวจสอบภายหลัง

---

## 🚫 การจัดการ Reject (รอบแรก)

LINE Postback ไม่เหมาะกับการกรอกเหตุผลยาว รอบนี้เลือกแนวทาง **"ปฏิเสธทันทีพร้อมเหตุผลเริ่มต้น"**
(`rejectedReason` เป็น optional) เพื่อให้ Flow อนุมัติหลักทำงานได้จริงและไม่ซับซ้อนเกินไป
สามารถต่อยอดเป็น "เปิด LIFF ให้หัวหน้ากรอกเหตุผล" ได้ภายหลังโดยไม่กระทบ schema (มีคอลัมน์ `rejectedReason` รองรับแล้ว)

---

## 🧩 หมายเหตุการตั้งค่า Apps Script (เช็กอิน/เช็กเอาต์/ยอดวันลา)

Route ฝั่ง Server เรียก Apps Script แบบ **GET + query params** (ช่องทางเดียวกับ `getBalance` เดิม)
โปรดตรวจให้ Apps Script รองรับ `action=checkin` / `action=checkout` / `action=getBalance`
ผ่าน `e.parameter` และ **ตอบกลับเป็น JSON** เช่น `{"status":"success","message":"..."}`
(เดิม client เคย POST แบบ `no-cors` ซึ่งอ่านผลจริงไม่ได้ — ตอนนี้เรียกฝั่ง server จึงตรวจผลจริงได้)

---

## 🧪 การรัน / ตรวจสอบ

```bash
npm install
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (unit)
npm run build       # Production build
npm run dev         # dev server (port 3333)
```

Automated tests ครอบคลุม: ตรวจ webhook signature, encode/parse postback, validate วันที่/ฟอร์ม,
request id, และ transition ของ leave request (อนุมัติ PENDING + กันอนุมัติซ้ำ)

---

## ✅ ขั้นตอนทดสอบ End-to-End

1. พนักงานเปิด LIFF ฟอร์มลางาน (จากแอป LINE)
2. กรอกประเภท/วันที่/เหตุผล แล้วกดส่ง → หน้าโชว์ผลจาก response จริง
3. ตรวจว่ามีแถวสถานะ `PENDING` ใน `LeaveRequests`
4. Manager Bot ได้รับ Flex Message พร้อมปุ่มอนุมัติ/ไม่อนุมัติ
5. หัวหน้ากด "อนุมัติ" → ระบบตรวจ signature + สิทธิ์
6. ตรวจว่าสถานะใน Sheet เปลี่ยนเป็น `APPROVED` และมี `approvedBy`/`approvedAt`
7. ตรวจว่าพนักงานได้รับข้อความผลอนุมัติจาก Employee Bot
8. กดปุ่มเดิมซ้ำ → ระบบตอบ "ถูกดำเนินการไปแล้ว" และไม่เปลี่ยนสถานะซ้ำ

---

# 🏭 Production Operations (Round 2 Hardening)

## Architecture additions
- **Atomic approval** — status transitions go through the Apps Script
  `transitionLeaveStatus` action which uses `LockService.getScriptLock()`, so
  only the first PENDING→APPROVED/REJECTED write wins even with concurrent taps
  or duplicate webhook deliveries. Falls back to a (non-atomic) repository guard
  only when `GOOGLE_APPS_SCRIPT_URL` is not configured.
- **Idempotency** — leave submissions are deduped by `employeeLineUserId +
  clientRequestId`; retries return the existing request (no new row, no duplicate
  Flex). Attendance carries a `clientRequestId` and Apps Script dedupes by
  `userId + date + type`.
- **Split notification tracking** — `managerNotification*` and
  `employeeNotification*` columns (status/attempts/lastAttemptAt/error).
- **Per-request authorization** — `isAuthorisedManagerForRequest`: a manager may
  act only on their assigned request; **HR admins** (`HR_ADMIN_USER_IDS`) may
  override any request. Group postbacks must come from `MANAGER_GROUP_ID`.
- **Server-side leave rules** — `totalDays` computed server-side (weekends via
  `LEAVE_COUNT_WEEKENDS`, company holidays from the `Holidays` sheet); balance +
  overlap checked before saving.
- **Uniform errors** — every API returns `{success:false, code, message,
  correlationId}`; technical detail stays in server logs only.
- **Structured logging** with secret redaction (`lib/logger.ts`).

## New environment variables
| ตัวแปร | หน้าที่ |
| --- | --- |
| `HR_ADMIN_USER_IDS` | LINE user IDs ที่เป็น HR admin (override ได้ทุกคำขอ) |
| `INTERNAL_API_SECRET` | secret ป้องกัน endpoint ภายใน (retry) — **จำเป็นใน production** |
| `LEAVE_COUNT_WEEKENDS` | นับเสาร์อาทิตย์เป็นวันลาหรือไม่ (`true`/`false`, ค่าเริ่มต้น `false`) |
| `SHEET_HOLIDAYS` | (optional) ชื่อชีตวันหยุด (ค่าเริ่มต้น `Holidays`) |
| `EMPLOYEE_LINE_LOGIN_CHANNEL_ID` | channel id สำหรับตรวจ LIFF ID token |

## Google Sheets schema (updated)
`LeaveRequests` header (ระบบสร้างให้อัตโนมัติเมื่อชีตว่าง; ถ้ามี header เดิมจะ **ไม่** เขียนทับ):

```
requestId | clientRequestId | employeeLineUserId | employeeId | employeeName |
position | department | leaveType | startDate | endDate | totalDays | reason |
managerLineUserId | status |
approvedByLineUserId | approvedBy | approvedAt |
rejectedByLineUserId | rejectedBy | rejectedAt | rejectedReason |
approvalSource | createdAt | updatedAt |
managerNotificationStatus | managerNotificationAttempts | managerNotificationLastAttemptAt | managerNotificationError |
employeeNotificationStatus | employeeNotificationAttempts | employeeNotificationLastAttemptAt | employeeNotificationError
```

`approvedBy` / `rejectedBy` เก็บ **display name** ของผู้ดำเนินการ (server ดึงจาก LINE
Profile API — ไม่เชื่อค่าจาก client/postback), ส่วน `approvedByLineUserId` /
`rejectedByLineUserId` เก็บ **LINE user id** (`event.source.userId`). `approvalSource`
เก็บที่มาของการตัดสิน เช่น `LINE_MANAGER_BOT` หรือ `HR_ADMIN`.

`Holidays` (optional): header `date` (YYYY-MM-DD).
`Employees` / `AuditLog`: as documented above.

### Migration for existing sheets
Writes are **header-driven** (matched by column name, not position), so you can
add new columns to an existing `LeaveRequests` header without breaking older rows.
Columns that are absent simply are not written — run `npm run validate:sheets` to
see exactly which columns are missing, then add them manually (the app never
overwrites a non-empty header automatically).

**Columns added in this revision** — append these to the `LeaveRequests` header
row (any position; matching is by name) so approver identity is captured:

```
approvedByLineUserId | rejectedByLineUserId | approvalSource
```

Existing rows keep working with these cells left blank; only decisions taken
after the migration populate them.

## Employee notification format
หลังผู้บริหารกดอนุมัติ/ไม่อนุมัติ Employee Bot จะส่ง **Flex Message** (โทนเขียว =
อนุมัติ, โทนแดง = ไม่อนุมัติ) พร้อม `altText` ที่อ่านเข้าใจได้ และมี **text fallback**
รายละเอียดครบเมื่อ Flex ส่งไม่สำเร็จ. ตัวอย่าง (ข้อมูลสมมติ):

อนุมัติ:

```
✅ คำขอลาได้รับการอนุมัติแล้ว

เลขคำขอ: REQ-20260803-A1B2C3D4
ชื่อพนักงาน: นายสมชาย ใจดี
รหัสพนักงาน: EMP001
ตำแหน่ง: เจ้าหน้าที่บัญชี
แผนก: Accounting

ประเภทการลา: ลาป่วย
วันที่เริ่มลา: 10 สิงหาคม 2569
วันที่สิ้นสุด: 11 สิงหาคม 2569
จำนวนวันลา: 2 วัน

เหตุผล:
มีอาการไข้และต้องเข้าพบแพทย์

อนุมัติโดย: คุณวิชัย
วันที่อนุมัติ: 3 สิงหาคม 2569 เวลา 10:30 น.

สถานะ: อนุมัติเรียบร้อย
```

ไม่อนุมัติ:

```
❌ คำขอลาไม่ได้รับการอนุมัติ

เลขคำขอ: REQ-20260803-A1B2C3D4
ชื่อพนักงาน: นายสมชาย ใจดี
รหัสพนักงาน: EMP001
แผนก: Accounting

ประเภทการลา: ลาป่วย
วันที่: 10–11 สิงหาคม 2569
จำนวนวันลา: 2 วัน

เหตุผลที่ไม่อนุมัติ:
มีงานสำคัญในช่วงดังกล่าว

ดำเนินการโดย: คุณวิชัย
วันที่ดำเนินการ: 3 สิงหาคม 2569 เวลา 10:30 น.

สถานะ: ไม่อนุมัติ
```

## Apps Script deployment
1. Open the Google Sheet → Extensions → Apps Script.
2. Paste the contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
3. If the script is **not** bound to the sheet, set a Script Property
   `SPREADSHEET_ID` to your spreadsheet id.
4. Deploy → New deployment → Web app → Execute as **Me**, Access **Anyone with the URL**.
5. Copy the deployment URL into `GOOGLE_APPS_SCRIPT_URL`.
6. Replace the `getBalance` body with your real balance lookup (it must return
   the standard contract `{success, code, message?, data?}`).

The app tolerates the legacy `{status, data}` response during migration, but the
atomic `transitionLeaveStatus` action requires the new `Code.gs`.

## Health & Readiness
- `GET /api/health` — liveness only, never calls external services.
- `GET /api/ready` — checks env, Google Sheets connectivity + schema, Apps Script
  URL, and LINE config; returns `503` when not ready. Never returns secrets.

```bash
curl -fsS https://YOUR_DOMAIN/api/health
curl -fsS https://YOUR_DOMAIN/api/ready
```

## Notification retry (internal, admin only)
```bash
curl -X POST https://YOUR_DOMAIN/api/internal/leave/REQ-XXXX/retry-manager-notification \
  -H "Authorization: Bearer $INTERNAL_API_SECRET"

curl -X POST https://YOUR_DOMAIN/api/internal/leave/REQ-XXXX/retry-employee-notification \
  -H "Authorization: Bearer $INTERNAL_API_SECRET"
```
Retries never create a new request or change approval status, are attempt-capped,
and are audit-logged.

## Verification scripts
```bash
npm run validate:env            # dev mode (missing secrets = warnings)
npm run validate:env -- --prod  # strict (missing secrets = errors)
npm run validate:sheets         # schema check (skips without credentials)
npm run security:check          # secret scan + npm audit summary
npm run verify:production        # validate:env → lint → typecheck → test → build → security:check
```

## Staging Setup
1. Create SEPARATE LINE channels (employee + manager), LIFF apps, a separate
   Google Sheet and Apps Script deployment for staging.
2. Copy `.env.staging.example` → your host's staging env and fill values.
3. Set the Manager webhook to `https://staging.YOUR_DOMAIN/api/line/manager/webhook`.
4. `npm run validate:env -- --prod` then deploy.

## Production Setup
1. Copy `.env.production.example` → production env (HTTPS domain, real secrets).
2. Ensure `INTERNAL_API_SECRET` is set and `APP_BASE_URL`/`GOOGLE_APPS_SCRIPT_URL`
   are HTTPS (validated by `validate:env --prod` and `/api/ready`).
3. Deploy `Code.gs`, then set `GOOGLE_APPS_SCRIPT_URL`.
4. `npm run verify:production` → deploy → verify `/api/ready` returns `ready`.

## Promotion Checklist
See [docs/production-e2e-checklist.md](docs/production-e2e-checklist.md).

## Backup (before every deploy)
- **Spreadsheet**: File → Make a copy (name it `HR-backup-YYYYMMDD`), or
  File → Download → `.xlsx`/`.csv` per tab. Keep the copy in a restricted folder.
- **Apps Script**: Deploy → Manage deployments → note the current version; or
  copy `Code.gs` into version control (already in `google-apps-script/Code.gs`).
- **Environment variables**: export from your hosting provider's secret manager
  into a secure vault. **Never** commit secrets to git.

## Rollback Procedure
1. Put the app in maintenance / stop accepting new requests (scale down or
   toggle the LIFF entry points).
2. Roll the server back to the previous known-good revision.
3. Verify `GET /api/ready` returns `ready`.
4. Verify the Google Sheets schema (`npm run validate:sheets`).
5. Inspect requests stuck in `PENDING` and reconcile with the `AuditLog`.
6. Retry any failed notifications via the internal retry endpoints.
7. Re-enable request intake.

## Troubleshooting
| อาการ | สาเหตุที่พบบ่อย |
| --- | --- |
| `/api/ready` = 503, `sheetSchema: fail` | header ในชีตไม่ตรง — รัน `validate:sheets` |
| ยื่นลาแล้วได้ 401 | LIFF token ไม่ถูกต้อง / เปิดนอกแอป LINE / `EMPLOYEE_LINE_LOGIN_CHANNEL_ID` ผิด |
| ยื่นลาได้ 403 (ไม่พบพนักงาน) | ยังไม่ผูก `lineUserId` ในชีต `Employees` |
| หัวหน้ากดปุ่มแล้วเงียบ | webhook signature ผิด / ไม่ได้อยู่ในกลุ่ม `MANAGER_GROUP_ID` |
| อนุมัติสำเร็จแต่พนักงานไม่ได้ข้อความ | พนักงานยังไม่ได้ add Employee bot — ใช้ retry endpoint |
| balance check ล้มเหลว | Apps Script `getBalance` ไม่คืน contract — ดู `Code.gs` |

## Security Checklist
- [ ] ไม่มี token/secret/Apps Script URL ใน client bundle (`npm run security:check`)
- [ ] `.env*` (จริง) ไม่ถูก commit
- [ ] Webhook ตรวจ `x-line-signature` ทุกครั้ง
- [ ] ตรวจสิทธิ์หัวหน้าต่อคำขอ + HR admin override
- [ ] Logs ไม่มี secret (redaction ใน `lib/logger.ts`)
- [ ] `INTERNAL_API_SECRET` ตั้งค่าใน production (timing-safe compare)
- [ ] Public API มี rate limit + payload/content-type guard

## Known Limitations
- **Rate limiter** เป็น in-memory ต่อ instance (best-effort). Multi-instance /
  serverless ต้องใช้ shared store (เช่น Redis) เพื่อ limit แบบ global — ยังไม่เพิ่มใน
  รอบนี้เพื่อไม่ให้เกิด datastore ใหม่.
- **Atomicity** อาศัย Apps Script `LockService`; ถ้าไม่ deploy `Code.gs` จะ fallback
  ไป repository guard (read-check-write) ซึ่งไม่ atomic ข้าม process.
- **npm audit**: มี 4 high (transitive ผ่าน `next`/`sharp`/`postcss`/`brace-expansion`)
  แก้ได้ด้วย `npm audit fix --force` (bump `next` เป็น 16.2.11 — patch). ยังไม่ bump
  อัตโนมัติเพื่อไม่ให้เปลี่ยน pinned version โดยไม่ได้ตั้งใจ.
- ต้องทดสอบ E2E กับ LINE/Google จริง (ดู checklist) — unit test ครอบคลุม logic แต่ไม่
  แทนการทดสอบ integration กับบริการจริง.

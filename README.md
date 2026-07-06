# 🚀 HR LINE Bot & LIFF Application

ระบบจัดการลางานผ่าน LINE โดยใช้ LIFF ร่วมกับ Next.js และ Google Sheets เพื่อบันทึกข้อมูลแบบ Real-time

---

## 🛠 Tech Stack
- **Framework:** Next.js (App Router)
- **Frontend:** Tailwind CSS
- **Database:** Google Sheets API (v4)
- **Integration:** LINE LIFF, LINE Messaging API

---

## 📌 Features
- ✅ หน้าฟอร์มลางานรองรับมือถือ (LIFF Full)
- ✅ บันทึกข้อมูลลง Google Sheets อัตโนมัติ
- ✅ ส่งข้อความแจ้งเตือนเข้า LINE Group ทันทีเมื่อมีการลา
- ✅ ระบบตรวจสอบสถานะเบื้องต้น

---

## ⚙️ Setup Instructions
1. **Clone the repo:**
   ```bash
   git clone [your-repo-link]
Install dependencies:

   ```Bash
npm install
Environment Variables (.env.local):
สร้างไฟล์ .env.local แล้วใส่ค่าดังนี้:

   ```ข้อมูลโค้ด
   NEXT_PUBLIC_LIFF_ID=...
   GOOGLE_SHEET_ID=...
   GOOGLE_CLIENT_EMAIL=...  
   GOOGLE_PRIVATE_KEY=...
   LINE_CHANNEL_ACCESS_TOKEN=...
   MANAGER_USER_ID=...
   Run development:

```Bash
npm run dev

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // 📌 ลิงก์ Apps Script ของคุณ
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbykGb5NVbqf6oHGBkH_h0arZ9VFaCGvWUDKclK0lx7zSPs4yWgDyqXB6mnJnBVTyDdL4A/exec";
    
    const queryParams = new URLSearchParams(body).toString();
    const targetUrl = `${SCRIPT_URL}?${queryParams}`;

    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store' // ✅ สำคัญมาก! บังคับไม่ให้ Next.js จำค่าเก่า
    });

    const text = await res.text();
    
    try {
      return NextResponse.json(JSON.parse(text));
    } catch (parseError) {
      console.error("Invalid Response:", text);
      return NextResponse.json({ status: 'error', message: 'Invalid Google Response' }, { status: 500 });
    }

  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
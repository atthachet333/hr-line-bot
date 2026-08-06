import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const events = body.events || [];

    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const userText = event.message.text.trim(); // .trim() ช่วยตัดช่องว่างทิ้ง
        
        // 🚨 สั่งให้ CMD ปริ้นท์ค่าออกมาดูเลยว่ามันอ่านว่าอะไร
        console.log("DEBUG: บอทได้รับข้อความว่า ->", userText);
        console.log("DEBUG: เปรียบเทียบกับ 'ขออนุมัติ' ผลคือ ->", userText === "ขออนุมัติ");

        let messages;
        if (userText === "ขออนุมัติ") {
          messages = [{ type: "text", text: "✅ ตรวจพบคำสั่งอนุมัติแล้ว!" }];
        } else {
          messages = [{ type: "text", text: `บอทได้รับคำว่า: ${userText}` }];
        }

        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_SUPERVISOR_TOKEN}`,
          },
          body: JSON.stringify({ replyToken: event.replyToken, messages }),
        });
      }
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { maskId } from '@/lib/utils/mask';

export async function POST(req: Request) {
  const correlationId = correlationIdFrom(req);
  try {
    const body = await req.json();

    // ป้องกัน Error จากการกด Verify ของ LINE
    const events = body.events || [];

    // Structured summary only — never log the raw webhook body (it contains
    // replyToken / quoteToken / markAsReadToken / full userId+groupId).
    for (const event of events) {
      logger.info('supervisor_webhook_event', {
        correlationId,
        route: 'POST /api/webhook-supervisor',
        eventType: event?.type,
        sourceType: event?.source?.type,
        webhookEventId: event?.webhookEventId,
        userId: maskId(event?.source?.userId),
        groupId: maskId(event?.source?.groupId),
      });
    }

    for (const event of events) {
      // 🟢 ดักจับเมื่อมีคนพิมพ์ข้อความ
      if (event.type === "message" && event.message.type === "text") {
        const userText = event.message.text;
        const replyToken = event.replyToken;

        // ถ้าพิมพ์คำว่า "ขออนุมัติ"
        if (userText === "ขออนุมัติ") {
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // ⚠️ เช็คให้ชัวร์ว่าในไฟล์ .env ต้องมีตัวแปร LINE_SUPERVISOR_TOKEN นี้อยู่
              Authorization: `Bearer ${process.env.LINE_SUPERVISOR_TOKEN}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [
                {
                  type: "flex",
                  altText: "🔔 มีแจ้งเตือนการลาใหม่ รอการอนุมัติ",
                  contents: {
                    type: "bubble",
                    body: {
                      type: "box",
                      layout: "vertical",
                      paddingAll: "20px",
                      contents: [
                        {
                          type: "box",
                          layout: "horizontal",
                          alignItems: "center",
                          spacing: "md",
                          contents: [
                            {
                              type: "image",
                              url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?ixlib=rb-1.2.1&auto=format&fit=crop&w=150&q=80",
                              flex: 0,
                              size: "50px",
                              aspectRatio: "1:1",
                              aspectMode: "cover",
                              cornerRadius: "100px"
                            },
                            {
                              type: "text",
                              text: "แจ้งเตือนการลา",
                              weight: "bold",
                              size: "lg",
                              color: "#1DB446"
                            }
                          ]
                        },
                        { type: "separator", margin: "lg" },
                        {
                          type: "box",
                          layout: "vertical",
                          margin: "lg",
                          spacing: "sm",
                          contents: [
                            { type: "text", text: "👤 ผู้ลา: น้องถ้วยฟู", size: "sm", color: "#333333", weight: "bold" },
                            { type: "text", text: "🏷️ ประเภท: ลาป่วย", size: "sm", color: "#555555" },
                            { type: "text", text: "📅 ช่วงเวลา: 10 ก.ค. 2026 - 11 ก.ค. 2026", size: "sm", color: "#555555" },
                            { type: "text", text: "📝 เหตุผล: ปวดศีรษะและมีไข้สูง", size: "sm", color: "#555555", wrap: true },
                            { type: "text", text: "สถานะ: ⏳ รออนุมัติ", size: "sm", color: "#F2B33D", weight: "bold", margin: "md" }
                          ]
                        }
                      ]
                    },
                    footer: {
                      type: "box",
                      layout: "horizontal",
                      spacing: "md",
                      contents: [
                        {
                          type: "button",
                          style: "primary",
                          color: "#1DB446",
                          action: { type: "postback", label: "อนุมัติ", data: "action=approve&id=REQ-1002" }
                        },
                        {
                          type: "button",
                          style: "primary",
                          color: "#D32F2F",
                          action: { type: "postback", label: "ไม่อนุมัติ", data: "action=reject&id=REQ-1002" }
                        }
                      ]
                    }
                  }
                }
              ]
            })
          });
        } 
        // ถ้าพิมพ์คำอื่น ให้บอทตอบกลับปกติ (Echo) จะได้รู้ว่าบอทไม่ตาย
        else {
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_SUPERVISOR_TOKEN}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [{ type: "text", text: `รับทราบข้อความ: ${userText}` }],
            }),
          });
        }
      }
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Supervisor Webhook is running!" }, { status: 200 });
}
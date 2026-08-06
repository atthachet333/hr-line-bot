import 'dotenv/config';
import cron from 'node-cron';

console.log('🤖 Cron Job Service for LINE Group is running...');

// ⏰ ตั้งเวลาทำงานทุกวัน ตอนตี 5 ตรง (0 5 * * *)
cron.schedule('0 5 * * *', async () => {
  console.log('⏰ Executing Daily Report for LINE Group...');
  
  try {
    const token = 'eELiacQQ40sb89r1MhS038Md5ipC98LBV0FWzkPS+68sB9T5me1qoHiNrTx6k0V0vz6FA76suS2gwSSApLG0nOlBkddNDeVBAiz711MuXFI5G0WhUy+5QTwTtVKmZXIMjW78jyHTE8EpwmkgTlJUCAdB04t89/1O/w1cDnyilFU=';
    
    // โครงสร้าง Flex Message สำหรับส่งเข้ากลุ่ม
    const flexMessage = [
      {
        type: "flex",
        altText: "มีการแจ้งเตือนให้ทำรายการจากระบบเหมี๊ยว 🐱",
        contents: {
          type: "bubble",
          size: "mega",
          header: {
            type: "box",
            layout: "vertical",
            paddingAll: "20px",
            paddingBottom: "0px",
            contents: [
              {
                type: "text",
                text: "BOT-HR S2A",
                weight: "bold",
                color: "#c414d4",
                size: "sm"
              },
              {
                type: "text",
                text: "ระบบแจ้งเตือนอัตโนมัติ",
                weight: "bold",
                size: "xl",
                margin: "md"
              }
            ]
          },
          body: {
            type: "box",
            layout: "vertical",
            paddingAll: "20px",
            contents: [
              {
                type: "text",
                text: "กรุณากดปุ่มด้านล่างเพื่อเข้าสู่หน้าจอทำรายการเหมี๊ยว 👇",
                wrap: true,
                color: "#666666",
                size: "sm"
              },
              {
                type: "separator",
                margin: "lg"
              },
              {
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "sm",
                contents: [
                  {
                    type: "button",
                    style: "primary",
                    color: "#2fec2f",
                    height: "sm",
                    action: {
                      type: "uri",
                      label: "🥰 แจ้งเข้างาน",
                      uri: "https://liff.line.me/2010618791-ybX6PWJy"
                    }
                  },
                  {
                    type: "button",
                    style: "primary",
                    color: "#ca0404",
                    height: "sm",
                    action: {
                      type: "uri",
                      label: "😠 แจ้งออกงาน",
                      uri: "https://liff.line.me/2010618791-9Cdcy05Z"
                    }
                  },
                  {
                    type: "button",
                    style: "primary",
                    color: "#2f85f5",
                    height: "sm",
                    action: {
                      type: "uri",
                      label: "🔴 แจ้งลา",
                      uri: "https://liff.line.me/2010618791-KY777Hrw"
                    }
                  },
                  {
                    type: "button",
                    style: "secondary",
                    color: "#f3fccd",
                    height: "sm",
                    action: {
                      type: "uri",
                      label: "✨ เช็คสิทธิ์",
                      uri: "https://liff.line.me/2010618791-6K8d8hmx"
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ];

    // คำสั่งยิงเข้า "กลุ่มไลน์" เท่านั้น (Push)
    const pushResponse = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: "C98a97bd91b757551364dc1a62acf4d1e", // รหัสกลุ่มไลน์ของคุณ
        messages: flexMessage
      })
    });
    
    const pushResult = await pushResponse.json();
    console.log('สถานะการส่งเข้ากลุ่ม:', pushResult);

  } catch (error) {
    console.error('Cron Error:', error);
  }
}, {
  timezone: 'Asia/Bangkok'
});
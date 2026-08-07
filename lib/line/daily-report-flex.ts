import { messageLiffUrl } from '@/lib/liff/config';
import type { LineFlexMessage } from './types';

/**
 * Daily group Flex with the four action buttons. Every button URL is a canonical
 * LIFF deep link resolved from env (checkin/checkout/leave/balance) via the one
 * shared `messageLiffUrl` helper — never a hardcoded id or a /checkin path.
 */
export function buildDailyReportFlex(env: NodeJS.ProcessEnv = process.env): LineFlexMessage[] {
  const button = (label: string, color: string, style: string, page: 'checkin' | 'checkout' | 'leave' | 'balance') => ({
    type: 'button',
    style,
    color,
    height: 'sm',
    action: { type: 'uri', label, uri: messageLiffUrl(page, env) },
  });

  return [
    {
      type: 'flex',
      altText: 'มีการแจ้งเตือนให้ทำรายการจากระบบเหมี๊ยว 🐱',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '20px',
          paddingBottom: '0px',
          contents: [
            { type: 'text', text: 'BOT-HR S2A', weight: 'bold', color: '#c414d4', size: 'sm' },
            { type: 'text', text: 'ระบบแจ้งเตือนอัตโนมัติ', weight: 'bold', size: 'xl', margin: 'md' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '20px',
          contents: [
            { type: 'text', text: 'กรุณากดปุ่มด้านล่างเพื่อเข้าสู่หน้าจอทำรายการเหมี๊ยว 👇', wrap: true, color: '#666666', size: 'sm' },
            { type: 'separator', margin: 'lg' },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              spacing: 'sm',
              contents: [
                button('🥰 แจ้งเข้างาน', '#2fec2f', 'primary', 'checkin'),
                button('😠 แจ้งออกงาน', '#ca0404', 'primary', 'checkout'),
                button('🔴 แจ้งลา', '#2f85f5', 'primary', 'leave'),
                button('✨ เช็กสิทธิ์', '#f3fccd', 'secondary', 'balance'),
              ],
            },
          ],
        },
      },
    },
  ];
}

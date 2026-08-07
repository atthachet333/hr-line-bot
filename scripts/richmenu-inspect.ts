/**
 * Inspect the LINE Rich Menu(s) of the Employee bot (น้องถ้วยฟู) — READ-ONLY.
 *
 * Usage: npm run richmenu:inspect
 *
 * Loads .env / .env.local via @next/env FIRST (so NEXT_PUBLIC_* are available),
 * prints each rich menu's areas/actions/URLs, flags non-canonical URLs, and
 * marks the default. Uses EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN. Never prints the
 * token — only a boolean diagnostic.
 */
import { loadEnvConfig } from '@next/env';
import {
  richMenuLiffByPage,
  richMenuDiagnostics,
  expectedRichMenuUris,
  liffDeepLink,
} from '@/lib/richmenu/env';

// Load env BEFORE reading process.env (fixes "missing" LIFF ids when run via tsx).
loadEnvConfig(process.cwd());

const API = 'https://api.line.me/v2/bot';

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: { type: string; uri?: string; label?: string; data?: string; text?: string };
}
interface RichMenu {
  richMenuId: string;
  name: string;
  chatBarText: string;
  size?: { width: number; height: number };
  areas: RichMenuArea[];
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`LINE API ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function main() {
  const diag = richMenuDiagnostics(process.env);
  const liff = richMenuLiffByPage(process.env);

  console.log('\nRich Menu inspection (read-only)');
  console.log('='.repeat(60));
  console.log('Diagnostics:', JSON.stringify(diag)); // tokenConfigured + counts only, no token
  console.log('Canonical LIFF URLs expected in the menu:');
  for (const [page, id] of Object.entries(liff)) {
    console.log(`  ${page.padEnd(9)} -> ${id ? liffDeepLink(id) : '(missing NEXT_PUBLIC_LIFF_ID_* )'}`);
  }

  const token = process.env.EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN || '';
  if (!token) {
    console.error('\n❌ EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN is not set — cannot query LINE.');
    process.exit(1);
  }

  let defaultId = '';
  try {
    defaultId = (await api<{ richMenuId: string }>(token, '/user/all/richmenu')).richMenuId;
  } catch {
    console.log('\n(no default rich menu set, or none accessible)');
  }

  const list = await api<{ richmenus: RichMenu[] }>(token, '/richmenu/list');
  const expected = expectedRichMenuUris(process.env);

  if (!list.richmenus?.length) {
    console.log('\nNo rich menus found on this channel.');
    return;
  }
  for (const rm of list.richmenus) {
    console.log(`\n▸ ${rm.richMenuId}${rm.richMenuId === defaultId ? '  ⭐ DEFAULT' : ''}`);
    console.log(`  name="${rm.name}"  chatBar="${rm.chatBarText}"  size=${rm.size?.width}x${rm.size?.height}`);
    rm.areas.forEach((a, i) => {
      const act = a.action || {};
      const detail = act.uri ?? act.data ?? act.text ?? '';
      const flag = act.type === 'uri'
        ? (expected.has(String(act.uri).toLowerCase()) ? '  ✅ canonical' : '  ⚠️  NON-CANONICAL')
        : '';
      console.log(`    [${i}] type=${act.type} label="${act.label ?? ''}" -> ${detail}${flag}`);
    });
  }

  console.log('\nTip: fix any ⚠️ NON-CANONICAL uri with:  npm run richmenu:update -- --confirm');
}

main().catch((e) => {
  console.error('❌ inspect error:', e instanceof Error ? e.message : e);
  process.exit(1);
});

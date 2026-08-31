'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { initializeLiffSession, LiffAuthError } from '@/lib/liff/session';
import { authenticatedFetch } from '@/lib/liff/authenticated-fetch';
import { liffErrorMessage } from '@/lib/liff/error-messages';
import { parseEvidenceRequestId } from '@/lib/liff/evidence-link';
import type { PublicEvidenceItem } from '@/lib/evidence/types';

type Phase = 'loading' | 'ready' | 'error';
export type ViewerItem = PublicEvidenceItem & { objectUrl?: string };

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function EvidenceCards({ items }: { items: ViewerItem[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <article key={item.evidenceId} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="h-48 bg-slate-950 flex items-center justify-center">
            {item.mimeType.startsWith('image/') && item.objectUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.objectUrl} alt={item.originalName} className="w-full h-full object-contain" />
            ) : (
              <div className="text-center"><div className="text-5xl mb-2">{item.mimeType === 'application/pdf' ? '📄' : '📎'}</div><span className="text-xs text-slate-400">{item.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}</span></div>
            )}
          </div>
          <div className="p-4">
            <p className="font-semibold text-sm truncate" title={item.originalName}>{item.originalName}</p>
            <p className="text-xs text-slate-400 mt-1">{item.mimeType} · {formatBytes(item.size)}</p>
            {item.objectUrl ? (
              <a href={item.objectUrl} target="_blank" rel="noreferrer" className="mt-3 block text-center bg-indigo-500 hover:bg-indigo-400 rounded-lg py-2 text-sm font-semibold">เปิดดู</a>
            ) : (
              <p className="mt-3 text-center bg-slate-700 rounded-lg py-2 text-xs text-slate-300">ไม่พบไฟล์บนดิสก์</p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/** Manager/HR viewer. Authorization is enforced on both list and file APIs. */
export function EvidenceViewer({ requestId: propRequestId }: { requestId?: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<ViewerItem[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const objectUrls = useRef<string[]>([]);

  const revokeUrls = useCallback(() => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
  }, []);

  const load = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    revokeUrls();
    const session = await initializeLiffSession('evidence');
    if (session.status === 'redirecting') return;
    if (session.status === 'error') {
      setPhase('error');
      setErrorMsg(liffErrorMessage(session.code));
      return;
    }
    const requestId = propRequestId || parseEvidenceRequestId(typeof window !== 'undefined' ? window.location.search : '');
    if (!requestId) {
      setPhase('error');
      setErrorMsg('ไม่พบรหัสคำขอสำหรับดูหลักฐาน');
      return;
    }
    try {
      const base = `/api/leave/${encodeURIComponent(requestId)}/evidence`;
      const listResponse = await authenticatedFetch('evidence', base);
      if (listResponse.status === 401) throw new LiffAuthError('AUTHENTICATION_ERROR');
      if (listResponse.status === 403) {
        setPhase('error'); setErrorMsg('คุณไม่มีสิทธิ์ดูหลักฐานของคำขอนี้'); return;
      }
      if (listResponse.status === 404) {
        setPhase('error'); setErrorMsg('ไม่พบหลักฐานสำหรับคำขอนี้'); return;
      }
      if (!listResponse.ok) throw new Error('list failed');
      const envelope = await listResponse.json() as { data?: { items?: PublicEvidenceItem[] } };
      const metadata = envelope.data?.items ?? [];
      const loaded = await Promise.all(metadata.map(async (item): Promise<ViewerItem> => {
        const response = await authenticatedFetch(
          'evidence',
          `${base}/${encodeURIComponent(item.evidenceId)}`,
        );
        if (!response.ok) return item;
        const url = URL.createObjectURL(await response.blob());
        objectUrls.current.push(url);
        return { ...item, objectUrl: url };
      }));
      setItems(loaded);
      setPhase('ready');
    } catch (error) {
      setPhase('error');
      setErrorMsg(error instanceof LiffAuthError ? liffErrorMessage(error.code) : 'ไม่สามารถโหลดหลักฐานได้ กรุณาลองใหม่');
    }
  }, [propRequestId, revokeUrls]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); revokeUrls(); };
  }, [load, revokeUrls]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="px-4 py-3 bg-slate-800 text-center text-sm font-semibold">📎 หลักฐานประกอบการลา</div>
      <main className="max-w-3xl mx-auto p-4">
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-slate-300 py-24">
            <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-200 rounded-full animate-spin" />
            <span className="text-sm">กำลังตรวจสอบสิทธิ์และโหลดหลักฐาน...</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="text-center py-24">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-slate-300 mb-5 px-6">{errorMsg}</p>
            <button onClick={() => void load()} className="px-5 py-2 bg-slate-100 text-slate-900 rounded-lg text-sm font-semibold">ลองใหม่</button>
          </div>
        )}
        {phase === 'ready' && (
          <>
            <p className="text-sm text-slate-300 mb-4">พบหลักฐาน {items.length} ไฟล์</p>
            <EvidenceCards items={items} />
          </>
        )}
      </main>
    </div>
  );
}

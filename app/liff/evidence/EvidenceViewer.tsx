'use client';

import { useEffect, useState, useCallback } from 'react';
import { initializeLiffSession, LiffAuthError } from '@/lib/liff/session';
import { authenticatedFetch } from '@/lib/liff/authenticated-fetch';
import { liffErrorMessage } from '@/lib/liff/error-messages';
import { parseEvidenceRequestId } from '@/lib/liff/evidence-link';

type Phase = 'loading' | 'image' | 'pdf' | 'error';

/**
 * Manager/HR evidence viewer. `requestId` may come from the dynamic route param
 * (/liff/evidence/[requestId]) OR — for the base endpoint /liff/evidence — be
 * resolved from the query / liff.state AFTER liff.init(). Auth (manager/HR) is
 * enforced server-side by the evidence API.
 */
export function EvidenceViewer({ requestId: propRequestId }: { requestId?: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [objectUrl, setObjectUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    const session = await initializeLiffSession('evidence');
    if (session.status === 'redirecting') return;
    if (session.status === 'error') {
      setPhase('error');
      setErrorMsg(liffErrorMessage(session.code));
      return;
    }

    // Resolve requestId: dynamic-route prop first, else the URL (query /
    // liff.state) which is only reliable after liff.init() has run.
    const requestId =
      propRequestId && propRequestId.length > 0
        ? propRequestId
        : parseEvidenceRequestId(typeof window !== 'undefined' ? window.location.search : '');
    if (!requestId) {
      setPhase('error');
      setErrorMsg('ไม่พบรหัสคำขอสำหรับดูหลักฐาน');
      return;
    }

    try {
      const res = await authenticatedFetch('evidence', `/api/leave/${encodeURIComponent(requestId)}/evidence`);
      if (res.status === 401) {
        setPhase('error');
        setErrorMsg(liffErrorMessage('AUTHENTICATION_ERROR'));
        return;
      }
      if (res.status === 403) {
        setPhase('error');
        setErrorMsg('คุณไม่มีสิทธิ์ดูหลักฐานของคำขอนี้');
        return;
      }
      if (res.status === 404) {
        setPhase('error');
        setErrorMsg('ไม่พบหลักฐานสำหรับคำขอนี้');
        return;
      }
      if (!res.ok) {
        setPhase('error');
        setErrorMsg('ไม่สามารถโหลดหลักฐานได้ กรุณาลองใหม่');
        return;
      }
      const type = res.headers.get('content-type') || '';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      setPhase(type.includes('pdf') ? 'pdf' : 'image');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof LiffAuthError ? liffErrorMessage(err.code) : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
    }
  }, [propRequestId]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // objectUrl intentionally not a dep: cleanup uses the latest closure value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <div className="px-4 py-3 bg-slate-800 text-center text-sm font-semibold">📎 หลักฐานประกอบการลา</div>
      <div className="flex-1 flex items-center justify-center p-3">
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-slate-300">
            <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-200 rounded-full animate-spin"></div>
            <span className="text-sm">กำลังตรวจสอบสิทธิ์และโหลดหลักฐาน...</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-slate-300 mb-5 px-6">{errorMsg}</p>
            <button onClick={() => void load()} className="px-5 py-2 bg-slate-100 text-slate-900 rounded-lg text-sm font-semibold">
              ลองใหม่
            </button>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {phase === 'image' && objectUrl && <img src={objectUrl} alt="หลักฐานการลา" className="max-w-full max-h-[85vh] object-contain rounded" />}
        {phase === 'pdf' && objectUrl && (
          <iframe title="หลักฐานการลา (PDF)" src={objectUrl} className="w-full h-[85vh] bg-white rounded" />
        )}
      </div>
    </div>
  );
}

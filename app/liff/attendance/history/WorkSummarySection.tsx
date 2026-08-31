interface WorkSummarySectionProps {
  date: string;
  summaries: string[];
}

/** React text children are escaped automatically; never interpret Sheet text as HTML. */
export function WorkSummarySection({ date, summaries }: WorkSummarySectionProps) {
  return (
    <section className="mt-4 border-t border-slate-100 pt-4">
      <h4 className="text-xs font-semibold text-slate-500">สรุปงาน</h4>
      {summaries.length > 0 ? (
        <div className="mt-1.5 space-y-2">
          {summaries.map((workSummary, index) => (
            <p key={`${date}-summary-${index}`} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
              {workSummary}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-slate-400">ไม่มีข้อมูลสรุปงาน</p>
      )}
    </section>
  );
}

import { Check } from "lucide-react";

const searchStages = ["Find candidates", "Validate company identity", "Remove duplicates and non-companies", "Rank for fit"];

export function CompanySearchProgress({ stage = 0, complete = false, running = true, title = "Finding businesses", label, status, detail, stages = searchStages }: {
  stage?: number;
  complete?: boolean;
  running?: boolean;
  title?: string;
  label?: string;
  status?: string;
  detail?: string;
  stages?: string[];
}) {
  // Percentages indicate pipeline stages, rather than a timed prediction.
  const percentage = complete ? 100 : [20, 40, 60, 80][stage];
  return <div className="rounded-[10px] border border-[#d8deeb] bg-white px-5 py-10 text-center text-[#20252f] sm:px-9">
    {running ? <div aria-hidden="true" className="mx-auto mb-[18px] size-[31px] animate-spin rounded-full border-[3px] border-[#e2e3fb] border-t-[#3732a0] motion-reduce:animate-none" /> : <div aria-hidden="true" className="mx-auto mb-[18px] flex size-[31px] items-center justify-center rounded-full bg-[#e5f4eb] text-[#2c7958]">{complete ? <Check size={18} /> : <span>!</span>}</div>}
    <p className="text-[10px] font-extrabold tracking-[.1em] text-[#7d8aa0]">{label || (running ? "SEARCHING" : complete ? "SEARCH COMPLETE" : "SEARCH STOPPED")}</p>
    <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-.04em]">{title}</h2>
    <p role="status" aria-live="polite" className="mt-[7px] text-[11px] text-[#637592]">{detail || "Checking company identity and removing duplicates."}</p>
    <div role="progressbar" aria-label="Research job progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={complete ? "Research complete" : `${status || stages[stage]} · Stage ${stage + 1} of ${stages.length}`} className="mt-[22px] h-2 overflow-hidden rounded-full bg-[#e9ebf4]">
      <div className="h-full bg-[#3732a0] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percentage}%` }} />
    </div>
    <div className="mt-[9px] flex justify-between gap-3 text-[10px] text-[#637592]"><span>{percentage}%</span><span>{complete ? "Complete" : status || `Stage ${stage + 1} of ${stages.length}`}</span></div>
    <ol className="mx-auto mt-[23px] grid max-w-[350px] gap-[10px] text-left">
      {stages.map((label, index) => {
        const done = complete || index < stage;
        const current = running && index === stage;
        return <li key={label} aria-current={current ? "step" : undefined} className={`flex items-center gap-[9px] text-[11px] ${done ? "text-[#2c7958]" : current ? "font-bold text-[#4541cf]" : "text-[#8593aa]"}`}>
          <span className={`flex size-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[#e5f4eb]" : current ? "bg-[#e6e5ff]" : "bg-[#eceff5]"}`}>{done ? <Check size={12} aria-hidden="true" /> : index + 1}<span className="sr-only">{done ? "Completed: " : ""}</span></span>{label}
        </li>;
      })}
    </ol>

  </div>;
}

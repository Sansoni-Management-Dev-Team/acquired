import type { MembershipView } from "./acquisition";
import { publicResearchUrl, researchDomain, terminalResearchStates, type ResearchConfig, type SavedResearchFinding } from "./research";

type CandidateJob = { id: string; status: string; seeds: string[]; config: ResearchConfig };

export function companyResearchFinished(target: { id: string; domain?: string }, jobs: CandidateJob[], findings: SavedResearchFinding[]) {
  const domain = target.domain?.replace(/^www\./, "").toLowerCase();
  const findingJobs = new Set(findings.filter(finding => finding.targetId === target.id).map(finding => finding.jobId));
  const related = jobs.filter(job =>
    job.config.targetId === target.id
    || job.config.newBusinessIds?.includes(target.id)
    || findingJobs.has(job.id)
    || Boolean(domain && (
      job.config.companyDomain?.replace(/^www\./, "").toLowerCase() === domain
      || [...job.seeds, ...job.config.seeds].some(url => {
        try { return researchDomain(url).toLowerCase() === domain; } catch { return false; }
      })
    )),
  );
  return related.some(job => job.status === "complete" || job.status === "partial")
    && related.every(job => terminalResearchStates.includes(job.status));
}

export type CandidateWebsite = {
  domain: string;
  url: string;
  name: string;
  status: string;
  targetId?: string;
  findings: SavedResearchFinding[];
};

export type CompanyRow =
  | { kind: "candidate"; candidate: CandidateWebsite }
  | { kind: "saved"; membership: MembershipView };

export function orderCompanyRows(candidates: CandidateWebsite[], memberships: MembershipView[], contacts: { targetId: string; name: string }[]): CompanyRow[] {
  const rows: CompanyRow[] = [
    ...candidates.map(candidate => ({ kind: "candidate" as const, candidate })),
    ...memberships.map(membership => ({ kind: "saved" as const, membership })),
  ];
  const dataCount = (row: CompanyRow) => {
    const findings = (row.kind === "candidate" ? row.candidate.findings : row.membership.researchFindings) || [];
    const hasFinding = (kind: "headcount" | "revenue" | "person") => findings.some(finding => finding.evidence.kind === kind);
    if (row.kind === "candidate") return Number(hasFinding("headcount")) + Number(hasFinding("revenue")) + Number(hasFinding("person"));
    const { target } = row.membership;
    return Number(target.headcount.value !== null || hasFinding("headcount"))
      + Number(target.revenue.value !== null || hasFinding("revenue"))
      + Number(hasFinding("person") || contacts.some(contact => contact.targetId === target.id && contact.name.trim()));
  };
  return rows.sort((a, b) => dataCount(b) - dataCount(a));
}

export function candidateStatus(status: string, saved: boolean) {
  if (saved) return "Business saved";
  if (status === "queued") return "Queued";
  if (status === "extracting") return "Extracting data";
  if (status === "discovering") return "Finding website";
  if (["crawling", "reading"].includes(status)) return "Reading website";
  if (status === "failed" || status === "partial") return "Needs retry";
  if (status === "cancelled") return "Stopped";
  return terminalResearchStates.includes(status) ? "Checked" : "Checking website";
}

export function candidateWebsites(jobs: CandidateJob[], findings: SavedResearchFinding[], memberships: MembershipView[]): CandidateWebsite[] {
  const savedDomains = new Set(memberships.map(member => member.target.domain?.replace(/^www\./, "").toLowerCase()).filter(Boolean));
  const savedIds = new Set(memberships.map(member => member.target.id));
  const byDomain = new Map<string, CandidateWebsite>();
  for (const job of jobs) {
    if (!job.config.discoveryCandidate) continue;
    const url = publicResearchUrl(job.seeds[0] || job.config.seeds?.[0] || `https://${job.config.companyDomain || ""}/`);
    if (!url) continue;
    const domain = researchDomain(url);
    if (savedDomains.has(domain) || job.config.newBusinessIds?.some(id => savedIds.has(id))) continue;
    const related = findings.filter(finding => {
      try { return researchDomain(finding.sourceUrl) === domain; } catch { return false; }
    });
    const name = related.find(finding => finding.evidence.kind === "company")?.evidence.name || job.config.companyName || domain;
    const next: CandidateWebsite = {
      domain, url, name,
      status: candidateStatus(job.status, Boolean(job.config.newBusinessIds?.length)),
      targetId: job.config.newBusinessIds?.[0],
      findings: related,
    };
    const previous = byDomain.get(domain);
    if (!previous || (previous.status !== "Business saved" && next.status === "Business saved")) byDomain.set(domain, next);
  }
  return [...byDomain.values()].filter(candidate =>
    !["Checked", "Needs retry", "Stopped"].includes(candidate.status)
    || Boolean(candidate.targetId)
    || candidate.findings.some(finding => finding.evidence.kind === "company")
  );
}

export function toggleMatchingTargets(selected: string[], matching: string[], checked: boolean) {
  return checked ? [...new Set([...selected, ...matching])] : selected.filter(id => !matching.includes(id));
}

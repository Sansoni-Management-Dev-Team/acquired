import type { MembershipView } from "./acquisition";
import { publicResearchUrl, researchDomain, terminalResearchStates, type ResearchConfig, type SavedResearchFinding } from "./research";

type CandidateJob = { id: string; status: string; seeds: string[]; config: ResearchConfig };

export type CandidateWebsite = {
  domain: string;
  url: string;
  name: string;
  status: string;
  targetId?: string;
  findings: SavedResearchFinding[];
};

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

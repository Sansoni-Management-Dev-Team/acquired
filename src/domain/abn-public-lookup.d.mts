export interface AbnCandidate {
  abn: string;
  name: string;
  nameType: string;
  location: string;
  active: boolean;
  sourceUrl: string;
}
export interface AbnMatch {
  status: 'exact_name_match' | 'ambiguous_exact_matches' | 'candidates_only' | 'no_results';
  match: AbnCandidate | null;
}
export function abnChecksum(value: string): boolean;
export function normaliseAbnName(value: string): string;
export function parseAbnSearch(html: string): AbnCandidate[];
export function classifyAbnMatches(query: string, candidates: AbnCandidate[]): AbnMatch;

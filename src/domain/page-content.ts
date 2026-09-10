// Page text reaches the model as a bounded excerpt. Select the sections most
// likely to hold company evidence before truncating, instead of cutting the
// page at a fixed character offset. Every returned line is verbatim page text,
// so quote validation against the original markdown still applies.
export type ContentPriority = "size" | "leadership" | "contact" | "financial" | "business";
const signals: Record<ContentPriority, RegExp> = {
  size: /\b(?:employees?|staff|team members?|workforce|headcount|company size|personnel|people employed)\b/i,
  leadership: /\b(?:owner|founders?|co-founder|directors?|managing director|general manager|ceo|chief|principal|partners?|president|proprietor|leadership|management team|our team|meet the team)\b/i,
  contact: /(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\(tel:|\b(?:phone|contact us|email us|head office|headquarters)\b)/i,
  financial: /\b(?:revenue|turnover|ebitda|profit|founded|established|abn|acn|since (?:18|19|20)\d{2})\b|\$\s?\d/i,
  business: /\b(?:manufactur\w*|wholesal\w*|distribut\w*|suppl\w*|certif\w*|accredit\w*|capabilit\w*|products?|services?)\b/i,
};
const formLine = /^(?:request received|drag & drop files here|browse files|or|close|search|sign up|log in|login|menu|skip to content|\d+ of \d+|state (?:nsw|vic|qld|sa|wa|tas|nt|act)(?:\s+\w+)*|your \w+ \(required\)|.*\(required\)\s*)$/i;
const linkOnly = /^\s*(?:[-*]\s*)?(?:\[[^\]\n]*\]\([^)\n]*\)\s*)+$/;
const stripImages = (markdown: string) => markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
// A link whose label is itself an address is a labelled value (Website, email), not navigation.
const navLink = (text: string) => Boolean(text) && linkOnly.test(text) && !/\[(?:https?:\/\/|www\.|[a-z0-9._%+-]+@)[^\]]*\]/i.test(text);

/** Remove navigation runs, form scaffolding and repeated boilerplate lines. */
export function stripBoilerplate(markdown: string, options: { dedupe?: boolean; keepImages?: boolean } = {}) {
  const lines = (options.keepImages ? markdown : stripImages(markdown)).split("\n");
  const kept: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.trim();
    if (!text) { if (kept.length && kept[kept.length - 1] !== "") kept.push(""); continue; }
    if (formLine.test(text.replace(/^#{1,6}\s+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim())) continue;
    if (navLink(text)) {
      // Three or more consecutive link-only lines are a navigation block.
      let run = 0;
      while (i + run < lines.length && navLink(lines[i + run].trim())) run++;
      if (run >= 3) { i += run - 1; continue; }
    }
    if (options.dedupe) {
      const key = text.replace(/\s+/g, " ").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

type Block = { text: string; index: number; score: number };
function blocks(text: string): Omit<Block, "score">[] {
  const out: Omit<Block, "score">[] = [];
  let current: string[] = [];
  const flush = () => { const joined = current.join("\n").trim(); if (joined) out.push({ text: joined, index: out.length }); current = []; };
  for (const line of text.split("\n")) {
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,6}\s/.test(line)) flush();
    current.push(line);
  }
  flush();
  return out;
}

/**
 * Choose page sections for a bounded model excerpt. The opening block is always
 * kept for identity, then sections are ranked by the requested evidence signals,
 * the research terms and any identity strings, and emitted in page order.
 */
export function relevantExcerpt(markdown: string, options: { maxChars: number; priorities?: ContentPriority[]; terms?: string[]; identity?: string[]; dedupe?: boolean }) {
  const priorities = options.priorities || ["size", "leadership", "contact", "financial", "business"];
  const tokens = (options.terms || []).join(" ").toLowerCase().match(/[a-z]{4,}/g) || [];
  const identity = (options.identity || []).map(s => s.trim().toLowerCase()).filter(s => s.length >= 3);
  const clean = stripBoilerplate(markdown, { dedupe: options.dedupe });
  if (clean.length <= options.maxChars) return clean;
  const ranked: Block[] = blocks(clean).map(block => {
    const lower = block.text.toLowerCase();
    let score = 0;
    for (const priority of priorities) if (signals[priority].test(block.text)) score += 4;
    score += tokens.filter(t => lower.includes(t)).length * 2;
    if (identity.some(id => lower.includes(id))) score += 3;
    if (linkOnly.test(block.text.replace(/\n/g, " "))) score -= 6;
    if (block.text.length < 24) score -= 2;
    return { ...block, score };
  });
  const chosen = new Set<number>();
  let used = 0;
  const take = (block: Block) => { if (chosen.has(block.index) || used + block.text.length + 2 > options.maxChars) return; chosen.add(block.index); used += block.text.length + 2; };
  if (ranked[0]) take({ ...ranked[0], text: ranked[0].text.slice(0, 1500) });
  for (const block of [...ranked].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (block.score <= 0) break;
    take(block);
  }
  for (const block of ranked) take(block);
  return ranked.filter(b => chosen.has(b.index)).map(b => b.index === 0 ? b.text.slice(0, 1500) : b.text).join("\n\n").slice(0, options.maxChars);
}

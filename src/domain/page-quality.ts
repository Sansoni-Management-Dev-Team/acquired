// A successful HTTP status is not proof that the requested content was retrieved.
export function unusablePage(markdown: string): string | null {
  const text = markdown.trim();
  if (text.length < 32) return "Empty or insufficient page content";
  const opening = text.slice(0, 1500);
  if (/title:\s*["']?(?:access (?:to this page )?(?:has been )?denied|just a moment|attention required|security verification)|px-captcha|cf-chl-|verify (?:that )?you are (?:a )?human|checking your browser|enable javascript and cookies to continue/i.test(opening)) return "Page blocked by access verification";
  return null;
}

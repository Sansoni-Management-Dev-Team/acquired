import { ResearchAiError } from './research-ai-error';
import { relevantExcerpt } from './page-content';

export function extractionFailureReason(error: unknown) {
  if (!(error instanceof ResearchAiError)) return 'extraction_error';
  if (/output token limit/i.test(error.message)) return 'output_token_limit';
  if (/schema|invalid JSON/i.test(error.message)) return 'invalid_output';
  if (/timed out|transport|incomplete response|unavailable \(HTTP (?:408|429|5\d\d)/i.test(error.message)) return 'provider_unavailable';
  return 'request_rejected';
}

// Retry extraction from the already-read source, never by fetching it again.
export function recoveryExtractionPrompt(messages: { role: string; content: string }[]) {
  return messages.map(message => {
    if (message.role === 'system') return { ...message, content: message.content + ' Recovery request: return at most two findings; use short literal quotes, each at most 320 characters. Omit unsupported claims.' };
    if (message.role !== 'user') return message;
    try {
      const payload = JSON.parse(message.content);
      if (typeof payload.webpage === 'string') payload.webpage = relevantExcerpt(payload.webpage, { maxChars: 3500, priorities: ['business', 'size', 'leadership', 'contact', 'financial'] });
      return { ...message, content: JSON.stringify(payload) };
    } catch { return message; }
  });
}

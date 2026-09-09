// Only sanitized adapter errors may be included in persisted research progress.
// Never wrap a raw provider response or source content in this type.
export class ResearchAiError extends Error {
  name = "ResearchAiError";
}

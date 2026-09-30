import { z } from "zod";

export function outreachEmail(value: unknown): string | null {
  const parsed = z.email().safeParse(typeof value === "string" ? value.trim() : value);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function hasOutreachDetails(contact: { email: unknown; fictionalised: boolean }): boolean {
  return !contact.fictionalised && outreachEmail(contact.email) !== null;
}

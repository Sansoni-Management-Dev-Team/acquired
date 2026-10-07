export type ContactFieldCompleteness = { saved: boolean; potentiallyAvailable: boolean; status: "reported" | "unavailable" | "not_reported" | "not_requested"; reason?: string };
export type ContactCompleteness = { email: ContactFieldCompleteness; phone: ContactFieldCompleteness };

/** Actual retained values are authoritative; directory flags are only potential availability. */
export function contactCompleteness(data: Record<string, unknown>): ContactCompleteness {
  const field = (key: "email" | "phone"): ContactFieldCompleteness => {
    const saved = typeof data[key] === "string" && Boolean((data[key] as string).trim());
    const potentiallyAvailable = saved || data[`${key}PotentiallyAvailable`] === true || data[`${key}Available`] === true;
    const stored = data[`${key}LookupStatus`];
    const status = saved ? "reported" : stored === "unavailable" || stored === "not_requested" ? stored : "not_reported";
    const reason = saved ? undefined : status === "unavailable" ? "Not supplied by the source" : status === "not_requested" ? "Manual lookup required" : potentiallyAvailable ? "Source advertises availability; lookup not confirmed" : "Source coverage unknown";
    return { saved, potentiallyAvailable, status, reason };
  };
  return { email: field("email"), phone: field("phone") };
}

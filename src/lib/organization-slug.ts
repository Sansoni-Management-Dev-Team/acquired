export function organizationSlug(name: string, suffix: string) {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "workspace";

  return `${base}-${suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}

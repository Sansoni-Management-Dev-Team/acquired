export function safeRedirectPath(path?: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/targets";
  return path;
}

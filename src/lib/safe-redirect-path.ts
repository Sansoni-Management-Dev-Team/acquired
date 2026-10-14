const appOrigin = "https://redirect.invalid";
export function safeRedirectPath(path?: string) {
  // Backslashes and controls change browser URL interpretation after validation.
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return "/targets";
  try {
    const destination = new URL(path, appOrigin);
    if (destination.origin !== appOrigin) return "/targets";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch { return "/targets"; }
}

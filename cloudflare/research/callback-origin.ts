export function callbackOrigin(value: string, localDevelopment = false) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(localDevelopment && loopback && url.protocol === "http:"))) throw new Error("HTTPS callback required outside local development");
  if (localDevelopment && !loopback) throw new Error("Local research requires a loopback callback");
  return url.origin;
}

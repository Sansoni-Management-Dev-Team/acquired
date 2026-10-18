import { localReaderEndpoint, type LocalReaderEnv } from "./local-reader";
import { callbackOrigin } from "./callback-origin";

export type LocalPolicyEnv = LocalReaderEnv & {
  APP_ORIGIN?: string;
  LOCAL_SEARCH_URL?: string;
  LOCAL_RESEARCH_POLICY?: string;
};

// Local connection safety and production policy are independent choices.
export function productionPolicy(env: LocalPolicyEnv) {
  return env.LOCAL_DEVELOPMENT !== "true" || env.LOCAL_RESEARCH_POLICY === "production";
}

/** Local research may call only its app, reader, search service and the configured AI API endpoints.
 * Reject redirects as well: --local alone does not restrict ordinary fetch(). */
export function researchFetch(env: LocalPolicyEnv, fetcher: typeof fetch = fetch): typeof fetch {
  if (env.LOCAL_DEVELOPMENT !== "true") return fetcher;
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const app = env.APP_ORIGIN ? callbackOrigin(env.APP_ORIGIN, true) : undefined;
    const allowed = !url.username && !url.password && (
      (url.origin === app && (url.pathname.startsWith("/api/research/internal/") || url.pathname.startsWith("/api/firmable/internal/"))) ||
      url.href === localReaderEndpoint(env) ||
      (!productionPolicy(env) && url.origin === "http://127.0.0.1:7000" && /^\/(duckduckgo|google)\/search$/.test(url.pathname)) ||
      url.href === "https://openrouter.ai/api/v1/chat/completions" ||
      url.href === "https://api.openai.com/v1/chat/completions"
    );
    if (!allowed) throw new Error("External destination blocked in local research");
    // workerd supports manual/follow only. Never follow a redirect outside the
    // allowlist, including redirects returned by an otherwise trusted service.
    const response = await fetcher(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Redirect blocked in local research");
    }
    return response;
  };
}

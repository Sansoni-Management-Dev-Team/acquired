import { localDevConfig } from "../../scripts/dev-config.mjs";

export function containerDevConfig(environment, researchSecret, authSecret, appOrigin = "https://acquire.orb.local") {
  // Explicit inputs: never inherit remote databases, live messaging or scheduler keys.
  const allowed = ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "GOOGLE_GMAIL_CLIENT_ID", "GOOGLE_GMAIL_CLIENT_SECRET", "ABN_LOOKUP_GUID"];
  const selected = Object.fromEntries(allowed.filter(key => environment[key]).map(key => [key, environment[key]]));
  const config = localDevConfig(selected, researchSecret, 3000);
  Object.assign(config.app, {
    APP_URL: appOrigin,
    NEXT_PUBLIC_APP_URL: appOrigin,
    BETTER_AUTH_SECRET: authSecret,
    TARGET_DATA_PROVIDER: "live",
    COMMUNICATIONS_RUNTIME_ENABLED: "false",
    CAMPAIGN_N8N_ENABLED: "false",
    CAMPAIGN_LINKEDIN_ENABLED: "false",
    WHATSAPP_SERVICE_URL: "", WHATSAPP_SERVICE_SECRET: "",
    LINKEDIN_SERVICE_URL: "", LINKEDIN_SERVICE_SECRET: "",
  });
  return config;
}

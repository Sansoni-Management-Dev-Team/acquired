import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local HTTPS tunnels need access to dev assets; never trust arbitrary tunnel hosts.
  ...(process.env.LOCAL_DEVELOPMENT === "true" && process.env.APP_URL
    ? { allowedDevOrigins: [new URL(process.env.APP_URL).hostname] } : {}),
  ...(process.env.APP_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  ...(process.env.CAMPAIGN_INTEGRATION_APP === "1" ? { distDir: ".next-campaign-integration" } : {}),
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/mandates/*": ["./.local-data/manufacturing-search-index.json"],
  },
};

export default nextConfig;

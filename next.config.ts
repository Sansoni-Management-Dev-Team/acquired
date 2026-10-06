import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.CAMPAIGN_INTEGRATION_APP === "1" ? { distDir: ".next-campaign-integration" } : {}),
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/mandates/*": ["./.local-data/manufacturing-search-index.json"],
  },
};

export default nextConfig;

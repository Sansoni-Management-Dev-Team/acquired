import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local HTTPS tunnels need access to dev assets; never trust arbitrary tunnel hosts.
  ...(process.env.LOCAL_DEVELOPMENT === "true" && process.env.APP_URL
    ? { allowedDevOrigins: [new URL(process.env.APP_URL).hostname] } : {}),
  ...(process.env.APP_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  ...(process.env.CAMPAIGN_INTEGRATION_APP === "1" ? { distDir: ".next-campaign-integration" } : {}),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // These directives protect document navigation/embedding without blocking
      // Next's generated inline bootstrap scripts or React's dynamic styles.
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
    ] }];
  },
  outputFileTracingIncludes: {
    "/api/mandates/*": ["./.local-data/manufacturing-search-index.json"],
  },
};

export default nextConfig;

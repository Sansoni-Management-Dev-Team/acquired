import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/mandates/*": ["./.local-data/manufacturing-search-index.json"],
  },
};

export default nextConfig;

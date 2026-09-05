import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/targets/search": ["./.local-data/manufacturing-search-index.json"],
  },
};

export default nextConfig;

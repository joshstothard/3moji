import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // Every path, including `_next/static` and the images the proxy skips (#205).
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] },
    ]);
  },
};

export default nextConfig;

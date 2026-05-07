import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Modul nativ — nu îl bundle-ui Next; rămâne în runtime Node. */
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;

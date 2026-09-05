import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray package-lock.json further up the user's
  // home directory otherwise makes Turbopack guess wrong about the project.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@novex/config", "@novex/ui"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;

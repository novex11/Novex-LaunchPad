import type { NextConfig } from "next";
import path from "path";

const empty = path.join(__dirname, "src/lib/empty-module.js");

const stubModules = [
  "@x402/evm/upto/client",
  "@x402/evm/exact/client",
  "@x402/core/client",
  "@x402/svm/exact/client",
  "@x402/evm",
  "@x402/core",
  "@x402/svm",
  "@react-native-async-storage/async-storage",
];

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@compose/config", "@compose/sdk", "@compose/ui"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(stubModules.map((m) => [m, empty])),
    };
    return config;
  },
};

export default nextConfig;

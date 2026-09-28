import type { NextConfig } from "next";
import path from "node:path";

const isAliyunBuild = process.env.OA_RUNTIME === "aliyun";

const nextConfig: NextConfig = {
  ...(isAliyunBuild ? {
    // The Aliyun source bundle is typechecked before packaging. The target
    // lightweight server has 1.6 GiB RAM, so avoid repeating the memory-heavy
    // compiler pass and keep Next's build worker count deterministic.
    typescript: { ignoreBuildErrors: true },
    experimental: { cpus: 1, memoryBasedWorkersCount: false },
  } : {}),
  poweredByHeader: false,
  webpack(config, { webpack }) {
    if (isAliyunBuild) {
      const replacement = path.resolve(process.cwd(), "aliyun/cloudflare-workers.ts");
      config.resolve.alias = {
        ...config.resolve.alias,
        "cloudflare:workers": replacement,
      };
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/u, replacement));
    }
    return config;
  },
};

export default nextConfig;

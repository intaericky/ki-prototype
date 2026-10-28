import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Sampling Sphere pages are static HTML in public/ (built by sampling-sphere/build.py)
  async rewrites() {
    return ["sphere-display", "sphere-tablet", "sphere-studio"].map((page) => ({
      source: `/${page}`,
      destination: `/${page}/index.html`,
    }));
  },
};

export default nextConfig;

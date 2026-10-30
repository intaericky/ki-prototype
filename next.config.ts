import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Sampling Sphere pages are static HTML in public/ (built by sampling-sphere/build.py)
  async rewrites() {
    return [
      ...["sphere-display", "sphere-tablet", "sphere-studio", "sphere-test-ripples", "sphere-test-shell", "sphere-test-liquid", "sphere-eye"].map((page) => ({
        source: `/${page}`,
        destination: `/${page}/index.html`,
      })),
      // Constellations: one page, three roles chosen by path (studio, sphere display, tablet); /sphere-orbits was its first version
      ...["constellations-studio", "constellations-display", "constellations-tablet", "sphere-orbits"].map((page) => ({
        source: `/${page}`,
        destination: "/constellations/index.html",
      })),
    ];
  },
};

export default nextConfig;

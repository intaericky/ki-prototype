import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Sampling Sphere pages are static HTML in public/ (built by sampling-sphere/build.py)
  async rewrites() {
    return [
      ...["sphere-display", "sphere-tablet", "sphere-studio", "sphere-test-ripples", "sphere-test-shell", "sphere-test-liquid", "sphere-test-sand", "sphere-eye"].map((page) => ({
        source: `/${page}`,
        destination: `/${page}/index.html`,
      })),
      // Constellations: one page, three roles chosen by path (studio, sphere display, tablet); /sphere-orbits was its first version
      ...["constellations-studio", "constellations-display", "constellations-tablet", "sphere-orbits"].map((page) => ({
        source: `/${page}`,
        destination: "/constellations/index.html",
      })),
      // Entangled: every tracked object as one colourful blob mesh; /entangled-display is the 360 frame for the LED sphere
      ...["entangled", "entangled-display"].map((page) => ({
        source: `/${page}`,
        destination: "/entangled/index.html",
      })),
      // Refraction: every tracked object as a glass ball; Earth is black and shows only through the glass
      ...["refraction", "refraction-display", "refraction-tablet"].map((page) => ({
        source: `/${page}`,
        destination: "/refraction/index.html",
      })),
      // Cleanup: only real debris, big enough to cover the Earth; a tap cleans one piece for good
      ...["cleanup", "cleanup-display", "cleanup-tablet"].map((page) => ({
        source: `/${page}`,
        destination: "/cleanup/index.html",
      })),
      // the audience's launch tablet
      { source: "/entangled-tablet", destination: "/entangled-tablet/index.html" },
    ];
  },
};

export default nextConfig;

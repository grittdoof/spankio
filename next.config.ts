import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // La CI exécute `tsc --noEmit` séparément ; on n'ignore jamais les erreurs.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Idem : lint exécuté par la CI, pas silencieusement contourné.
    ignoreDuringBuilds: false,
  },
  // Un seul lockfile fait autorité : celui du projet.
  outputFileTracingRoot: import.meta.dirname,
};

export default config;

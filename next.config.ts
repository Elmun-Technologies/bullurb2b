import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Slim production image for Fly.io (see Dockerfile): traced server + static.
  output: 'standalone',
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  compress: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;

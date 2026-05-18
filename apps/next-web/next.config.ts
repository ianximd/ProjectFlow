import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack's persistent dev cache is beta in Next 16 and crashes V8 on
  // Windows with "MemoryChunk allocation failed during deserialization" when
  // the .next cache grows large or the OS commit charge is tight. Until the
  // feature stabilises, recompute on each `next dev` start.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack's persistent dev cache is beta in Next 16 and crashes V8 on
  // Windows with "MemoryChunk allocation failed during deserialization" when
  // the .next cache grows large or the OS commit charge is tight. Until the
  // feature stabilises, recompute on each `next dev` start.
  experimental: {
    turbopackFileSystemCacheForDev: false,
    // Server Actions default to a 1 MB request-body limit, which rejects the
    // avatar uploads we advertise as "up to 3 MB" before the action even runs.
    // Lift it to 4 MB to match the API's global body guard (and its 3 MB avatar
    // cap, leaving headroom for multipart encoding overhead).
    serverActions: {
      bodySizeLimit: '4mb',
    },
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

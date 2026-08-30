import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg is Node-only; keep it out of the bundler (fixes "Can't resolve 'fs'"
  // when instrumentation.ts is compiled for non-node runtimes)
  serverExternalPackages: ['pg'],
  experimental: {
    // local-dev uploads ride through server actions (tasks are 16MB); on
    // Vercel anything over ~4.5MB goes browser→Supabase Storage instead
    serverActions: { bodySizeLimit: '17mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // SAMEORIGIN (not DENY): the candidate-profile resume preview
          // iframes our own /api/files route; external framing stays blocked
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // candidate portals are unguessable token URLs — keep them unindexed
      { source: '/c/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/app/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;

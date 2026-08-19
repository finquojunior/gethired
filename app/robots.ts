import type { MetadataRoute } from 'next';

// Only the careers site should be indexed; the dashboard, candidate portals
// (token URLs!), and APIs must stay out of search engines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/careers', disallow: ['/app', '/c/', '/api/', '/login'] }],
  };
}

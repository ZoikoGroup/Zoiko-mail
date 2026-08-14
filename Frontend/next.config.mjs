/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
/**
 * Security headers are configuration, not application code, so they live
 * here rather than in middleware. The CSP closes one of the five gaps the
 * specifications do not cover: no third-party scripts, tags or fonts on a
 * surface that collects credentials.
 */
// const CSP = [
//   "default-src 'self'",
//   "script-src 'self' 'unsafe-inline'",
//   "style-src 'self' 'unsafe-inline'",
//   "img-src 'self' data:",
//   "font-src 'self'",
//   "connect-src 'self'",
//   "frame-ancestors 'none'",
//   "base-uri 'self'",
//   "form-action 'self'",
// // ].join('; ');
// const isDev = process.env.NODE_ENV !== 'production';

// const CSP = [
//   "default-src 'self'",
//   `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
//   "style-src 'self' 'unsafe-inline'",
//   "img-src 'self' data:",
//   "font-src 'self'",
//   `connect-src 'self' ${API_ORIGIN}${isDev ? " ws: wss:" : ""}`,
//   "frame-ancestors 'none'",
//   "base-uri 'self'",
//   "form-action 'self'",
// ].join('; ');

// const nextConfig = {
//   reactStrictMode: true,
//   poweredByHeader: false,
//   async headers() {
//     return [
//       {
//         source: '/:path*',
//         headers: [
//           { key: 'Content-Security-Policy', value: CSP },
//           { key: 'X-Frame-Options', value: 'DENY' },
//           { key: 'X-Content-Type-Options', value: 'nosniff' },
//           { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
//           { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
//           { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
//           { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
//         ],
//       },
//     ];
//   },
// };

// export default nextConfig;

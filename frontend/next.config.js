/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export → out/ → deploy to Cloudflare Pages.
  output: 'export',
  // Trailing slash makes Cloudflare Pages routing simpler for static sites.
  trailingSlash: true,
  // <Image> optimization requires a server; disable for static export.
  images: { unoptimized: true },
}

module.exports = nextConfig

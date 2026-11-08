/** @type {import('next').NextConfig} */

// The dashboard is fully client-side, so it builds to static files.
// On GitHub Pages it is served from /<repo>, set via NEXT_PUBLIC_BASE_PATH.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
}

module.exports = nextConfig

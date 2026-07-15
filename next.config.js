/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false,
  // Fonts are loaded via <link> in app/layout.js; skip Next's remote-CSS
  // inlining so the build runs without harmless font-minify warnings.
  optimizeFonts: false,
};

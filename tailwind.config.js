/** @type {import('tailwindcss').Config} */
// Mirrors the config that previously lived inline in index.html alongside the
// cdn.tailwindcss.com script tag. The CDN build is a development-only tool and
// executes third-party JS on every page load, so Tailwind is compiled at build
// time instead.
export default {
  content: [
    './index.html',
    './index.tsx',
    './frontend/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        gray: {
          850: '#182032',
        },
      },
    },
  },
  plugins: [],
};

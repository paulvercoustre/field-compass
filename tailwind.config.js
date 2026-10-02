/** @type {import('tailwindcss').Config} */
// Mirrors the config that previously lived inline in index.html alongside the
// cdn.tailwindcss.com script tag. The CDN build is a development-only tool and
// executes third-party JS on every page load, so Tailwind is compiled at build
// time instead.
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  content: [
    './index.html',
    './index.tsx',
    './frontend/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        // Self-hosted (see frontend/index.css): the app's CSP only allows
        // fonts from its own origin.
        sans: ['"Inter Variable"', 'Inter', ...defaultTheme.fontFamily.sans],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // A neutral grey in place of Tailwind's blue-tinted default. Every
        // existing gray-* class picks it up, so surfaces, borders and text
        // shift together; colour is left for things that carry meaning
        // (the indigo accent and the status hues).
        gray: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          850: '#1f1f23',
          900: '#18181b',
          950: '#0c0c0e',
        },
      },
      fontSize: {
        // The step between 12 px and 14 px that dense tool UIs live at.
        '13': ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.03)',
        popover: '0 10px 38px -10px rgb(0 0 0 / 0.18), 0 10px 20px -15px rgb(0 0 0 / 0.12)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
      },
    },
  },
  plugins: [],
};

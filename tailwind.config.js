/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // MongoDB Design System Palette
        mongo: {
          green: '#00ed64',
          'green-deep': '#00b545',
          'green-pressed': '#008c34',
          'green-dark': '#00684a',
          'green-soft': '#c3f0d2',
          'teal-deep': '#001e2b',
          teal: '#003d4f',
          'teal-mid': '#00684a',
          surface: '#002636',
          'surface-card': '#01202e',
          hairline: '#1c2d38',
          'hairline-soft': '#243846',
          ink: '#001e2b',
          slate: '#3d4f5b',
          steel: '#5c6c7a',
          stone: '#7c8c9a',
          muted: '#a8b3bc',
          purple: '#7b3ff2',
          orange: '#fa6e39',
          pink: '#f06bb8',
          blue: '#3d4f9f',
        },
        canvas: {
          bg: '#001e2b',
          panel: '#002636',
          card: '#01202e',
          border: '#1c2d38',
          hover: '#003d4f',
        },
        aws: {
          orange: '#fa6e39',
          blue: '#3d4f9f',
          db: '#00ed64',
          cache: '#f06bb8',
          gateway: '#7b3ff2',
          queue: '#fa6e39',
          storage: '#00a35c',
          compute: '#fa6e39',
        }
      },
      fontFamily: {
        sans: ['"Euclid Circular A"', '"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"Source Code Pro"', '"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        'pill': '9999px',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        }
      }
    },
  },
  plugins: [],
}

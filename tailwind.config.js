/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cursor Design System Palette
        cursor: {
          primary: '#f54e00',
          'primary-active': '#d04200',
          ink: '#26251e',
          body: '#5a5852',
          'body-strong': '#26251e',
          muted: '#807d72',
          'muted-soft': '#a09c92',
          hairline: '#e6e5e0',
          'hairline-soft': '#efeee8',
          'hairline-strong': '#cfcdc4',
          canvas: '#f7f7f4',
          'canvas-soft': '#fafaf7',
          'surface-card': '#ffffff',
          'surface-strong': '#e6e5e0',
          'on-primary': '#ffffff',
          // In-product AI action pastels
          'timeline-thinking': '#dfa88f',
          'timeline-grep': '#9fc9a2',
          'timeline-read': '#9fbbe0',
          'timeline-edit': '#c0a8dd',
          'timeline-done': '#c08532',
          'semantic-success': '#1f8a65',
          'semantic-error': '#cf2d56',
        },
        aws: {
          orange: '#f54e00',
          blue: '#9fbbe0',
          db: '#9fc9a2',
          cache: '#dfa88f',
          gateway: '#c0a8dd',
          queue: '#c08532',
          storage: '#9fbbe0',
          compute: '#f54e00',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // The design's small mono labels ("ECS FARGATE", "REQUIREMENTS"): tiny, uppercase, loosely tracked.
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.06em' }],
      },
      borderRadius: {
        'xs': '4px',
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        'pill': '9999px',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

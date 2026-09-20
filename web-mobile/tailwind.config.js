/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#18181b',
          2: '#3f3f46',
          muted: '#71717a',
          faint: '#a1a1aa',
        },
        brand: {
          DEFAULT: '#2563eb',
          ink: '#1d4ed8',
          soft: '#eff6ff',
          line: '#bfdbfe',
        },
        tag: '#fdba74',
      },
      borderRadius: {
        card: '12px',
        sheet: '20px',
      },
    },
  },
  plugins: [],
}

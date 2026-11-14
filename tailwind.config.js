/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Change Navigator brand tokens (from approved brand imagery):
        // deep #032b7d (900), blue #1c96f2 (500). 600+ keep white-text contrast >= 4.5:1.
        brand: {
          50:  '#eef6fe',
          100: '#d8eafd',
          200: '#b0d4fa',
          300: '#7fb9f6',
          400: '#4aa0f3',
          500: '#1c96f2',
          600: '#0c66b8',
          700: '#0a4f8f',
          800: '#073c6e',
          900: '#032b7d',
        },
      },
      fontFamily: {
        sans: ['Assistant', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

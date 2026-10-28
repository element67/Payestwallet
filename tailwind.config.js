/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'sans-serif'],
        display: ['"Space Grotesk"', '"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      colors: {
        canvas: '#F3F6FC',
        ink: { DEFAULT: '#0F1B33', soft: '#4A5775', mute: '#8491AB' },
        brand: { 50: '#EEF4FF', 100: '#DCE8FF', 200: '#BCD2FF', 400: '#4C8DFF', 500: '#2F6BFF', 600: '#1F55E6', 700: '#1A44B8' },
        ok: { DEFAULT: '#12A150', soft: '#E7F7EE' },
        bad: { DEFAULT: '#D92D3F', soft: '#FDECEE' },
        warn: { DEFAULT: '#B7791F', soft: '#FFF6E0' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,27,51,0.04), 0 8px 24px rgba(31,85,230,0.07)',
        pop: '0 12px 40px rgba(15,27,51,0.18)',
        btn: '0 6px 16px rgba(47,107,255,0.32)',
      },
      borderRadius: { xl2: '1.25rem', xl3: '1.75rem' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: { shimmer: 'shimmer 1.4s infinite', rise: 'rise .25s ease-out both' },
    },
  },
  plugins: [],
}

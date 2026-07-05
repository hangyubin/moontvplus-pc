/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#5b6eff',
        surface: 'var(--color-app-bg)',
        panel: 'var(--color-panel-bg)',
        card: 'var(--color-card-bg)'
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem'
      }
    }
  },
  plugins: []
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        surface: 'var(--color-app-bg)',
        panel: 'var(--color-panel-bg)',
        card: 'var(--color-card-bg)'
      }
    }
  },
  plugins: []
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mamba: {
          green: '#28D99E',
          deep: '#1FA97C',
          neon: '#49FFB7',
          dark: '#06141A',
          panel: '#0D1B21',
          card: '#13262E',
          border: '#1F3A43',
          text: '#E6F3F1',
          muted: '#8CAFB3',
        },
      },
    },
  },
  plugins: [],
};

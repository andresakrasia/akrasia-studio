import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'primary': '#00f0ff',
        'background': '#050505',
        'panel': 'rgba(10, 10, 10, 0.6)',
        'panel-border': 'rgba(0, 240, 255, 0.2)',
        'accent-dim': '#003a3d',
      },
      fontFamily: {
        'headline': ['Space Grotesk', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
} satisfies Config;

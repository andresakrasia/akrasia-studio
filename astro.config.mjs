import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://akrasia.studio',
  integrations: [react()],
  output: 'server',
  adapter: vercel({ maxDuration: 60 }),
});

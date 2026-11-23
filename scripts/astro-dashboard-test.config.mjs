import projectConfig from '../astro.config.mjs';
import path from 'node:path';

// The isolated preview has no access to local .env files.
export default {
  ...projectConfig,
  vite: {
    ...projectConfig.vite,
    envDir: process.env.AKRASIA_TEST_ENV_DIR,
    cacheDir: process.env.AKRASIA_TEST_ENV_DIR
      ? path.join(process.env.AKRASIA_TEST_ENV_DIR, '.vite')
      : '.codex-tmp/vite-dashboard-preview',
    server: { ...projectConfig.vite?.server, strictPort: true },
  },
};

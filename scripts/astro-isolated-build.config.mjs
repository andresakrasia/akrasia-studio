import projectConfig from '../astro.config.mjs';
import path from 'node:path';
// Compile the same production configuration without loading the local .env.
export default { ...projectConfig,
  ...(process.env.AKRASIA_ISOLATED_OUTPUT_DIR ? { outDir: process.env.AKRASIA_ISOLATED_OUTPUT_DIR } : {}),
  vite: {
  ...projectConfig.vite,
  envDir: process.env.AKRASIA_TEST_ENV_DIR,
  cacheDir: process.env.AKRASIA_TEST_ENV_DIR
    ? path.join(process.env.AKRASIA_TEST_ENV_DIR, '.vite')
    : '.codex-tmp/vite-isolated-build',
} };

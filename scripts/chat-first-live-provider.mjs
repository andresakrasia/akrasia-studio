import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const defaultEnvFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
const configurationError = () => new Error('La IA de la vista previa no está configurada. Comprueba OPENROUTER_API_KEY.');
const keyValue = value => typeof value === 'string' ? value.trim() : '';

/** Opt-in credential loader for the local preview. It neither changes the
 * process environment nor connects to the provider or a remote database. */
export async function loadPreviewChatProvider({ enabled = false, envFile = defaultEnvFile, environment = process.env } = {}) {
  if (enabled !== true) return { apiKey: '', allowedOrigins: [] };
  try {
    let apiKey = keyValue(environment?.OPENROUTER_API_KEY);
    if (!apiKey) {
      const values = parseEnv(await readFile(envFile, 'utf8'));
      apiKey = keyValue(values.OPENROUTER_API_KEY);
    }
    if (!apiKey || /[\r\n\0]/u.test(apiKey)) throw configurationError();
    return { apiKey, allowedOrigins: ['https://openrouter.ai'] };
  } catch {
    // File paths, contents, parsing diagnostics and credentials stay private.
    throw configurationError();
  }
}

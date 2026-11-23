import { writeFile } from 'node:fs/promises';
import { loadChatFirstServices, renderServicesCatalogueSql } from './chat-first-catalogue-fixture.mjs';

// Writes a reviewable local SQL file only. No environment, connection or execution.
const services = await loadChatFirstServices();
await writeFile(new URL('../supabase/seeds/services-editorial.sql', import.meta.url), renderServicesCatalogueSql(services), 'utf8');
console.log('Prepared six unpublished editorial drafts in supabase/seeds/services-editorial.sql. No database was contacted.');

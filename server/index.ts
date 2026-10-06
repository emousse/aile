import { createApp } from './app';
import { createOpenAiProvider } from './ai';

const model = process.env.OPENAI_MODEL;
const apiKey = process.env.OPENAI_API_KEY;
if (apiKey && !model) throw new Error('OPENAI_MODEL doit être renseigné avec OPENAI_API_KEY.');
const app = await createApp({
  production: process.env.NODE_ENV === 'production',
  publicOrigin: process.env.PUBLIC_ORIGIN ?? (process.env.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:5173'),
  secret: process.env.SIGNING_SECRET, pilotPassword: process.env.PILOT_PASSWORD,
  allowedHosts: process.env.ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean),
  braveKey: process.env.BRAVE_SEARCH_API_KEY,
  ai: apiKey && model ? createOpenAiProvider({ apiKey, model }) : undefined,
  staticRoot: process.env.NODE_ENV === 'production' ? 'dist/client' : undefined,
});
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3001) });
console.info(`Aile API disponible sur le port ${process.env.PORT ?? 3001}. IA ${apiKey ? 'activée' : 'inactive'}.`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });

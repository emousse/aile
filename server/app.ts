import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { type PageDocument, explainRequestSchema } from '../shared/types';
import { createDocumentService, type AiProvider } from './service';
import { loadPage } from './loader';
import { fetchResource } from './network';
import { searchPages } from './search';
import { AppError } from './errors';

export type AppOptions = { secret?: string; pilotPassword?: string; production?: boolean; publicOrigin?: string; staticRoot?: string; ai?: AiProvider; allowedHosts?: string[]; braveKey?: string; load?: (url: string) => Promise<PageDocument> };
export async function createApp(options: AppOptions = {}) {
  if (options.production && (!options.secret || options.secret.length < 32 || !options.pilotPassword || options.pilotPassword.length < 12)) throw new Error('Production : SIGNING_SECRET (32 caractères minimum) et PILOT_PASSWORD (12 caractères minimum) requis.');
  const app = Fastify({ logger: false, bodyLimit: 750_000, trustProxy: false, requestTimeout: 35_000 });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: options.production ? [] : null } }, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'no-referrer' } });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (req.url === '/health') return;
    if (options.pilotPassword) {
      const expected = Buffer.from(`Basic ${Buffer.from(`pilote:${options.pilotPassword}`).toString('base64')}`);
      const actual = Buffer.from(req.headers.authorization ?? '');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return reply.header('WWW-Authenticate', 'Basic realm="Aile pilote", charset="UTF-8"').code(401).send({ error: 'Accès réservé au pilote.' });
    }
    if (req.url.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('CROSS_SITE', 'Cette action doit être effectuée depuis Aile.', 403);
    if (req.method === 'POST' && req.headers.origin) {
      let host: string;
      try { host = new URL(req.headers.origin).host; } catch { throw new AppError('ORIGIN', 'Origine refusée.', 403); }
      if (host !== req.headers.host && req.headers.origin !== options.publicOrigin) throw new AppError('ORIGIN', 'Origine refusée.', 403);
    }
  });
  let active = 0;
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= 4) throw new AppError('BUSY', 'Aile prépare déjà plusieurs pages. Réessaie dans un instant.', 503);
    active++;
    try { return await operation(); } finally { active--; }
  }
  const service = createDocumentService({ secret: options.secret ?? randomBytes(32).toString('hex'), ai: options.ai,
    load: async url => {
      const doc = await (options.load ?? (input => loadPage(input, options.allowedHosts)))(url);
      const expiresAt = Date.now() + 3_600_000;
      for (const block of doc.blocks) if (block.type === 'image') {
        const query = new URLSearchParams({ url: block.src, expiresAt: String(expiresAt), proof: service.signImage(block.src, expiresAt) });
        block.src = `/api/image?${query}`;
      }
      return doc;
    },
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/config', async () => ({ aiEnabled: !!options.ai, searchProvider: options.braveKey ? 'brave' : 'wikipedia', restrictedHosts: options.allowedHosts ?? [] }));
  app.post('/api/page', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async req => {
    const { url } = z.object({ url: z.string().trim().min(3).max(2048) }).parse(req.body);
    return bounded(() => service.open(url));
  });
  app.post('/api/explain', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async req => {
    const input = explainRequestSchema.parse(req.body);
    return bounded(() => service.explain(input));
  });
  app.post('/api/search', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async req => {
    const { query } = z.object({ query: z.string().trim().min(2).max(200) }).parse(req.body);
    return bounded(() => searchPages(query, options.braveKey));
  });
  app.get('/api/image', async (req, reply) => {
    const { url, expiresAt, proof } = z.object({ url: z.string().max(2048), expiresAt: z.coerce.number(), proof: z.string().max(100) }).parse(req.query);
    service.verifyImage(url, expiresAt, proof);
    const resource = await bounded(() => fetchResource(url, { maxBytes: 3_000_000, accept: 'image/png,image/jpeg,image/webp,image/gif', timeoutMs: 8000 }));
    const mime = resource.headers['content-type']?.split(';')[0]?.trim();
    if (!mime || !['image/png','image/jpeg','image/webp','image/gif'].includes(mime)) throw new AppError('IMAGE_FORMAT', 'Format d’image non pris en charge.', 422);
    return reply.type(mime).header('X-Content-Type-Options', 'nosniff').send(resource.body);
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.message, code: error.code });
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Cette demande est incomplète ou trop longue.', code: 'INVALID_REQUEST' });
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode === 429) return reply.code(429).send({ error: 'Trop de demandes rapprochées. Réessaie dans une minute.', code: 'RATE_LIMIT' });
    if (statusCode === 413) return reply.code(413).send({ error: 'Cette demande est trop volumineuse.', code: 'TOO_LARGE' });
    return reply.code(502).send({ error: 'Cette demande n’a pas abouti. Réessaie ou choisis une autre page.', code: 'REQUEST_FAILED' });
  });
  if (options.staticRoot) {
    await app.register(fastifyStatic, { root: resolve(options.staticRoot), maxAge: 0 });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Adresse inconnue.' }) : reply.sendFile('index.html'));
  }
  return app;
}

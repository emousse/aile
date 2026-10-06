import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { extractArticle } from '../server/extraction';
import { articleHtml } from './fixtures';

describe('API du pilote', () => {
  it('accepte uniquement l’origine frontend explicitement configurée derrière un proxy', async () => {
    const app = await createApp({ secret: 'test-secret-at-least-32-characters-long', publicOrigin: 'http://127.0.0.1:5173', load: async () => extractArticle(articleHtml, 'https://example.com') });
    const response = await app.inject({ method: 'POST', url: '/api/page', headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173' }, payload: { url: 'https://example.com' } });
    expect(response.statusCode).toBe(200);
    const refused = await app.inject({ method: 'POST', url: '/api/page', headers: { origin: 'https://other.example' }, payload: { url: 'https://example.com' } });
    expect(refused.statusCode).toBe(403);
    await app.close();
  });
  it('valide les entrées, protège les mutations intersites et ne renvoie pas les erreurs internes', async () => {
    const load = vi.fn(async () => extractArticle(articleHtml, 'https://example.com/science'));
    const app = await createApp({ secret: 'test-secret-at-least-32-characters-long', load });
    const invalid = await app.inject({ method: 'POST', url: '/api/page', payload: { url: '' } });
    expect(invalid.statusCode).toBe(400);
    const cross = await app.inject({ method: 'POST', url: '/api/page', headers: { 'sec-fetch-site': 'cross-site' }, payload: { url: 'https://example.com' } });
    expect(cross.statusCode).toBe(403);
    expect(load).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/page', payload: { url: 'https://example.com/science' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().document.title).toBe('Les couleurs du poulpe');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().proof).toBeTruthy();
    await app.close();
  });
  it('refuse un déploiement de production sans secret stable et protection du pilote', async () => {
    await expect(createApp({ production: true })).rejects.toThrow();
  });
  it('protège le pilote par mot de passe quand il est configuré', async () => {
    const app = await createApp({ secret: 'test-secret-at-least-32-characters-long', pilotPassword: 'test-password' });
    expect((await app.inject('/api/config')).statusCode).toBe(401);
    const auth = `Basic ${Buffer.from('pilote:test-password').toString('base64')}`;
    expect((await app.inject({ url: '/api/config', headers: { authorization: auth } })).statusCode).toBe(200);
    await app.close();
  });
  it('refuse des explications sans preuve de source', async () => {
    const app = await createApp({ secret: 'test-secret-at-least-32-characters-long' });
    const res = await app.inject({ method: 'POST', url: '/api/explain', payload: { blockId: 'invented', quote: 'bonjour' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it('valide une vraie preuve après aller-retour JSON et refuse la neuvième explication par minute', async () => {
    const ai = { landmarks: vi.fn(async () => []), explain: vi.fn(async () => ({ explanation: 'Des cellules contenant des pigments.', caveat: '' })) };
    const app = await createApp({ secret: 'test-secret-at-least-32-characters-long', ai, load: async () => extractArticle(articleHtml, 'https://example.com/science') });
    const page = (await app.inject({ method: 'POST', url: '/api/page', payload: { url: 'https://example.com/science' } })).json();
    const block = page.document.blocks.find((b: { type: string }) => b.type === 'paragraph');
    for (let i = 0; i < 8; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/explain', payload: { ...page, blockId: block.id, quote: 'Le poulpe' } });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'POST', url: '/api/explain', payload: { ...page, blockId: block.id, quote: 'Le poulpe' } });
    expect(limited.statusCode).toBe(429);
    expect(ai.explain).toHaveBeenCalledTimes(8);
    await app.close();
  });
});

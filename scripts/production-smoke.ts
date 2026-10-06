import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Envelope } from '../shared/types';

// Real compiled server and worker. No provider keys, no paid AI calls.
const password = randomBytes(20).toString('hex');
const port = 3199;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['dist/server/index.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), PUBLIC_ORIGIN: base,
  SIGNING_SECRET: randomBytes(32).toString('hex'), PILOT_PASSWORD: password, OPENAI_API_KEY: '', OPENAI_MODEL: '', BRAVE_SEARCH_API_KEY: '', ALLOWED_HOSTS: '',
} });
let failure = ''; server.stderr.on('data', chunk => { failure += String(chunk); });
const headers = { authorization: `Basic ${Buffer.from(`pilote:${password}`).toString('base64')}`, 'Content-Type': 'application/json', origin: base };
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null) throw new Error(`Le serveur n’a pas démarré : ${failure}`);
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* Wait for the listener. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert(ready, 'Le serveur de production doit démarrer.');
  assert.equal((await fetch(base)).status, 401, 'Le pilote doit être privé.');
  const home = await fetch(base, { headers });
  assert.equal(home.status, 200); assert((await home.text()).includes('<div id="root">'));
  assert(home.headers.get('content-security-policy')?.includes("frame-src 'none'"));
  const blocked = await fetch(`${base}/api/page`, { method: 'POST', headers, body: JSON.stringify({ url: 'https://127.0.0.1' }) });
  assert.equal(blocked.status, 400);
  console.log('Production : démarrage, fichiers statiques, authentification, CSP et blocage réseau vérifiés.');
  if (process.argv.includes('--live')) {
    const response = await fetch(`${base}/api/page`, { method: 'POST', headers, body: JSON.stringify({ url: 'https://fr.wikipedia.org/wiki/Chromatophore' }) });
    const envelope = await response.json() as Envelope & { error?: string };
    assert.equal(response.status, 200, envelope.error ?? 'La vraie page doit être restituée.');
    assert(envelope.document.blocks.some(block => block.type === 'heading'));
    assert(envelope.document.blocks.some(block => block.type === 'image'));
    assert.equal(envelope.document.ai.status, 'off');
    assert(envelope.document.licenseUrl);
    const search = await fetch(`${base}/api/search`, { method: 'POST', headers, body: JSON.stringify({ query: 'chromatophore' }) });
    assert.equal(search.status, 200); assert((await search.json() as { results: unknown[] }).results.length > 0);
    console.log(`Web réel : ${envelope.document.title}, ${envelope.document.blocks.length} blocs, titres et images présents ; recherche Wikipédia vérifiée. IA non appelée.`);
  }
} finally { server.kill('SIGTERM'); }

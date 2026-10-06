import { Worker } from 'node:worker_threads';
import { fetchResource } from './network';
import { AppError } from './errors';
import type { PageDocument } from '../shared/types';

export async function loadPage(url: string, allowedHosts: string[] = []): Promise<PageDocument> {
  const result = await fetchResource(url, { allowedHosts });
  const type = result.headers['content-type'] ?? '';
  if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(type)) throw new AppError('UNSUPPORTED_CONTENT', 'Cette version prend en charge les pages HTML, pas les PDF ou les fichiers multimédias.', 422);
  const charset = /charset=["']?([^\s;"']+)/i.exec(type)?.[1] ?? 'utf-8';
  let html: string;
  try { html = new TextDecoder(charset).decode(result.body); } catch { throw new AppError('UNSUPPORTED_CHARSET', 'L’encodage de cette page n’est pas pris en charge.', 422); }
  return extractInWorker(html, result.url);
}

export function extractInWorker(html: string, url: string): Promise<PageDocument> {
  return new Promise((resolve, reject) => {
    const production = import.meta.url.endsWith('.js');
    const workerUrl = new URL(production ? './extract-worker.js' : './extract-worker.ts', import.meta.url);
    const worker = production
      ? new Worker(workerUrl, { workerData: { html, url }, resourceLimits: { maxOldGenerationSizeMb: 128 } })
      : new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(workerUrl.href)}, ${JSON.stringify(import.meta.url)}));`, { eval: true, execArgv: [], workerData: { html, url }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new AppError('EXTRACTION_TIMEOUT', 'Cette page est trop complexe pour être préparée.', 422)); }, 6000);
    worker.on('message', (message: { type?: string; document?: PageDocument; error?: { code: string; message: string; status: number } }) => {
      // Node watch/tsx may send their own dependency messages on this channel.
      if (message.type !== 'aile:extraction') return;
      clearTimeout(timer); void worker.terminate();
      if (message.document) resolve(message.document);
      else reject(new AppError(message.error?.code ?? 'EXTRACTION_FAILED', message.error?.message ?? 'Extraction impossible.', message.error?.status ?? 422));
    });
    worker.once('error', () => { clearTimeout(timer); reject(new AppError('EXTRACTION_FAILED', 'Cette page n’a pas pu être préparée.', 422)); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new AppError('EXTRACTION_FAILED', 'La préparation de cette page a été interrompue.', 422)); });
  });
}

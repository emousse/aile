import { expect, it } from 'vitest';
import { extractInWorker } from '../server/loader';
import { articleHtml } from './fixtures';
it('extrait dans le vrai worker sans exécuter les scripts de la page', async () => {
  const doc = await extractInWorker(articleHtml, 'https://example.com/science');
  expect(doc.title).toBe('Les couleurs du poulpe');
  expect(JSON.stringify(doc)).not.toContain('PWNED');
});

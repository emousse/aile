import { expect, it, vi } from 'vitest';
import { createOpenAiProvider } from '../server/ai';

it('envoie le minimum utile, sans outils ni conservation de réponse, et valide le JSON', async () => {
  const call = vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ explanation: 'Une explication.', caveat: 'À vérifier.' }) }] }] }), { status: 200 }));
  const ai = createOpenAiProvider({ apiKey: 'test', model: 'test-model', request: call });
  const result = await ai.explain({ title: 'Un titre', passage: 'Un passage source.', quote: 'passage' });
  expect(result).toEqual({ explanation: 'Une explication.', caveat: 'À vérifier.' });
  const body = JSON.parse((call.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.store).toBe(false);
  expect(body.tools).toBeUndefined();
  expect(body.input[1].content).toContain('Un passage source.');
  expect(body.max_output_tokens).toBeLessThanOrEqual(800);
  expect(body.text.format.strict).toBe(true);
});

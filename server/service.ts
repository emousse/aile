import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Envelope, type PageDocument, type Explanation, blockText, explanationSchema, landmarkSchema } from '../shared/types';
import { AppError } from './errors';
import { z } from 'zod';

export interface AiProvider {
  landmarks(doc: PageDocument): Promise<unknown>;
  explain(input: { title: string; passage: string; quote: string }): Promise<unknown>;
}
export function createDocumentService(options: { secret: string; load: (url: string) => Promise<PageDocument>; ai?: AiProvider; now?: () => number }) {
  const now = options.now ?? Date.now;
  function signature(value: unknown) { return createHmac('sha256', options.secret).update(JSON.stringify(value)).digest('base64url'); }
  function verify(envelope: Envelope) {
    if (envelope.expiresAt < now()) throw new AppError('SOURCE_EXPIRED', 'Cette version de la page a expiré. Recharge-la pour continuer.', 410);
    const expected = Buffer.from(signature({ document: envelope.document, expiresAt: envelope.expiresAt }));
    const actual = Buffer.from(envelope.proof);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError('INVALID_SOURCE', 'La référence à cette page ne peut pas être vérifiée. Recharge-la.', 400);
  }
  return {
    async open(url: string): Promise<Envelope> {
      const document = await options.load(url);
      if (options.ai) {
        try {
          const landmarks = z.array(landmarkSchema).max(3).parse(await options.ai.landmarks(document));
          const seen = new Set<string>();
          document.ai = { status: 'ready', landmarks: landmarks.filter(l => {
            if (seen.has(l.blockId) || !document.blocks.some(b => b.id === l.blockId && 'content' in b)) return false;
            seen.add(l.blockId); return true;
          }) };
        } catch { document.ai = { status: 'failed', landmarks: [] }; }
      }
      const expiresAt = now() + 60 * 60 * 1000;
      return { document, expiresAt, proof: signature({ document, expiresAt }) };
    },
    async explain(input: Envelope & { blockId: string; quote: string }): Promise<Explanation> {
      verify(input);
      const block = input.document.blocks.find(b => b.id === input.blockId);
      if (!block || !blockText(block).includes(input.quote) || input.quote.length < 2 || input.quote.length > 1200) throw new AppError('INVALID_SELECTION', 'Sélectionne un passage présent dans cette page.');
      if (!options.ai) throw new AppError('AI_DISABLED', 'L’IA n’est pas activée pour cet essai. La lecture et les liens restent disponibles.', 503);
      const fullText = blockText(block); const index = fullText.indexOf(input.quote);
      const passage = fullText.slice(Math.max(0, index - 700), index + input.quote.length + 700);
      const answer = explanationSchema.parse(await options.ai.explain({ title: input.document.title, passage, quote: input.quote }));
      return { ...answer, kind: 'ai', source: { url: input.document.url, blockId: block.id, quote: input.quote } };
    },
    signImage(url: string, expiresAt: number) { return signature({ image: url, expiresAt }); },
    verifyImage(url: string, expiresAt: number, proof: string) {
      if (expiresAt < now()) throw new AppError('SOURCE_EXPIRED', 'Cette image a expiré.', 410);
      const expected = Buffer.from(signature({ image: url, expiresAt })); const actual = Buffer.from(proof);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError('INVALID_SOURCE', 'Image non autorisée.', 403);
    },
    verify,
  };
}

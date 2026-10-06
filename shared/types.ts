import { z } from 'zod';

export const inlineSchema = z.object({ text: z.string(), href: z.string().optional(), emphasis: z.enum(['strong', 'em']).optional() });
export type Inline = z.infer<typeof inlineSchema>;
const base = { id: z.string().max(80) };
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('paragraph'), content: z.array(inlineSchema) }),
  z.object({ ...base, type: z.literal('heading'), level: z.number().int().min(2).max(4), content: z.array(inlineSchema) }),
  z.object({ ...base, type: z.literal('quote'), content: z.array(inlineSchema) }),
  z.object({ ...base, type: z.literal('list'), ordered: z.boolean(), items: z.array(z.array(inlineSchema)) }),
  z.object({ ...base, type: z.literal('image'), src: z.string(), alt: z.string(), caption: z.string() }),
  z.object({ ...base, type: z.literal('table'), caption: z.string(), rows: z.array(z.array(z.object({ header: z.boolean(), content: z.array(inlineSchema) }))) }),
]);
export type Block = z.infer<typeof blockSchema>;
export const landmarkSchema = z.object({ blockId: z.string(), label: z.string().min(1).max(100) });
export const documentSchema = z.object({
  id: z.string(), url: z.string(), title: z.string(), siteName: z.string(), byline: z.string().nullable(), date: z.string().nullable(),
  lang: z.string(), fetchedAt: z.string(), blocks: z.array(blockSchema).max(350),
  links: z.array(z.object({ id: z.string(), label: z.string(), url: z.string() })).max(100),
  notices: z.array(z.string()), ai: z.object({ status: z.enum(['off', 'ready', 'failed']), landmarks: z.array(landmarkSchema).max(3) }),
  anchors: z.record(z.string(), z.string()).optional(), licenseUrl: z.string().nullable().optional(),
});
export type PageDocument = z.infer<typeof documentSchema>;
export const envelopeSchema = z.object({ document: documentSchema, proof: z.string(), expiresAt: z.number() });
export type Envelope = z.infer<typeof envelopeSchema>;
export const explainRequestSchema = envelopeSchema.extend({ blockId: z.string().max(80), quote: z.string().trim().min(2).max(1200) });
export const explanationSchema = z.object({ explanation: z.string().min(1).max(2400), caveat: z.string().max(600) });
export type Explanation = z.infer<typeof explanationSchema> & { kind: 'ai'; source: { url: string; blockId: string; quote: string } };
export type SearchResult = { title: string; url: string; description: string };
export type SearchResponse = { provider: 'wikipedia' | 'brave'; results: SearchResult[] };
export type AppConfig = { aiEnabled: boolean; searchProvider: 'wikipedia' | 'brave'; restrictedHosts: string[] };

export function blockText(block: Block): string {
  if ('content' in block) return block.content.map(part => part.text).join('');
  if (block.type === 'list') return block.items.map(item => item.map(part => part.text).join('')).join('\n');
  if (block.type === 'table') return block.rows.map(row => row.map(cell => cell.content.map(p => p.text).join('')).join(' | ')).join('\n');
  return block.caption || block.alt;
}

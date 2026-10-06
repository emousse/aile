import { z } from 'zod';
import { fetchResource, normalizeUrl } from './network';
import { AppError } from './errors';
import type { SearchResponse } from '../shared/types';

export async function searchPages(query: string, braveKey?: string): Promise<SearchResponse> {
  if (braveKey) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.search = new URLSearchParams({ q: query, count: '8', search_lang: 'fr', safesearch: 'strict', text_decorations: 'false' }).toString();
    const response = await fetch(url, { headers: { 'X-Subscription-Token': braveKey, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new AppError('SEARCH_UNAVAILABLE', 'La recherche ne répond pas. Tu peux ouvrir une adresse directement.', 503);
    const data = z.object({ web: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), description: z.string().optional() })) }).optional() }).parse(await response.json());
    return { provider: 'brave', results: (data.web?.results ?? []).flatMap(item => {
      try { return [{ title: item.title, url: normalizeUrl(item.url).href, description: item.description ?? '' }]; } catch { return []; }
    }).slice(0, 8) };
  }
  const url = new URL('https://fr.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '8', srprop: '', format: 'json', utf8: '1' }).toString();
  const resource = await fetchResource(url.href, { accept: 'application/json', maxBytes: 150_000 });
  const data = z.object({ query: z.object({ search: z.array(z.object({ title: z.string() })) }) }).parse(JSON.parse(resource.body.toString('utf8')));
  return { provider: 'wikipedia', results: data.query.search.map(item => ({ title: item.title, url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(' ', '_'))}`, description: 'Article de Wikipédia · encyclopédie collaborative' })) };
}

import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors';

export type Address = { address: string; family: number };
type Lookup = (host: string) => Promise<Address[]>;
type Resource = { status: number; headers: Record<string, string | undefined>; body: Buffer };
type Limits = { maxBytes: number; timeoutMs: number; accept: string };
type Transport = (url: URL, address: Address, limits: Limits) => Promise<Resource>;
export type FetchOptions = Partial<Limits> & { lookup?: Lookup; transport?: Transport; allowedHosts?: string[] };
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}
export function normalizeUrl(input: string): URL {
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); }
  catch { throw new AppError('INVALID_URL', 'Cette adresse Web ne semble pas complète.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (!host.includes('.') && !isIP(host)) || (isIP(host) && !isPublicAddress(host))) {
    throw new AppError('UNSUPPORTED_URL', 'Seules les adresses HTTPS publiques sont accessibles.');
  }
  url.hash = '';
  return url;
}
export async function resolveTarget(url: URL, lookup: Lookup = host => dnsLookup(host, { all: true, verbatim: true })): Promise<Address> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new AppError('BLOCKED_ADDRESS', 'Cette destination réseau n’est pas accessible.');
  return addresses[0]!;
}
export function pinnedTransport(url: URL, address: Address, limits: Limits): Promise<Resource> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', agent: false,
      // Connect only to the validated address, retaining the original host for TLS and Host.
      lookup: (_host, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [address] as never);
        else callback(null, address.address, address.family);
      },
      headers: { 'User-Agent': 'AileResearch/0.1 (public-page reader)', Accept: limits.accept, 'Accept-Encoding': 'identity' },
    }, res => {
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(); reject(new AppError('UNSUPPORTED_ENCODING', 'Cette page utilise un format non pris en charge.', 422)); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limits.maxBytes) { req.destroy(new AppError('TOO_LARGE', 'Cette ressource est trop volumineuse pour cette version.', 413)); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 502, headers: { location: res.headers.location, 'content-type': res.headers['content-type'] }, body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => req.destroy(new AppError('FETCH_TIMEOUT', 'Le site met trop de temps à répondre. Réessaie plus tard.', 504)), limits.timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}
export async function fetchResource(input: string, options: FetchOptions = {}): Promise<Resource & { url: string }> {
  let url = normalizeUrl(input);
  const start = Date.now(); const budget = options.timeoutMs ?? 12_000;
  for (let hop = 0; hop < 5; hop++) {
    if (options.allowedHosts?.length && !options.allowedHosts.includes(url.hostname)) throw new AppError('DOMAIN_NOT_ALLOWED', 'Ce site ne fait pas partie des domaines autorisés pour cet essai.', 403);
    const remaining = budget - (Date.now() - start);
    if (remaining <= 0) throw new AppError('FETCH_TIMEOUT', 'Le site met trop de temps à répondre.', 504);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const address = await Promise.race([
      resolveTarget(url, options.lookup),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('DNS_TIMEOUT', 'La destination ne répond pas.', 504)), Math.min(remaining, 4000)); }),
    ]).finally(() => clearTimeout(timer));
    const response = await (options.transport ?? pinnedTransport)(url, address, { maxBytes: options.maxBytes ?? 2_000_000, timeoutMs: Math.max(1, budget - (Date.now() - start)), accept: options.accept ?? 'text/html, application/xhtml+xml' });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      url = normalizeUrl(new URL(response.headers.location, url).href); continue;
    }
    if (response.status < 200 || response.status >= 300) throw new AppError('UPSTREAM_ERROR', `Le site n’a pas fourni cette page (HTTP ${response.status}).`, 422);
    return { ...response, url: url.href };
  }
  throw new AppError('REDIRECT_LIMIT', 'Cette adresse redirige trop de fois.', 422);
}

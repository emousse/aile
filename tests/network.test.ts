import { describe, expect, it, vi } from 'vitest';
import { normalizeUrl, isPublicAddress, resolveTarget, fetchResource } from '../server/network';

describe('frontière réseau — SSRF', () => {
  it('normalise une adresse Web sans accepter les identifiants ou ports alternatifs', () => {
    expect(normalizeUrl('fr.wikipedia.org/wiki/Pieuvre').href).toBe('https://fr.wikipedia.org/wiki/Pieuvre');
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://example.com', 'https://u:p@example.com', 'https://example.com:8080', 'https://localhost', 'https://127.1', 'https://2130706433', 'https://[::1]']) {
      expect(() => normalizeUrl(url)).toThrow();
    }
  });
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1'])('refuse %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it('accepte une IP publique', () => expect(isPublicAddress('93.184.216.34')).toBe(true));
  it('refuse tout le résultat DNS si une seule adresse est privée', async () => {
    await expect(resolveTarget(new URL('https://example.com'), async () => [
      { address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 },
    ])).rejects.toThrow();
  });
  it('épingle une adresse résolue et revalide chaque redirection', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const transport = vi.fn(async () => ({ status: 302, headers: { location: 'https://127.0.0.1/secret' }, body: Buffer.from('') }));
    await expect(fetchResource('https://example.com', { lookup, transport })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]).toEqual([expect.any(URL), { address: '93.184.216.34', family: 4 }, expect.any(Object)]);
  });
  it('applique la liste des domaines au départ et après redirection', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const transport = vi.fn(async () => ({ status: 302, headers: { location: 'https://elsewhere.org' }, body: Buffer.from('') }));
    await expect(fetchResource('https://example.com', { lookup, transport, allowedHosts: ['example.com'] })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const doc = {
  id: 'fixture', url: 'https://example.com/poulpe', title: 'Les couleurs du poulpe', siteName: 'Le laboratoire', byline: 'Camille Exemple', date: '2026-01-12', lang: 'fr', fetchedAt: '2026-09-09T00:00:00Z',
  blocks: [
    { id: 'b-0', type: 'paragraph', content: [{ text: 'Le poulpe change de couleur grâce à des cellules appelées chromatophores.' }] },
    { id: 'b-1', type: 'heading', level: 2, content: [{ text: 'Observer la nature' }] },
    { id: 'b-2', type: 'paragraph', content: [{ text: 'Découvrir les ' }, { text: 'animaux marins', href: 'https://reference.org/animaux' }, { text: ' permet de poser de nouvelles questions. ' }, { text: 'Revoir la section', href: 'https://example.com/poulpe#observer' }] },
  ], links: [{ id: 'l-0', label: 'Animaux marins', url: 'https://reference.org/animaux' }], notices: ['Présentation simplifiée.'], ai: { status: 'ready', landmarks: [{ blockId: 'b-1', label: 'Observer la nature' }] },
  anchors: { observer: 'b-1' },
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { aiEnabled: true, searchProvider: 'wikipedia', restrictedHosts: [] } }));
  await page.route('**/api/page', async route => {
    const input = route.request().postDataJSON();
    await route.fulfill({ json: { document: input.url.includes('reference.org') ? { ...doc, id: 'next', url: input.url, title: 'Les animaux marins' } : doc, proof: 'test-proof', expiresAt: Date.now() + 60_000 } });
  });
  await page.route('**/api/search', route => route.fulfill({ json: { provider: 'wikipedia', results: [{ title: doc.title, url: doc.url, description: 'Une page à explorer.' }] } }));
  await page.route('**/api/explain', route => route.fulfill({ json: { kind: 'ai', explanation: 'Les chromatophores sont de petites cellules qui contiennent des pigments.', caveat: 'Cette explication ne vérifie pas la page.', source: { url: doc.url, blockId: 'b-0', quote: doc.blocks[0]!.content.map(p => p.text).join('') } } }));
});

test('cherche, lit, comprend avec sa source, suit un lien et revient', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Une recherche ou une adresse Web' }).fill('poulpe');
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.getByRole('link', { name: /Les couleurs du poulpe/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.title);
  await page.getByRole('button', { name: 'Comprendre le passage 1' }).click();
  await expect(page.getByText('Les chromatophores sont de petites cellules qui contiennent des pigments.')).toBeVisible();
  await expect(page.getByText('Explication IA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revenir au passage' }).click();
  await expect(page.locator('#b-0')).toBeFocused();
  await page.getByRole('link', { name: 'animaux marins', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Les animaux marins');
  await page.getByRole('button', { name: 'Page précédente' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.title);
});

test('explorer est volontaire, fini et garde la provenance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill(doc.url);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.getByRole('button', { name: 'Explorer la suite' }).click();
  await expect(page.getByText('Liens présents dans cette page')).toBeVisible();
  await expect(page.getByRole('link', { name: /Animaux marins.*reference.org/ })).toHaveCount(1);
});

test('une référence interne rejoint la section sans recharger la page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill(doc.url);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.getByRole('link', { name: 'Revoir la section' }).click();
  await expect(page.locator('#b-1')).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.title);
});

test('une nouvelle sélection ne reçoit pas la réponse tardive du passage précédent', async ({ page }) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/explain', async route => {
    await gate;
    await route.fulfill({ json: { kind: 'ai', explanation: 'Réponse tardive à la première sélection.', caveat: '', source: { url: doc.url, blockId: 'b-0', quote: 'Le poulpe' } } }).catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('textbox').fill(doc.url);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.getByRole('button', { name: 'Comprendre le passage 1' }).click();
  await expect(page.getByText('Préparation de l’explication…')).toBeVisible();
  await page.locator('#b-2 p').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  release!();
  await expect(page.getByRole('button', { name: 'Expliquer ce passage', exact: true })).toBeVisible();
  await expect(page.getByText('Réponse tardive à la première sélection.')).toHaveCount(0);
});

test('annonce les échecs sans perdre la page courante', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').fill(doc.url);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.route('**/api/page', route => route.fulfill({ status: 422, json: { error: 'Cette page est incompatible.' } }));
  await page.getByRole('link', { name: 'animaux marins', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Cette page est incompatible.');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.title);
});

test('accueil et lecture accessibles, sans débordement horizontal', async ({ page }) => {
  await page.goto('/');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('textbox').fill(doc.url);
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.title);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Augmenter la taille du texte' }).click();
  await page.getByRole('button', { name: 'Examiner la page' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

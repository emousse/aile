export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('La connexion a été interrompue. Vérifie ton réseau puis réessaie.');
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Cette demande n’a pas abouti.');
  return data;
}

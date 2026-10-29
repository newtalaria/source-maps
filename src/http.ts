import { describeProblem, type HttpResult } from './problem.js';

export async function postJson(
  fetchImpl: typeof fetch,
  input: { url: string; key: string; body: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.key}`,
        Accept: 'application/problem+json, application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`POST ${pathOf(input.url)} failed: ${message}`);
  }
  const text = await response.text();
  const result: HttpResult = {
    status: response.status,
    body: text,
    requestId: response.headers.get('Request-Id'),
  };
  if (response.ok) {
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
  throw new Error(`POST ${pathOf(input.url)} failed: ${describeProblem(result)}`);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

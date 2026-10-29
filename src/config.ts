import path from 'node:path';
import { scrubSecrets } from './key.js';
import { assertReleaseName, resolveReleaseIdentity } from './release.js';

export { scrubSecrets };

export function resolveIngestUrl(input: {
  urlInput: string;
  envUrl: string | undefined;
  cell: string;
}): string {
  const explicit = input.urlInput.trim() || input.envUrl?.trim() || '';
  if (explicit) return explicit.replace(/\/+$/, '');
  if (input.cell === 'self') {
    throw new Error(
      'A self-hosted cell needs TALARIA_URL. The action cannot derive an ingest host for cell self.',
    );
  }
  return `https://ingest-${input.cell}.newtalaria.com`;
}

export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('API URL is not a valid URL');
  }
  if (parsed.username || parsed.password || /tal_(pk|sk|mon)_/i.test(url)) {
    throw new Error('API URL must not include credentials');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && local) return;
  throw new Error('API URL must use https');
}

export function resolveMapDirectory(workspace: string, inputPath: string): string {
  const requested = inputPath.trim();
  if (!requested) {
    throw new Error('Set source-maps to the directory of built source maps.');
  }
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('source-maps must stay inside the workspace');
  }
  return resolved;
}

export function resolveActionRelease(input: {
  release?: string;
  env: NodeJS.ProcessEnv;
}): string {
  const release =
    resolveReleaseIdentity({
      release: input.release,
      env: input.env,
    }).release?.trim() ?? '';
  if (!release) {
    throw new Error(
      'Could not resolve a Talaria release. Set release or TALARIA_RELEASE, or run on GitHub with GITHUB_REF_NAME and GITHUB_SHA.',
    );
  }
  assertReleaseName(release);
  return release;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;

export function resolveCommitSha(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = [
    ['TALARIA_COMMIT_SHA', env.TALARIA_COMMIT_SHA],
    ['NEXT_PUBLIC_TALARIA_COMMIT_SHA', env.NEXT_PUBLIC_TALARIA_COMMIT_SHA],
  ] as const;
  for (const [name, value] of explicit) {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) continue;
    if (!FULL_SHA.test(trimmed)) {
      throw new Error(`${name} must be a 40-character commit SHA.`);
    }
    return trimmed.toLowerCase();
  }
  for (const value of [env.GITHUB_SHA, env.CI_COMMIT_SHA]) {
    const trimmed = value?.trim() ?? '';
    if (FULL_SHA.test(trimmed)) return trimmed.toLowerCase();
  }
  return undefined;
}

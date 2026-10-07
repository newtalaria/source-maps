import path from 'node:path';
import { resolveReleaseIdentity } from './release.js';

export const DEFAULT_API_URL = 'https://ingest.newtalaria.com';

const KEY_IN_TEXT = /tal_live_[A-Za-z0-9_-]+/g;

export function scrubSecrets(line: string): string {
  return line.replace(KEY_IN_TEXT, 'tal_live_[redacted]');
}

export function resolveApiUrl(inputUrl: string, envUrl: string | undefined): string {
  const raw = inputUrl.trim() || envUrl?.trim() || DEFAULT_API_URL;
  return raw.replace(/\/+$/, '');
}

export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('API URL is not a valid URL');
  }
  if (parsed.username || parsed.password || /tal_live_/i.test(url)) {
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
    throw new Error('Set path to the directory of built source maps.');
  }
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('path must stay inside the workspace');
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
  if (release.length > 200) {
    throw new Error('Release must be 200 characters or fewer');
  }
  return release;
}

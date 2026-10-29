/**
 * Credential grammar from naming-audit §5.1.
 * Checksum: CRC32/IEEE over every character before it, base62 `0-9A-Za-z`, 6 chars, left-padded with `0`.
 */

export const API_KEY_PATTERN =
  /^tal_(pk|sk)_(prod|stg|test|dev)_([a-z][a-z0-9]*(?:-[a-z0-9]+)*)_([A-Za-z0-9]{43})([A-Za-z0-9]{6})$/;

export const MONITOR_TOKEN_PATTERN =
  /^tal_mon_([a-z][a-z0-9]*(?:-[a-z0-9]+)*)_([A-Za-z0-9]{43})([A-Za-z0-9]{6})$/;

export const REDACTION_PATTERN =
  /\btal_(?:(?:pk|sk)_(?:prod|stg|test|dev)|mon)_[a-z0-9-]{2,24}_[A-Za-z0-9]{49}\b/g;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export interface ReleaseKey {
  env: 'prod' | 'stg' | 'test' | 'dev';
  cell: string;
}

export function crc32ieee(value: string): number {
  const bytes = Buffer.from(value, 'utf8');
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeBase62(value: number): string {
  let n = value >>> 0;
  if (n === 0) return '000000';
  let out = '';
  while (n > 0) {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out.padStart(6, '0');
}

/** Checksum of every character before the 6-character suffix. */
export function keyChecksum(body: string): string {
  return encodeBase62(crc32ieee(body));
}

export function scrubSecrets(line: string): string {
  return line.replace(REDACTION_PATTERN, '[redacted]');
}

export function parseReleaseKey(raw: string): ReleaseKey {
  const key = raw.trim();
  if (!key) {
    throw new Error('Set TALARIA_RELEASE_KEY to a tal_sk_ key with releases:write.');
  }
  if (MONITOR_TOKEN_PATTERN.test(key)) {
    throw new Error(
      'TALARIA_RELEASE_KEY must be a tal_sk_ key. Monitor tokens cannot create releases.',
    );
  }
  const match = API_KEY_PATTERN.exec(key);
  if (!match) {
    throw new Error('TALARIA_RELEASE_KEY is not a valid tal_sk_ key.');
  }
  const klass = match[1];
  const env = match[2] as ReleaseKey['env'];
  const cell = match[3] ?? '';
  if (cell.length < 2 || cell.length > 24) {
    throw new Error('TALARIA_RELEASE_KEY is not a valid tal_sk_ key.');
  }
  if (klass === 'pk') {
    throw new Error(
      'TALARIA_RELEASE_KEY must be a tal_sk_ key. Publishable keys cannot create releases.',
    );
  }
  if (klass !== 'sk') {
    throw new Error('TALARIA_RELEASE_KEY is not a valid tal_sk_ key.');
  }
  const body = key.slice(0, -6);
  const checksum = key.slice(-6);
  if (keyChecksum(body) !== checksum) {
    throw new Error('TALARIA_RELEASE_KEY checksum is invalid.');
  }
  return { env, cell };
}

export function buildApiKey(input: {
  class: 'pk' | 'sk';
  env: 'prod' | 'stg' | 'test' | 'dev';
  cell: string;
  random?: string;
}): string {
  const random = input.random ?? 'A'.repeat(43);
  if (!/^[A-Za-z0-9]{43}$/.test(random)) {
    throw new Error('API key random body must be 43 base62 characters.');
  }
  const body = `tal_${input.class}_${input.env}_${input.cell}_${random}`;
  return body + keyChecksum(body);
}

export function buildMonitorToken(input: { cell: string; random?: string }): string {
  const random = input.random ?? 'B'.repeat(43);
  const body = `tal_mon_${input.cell}_${random}`;
  return body + keyChecksum(body);
}

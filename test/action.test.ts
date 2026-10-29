import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import {
  assertSafeUrl,
  resolveActionRelease,
  resolveIngestUrl,
} from '../src/config.js';
import {
  buildApiKey,
  buildMonitorToken,
  crc32ieee,
  encodeBase62,
  parseReleaseKey,
  scrubSecrets,
} from '../src/key.js';
import { describeProblem } from '../src/problem.js';
import { RELEASE_NAME } from '../src/release.js';
import { run, type ActionIo } from '../src/run.js';
import type { ReleaseCommit } from '../src/commits.js';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const PREV = '1234567890abcdef1234567890abcdef12345678';
const KEY = buildApiKey({ class: 'sk', env: 'prod', cell: 'nz1' });

function githubEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: SHA,
    GITHUB_REF_TYPE: 'branch',
    TALARIA_RELEASE_KEY: KEY,
    ...extra,
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'talaria-release-'));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'app.js'), 'console.log(1)\n');
  await writeFile(
    path.join(root, 'dist', 'app.js.map'),
    `${JSON.stringify({ version: 3, mappings: 'AAAA', sources: ['app.ts'] })}\n`,
  );
  return root;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function harness(options: {
  root: string;
  env?: NodeJS.ProcessEnv;
  inputs?: Record<string, string>;
  fetch?: typeof fetch;
  listCommits?: (input: { commitSha: string; previousCommitSha?: string }) => ReleaseCommit[];
}) {
  const inputs = options.inputs ?? {};
  const secrets: string[] = [];
  const outputs: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const io: ActionIo = {
    getInput: (name) => inputs[name] ?? '',
    setOutput: (name, value) => {
      outputs.push(`${name}=${value}`);
    },
    setSecret: (secret) => {
      secrets.push(secret);
    },
    setFailed: (message) => {
      failed.push(message);
    },
    info: (message) => {
      infos.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
    env: options.env ?? githubEnv(),
    workspace: options.root,
    fetch:
      options.fetch ??
      (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/v1/releases') {
          return jsonResponse(200, {
            release: 'main@abcdef0',
            commitCount: 0,
            previousReleaseCommitSha: null,
          });
        }
        if (pathname === '/v1/source-maps') {
          return jsonResponse(200, { id: 'map_1' });
        }
        return jsonResponse(404, {
          type: 'https://newtalaria.com/docs/reference/errors#not_found',
          title: 'Not found',
          status: 404,
          detail: `No route ${pathname}`,
          code: 'not_found',
          requestId: 'req_missing',
        });
      }),
    listCommits: options.listCommits,
  };
  return { io, secrets, outputs, failed, errors, infos, requests };
}

function bodyOf(request: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(request.init.body)) as Record<string, unknown>;
}

function header(request: { init: RequestInit }, name: string): string | undefined {
  const headers = request.init.headers as Record<string, string>;
  return headers[name];
}

describe('key grammar and checksum', () => {
  it('uses CRC32/IEEE and base62 0-9A-Za-z', () => {
    assert.equal(crc32ieee('123456789'), 0xcbf43926);
    assert.equal(encodeBase62(0), '000000');
    assert.equal(encodeBase62(10), '00000A');
    assert.equal(encodeBase62(36), '00000a');
    assert.equal(encodeBase62(62), '000010');
  });

  it('accepts an sk key and reads the cell', () => {
    assert.deepEqual(parseReleaseKey(KEY), { env: 'prod', cell: 'nz1' });
    const dedicated = buildApiKey({ class: 'sk', env: 'stg', cell: 'eu1-k7m2p9' });
    assert.deepEqual(parseReleaseKey(dedicated), { env: 'stg', cell: 'eu1-k7m2p9' });
  });

  it('refuses pk keys, monitor tokens, class-less keys, and a bad checksum', () => {
    const pk = buildApiKey({ class: 'pk', env: 'prod', cell: 'nz1' });
    assert.throws(() => parseReleaseKey(pk), /Publishable keys/);
    assert.throws(() => parseReleaseKey(buildMonitorToken({ cell: 'nz1' })), /Monitor tokens/);
    assert.throws(() => parseReleaseKey(`tal_prod_nz1_${'A'.repeat(49)}`), /not a valid tal_sk_ key/);
    const flipped = `${KEY.slice(0, -1)}${KEY.endsWith('0') ? '1' : '0'}`;
    assert.throws(() => parseReleaseKey(flipped), /checksum is invalid/);
    assert.throws(
      () => parseReleaseKey(buildApiKey({ class: 'sk', env: 'prod', cell: 'a' })),
      /not a valid tal_sk_ key/,
    );
    assert.throws(
      () => parseReleaseKey(buildApiKey({ class: 'sk', env: 'prod', cell: `a${'b'.repeat(24)}` })),
      /not a valid tal_sk_ key/,
    );
  });

  it('scrubs sk, pk, and mon secrets and leaves class-less text', () => {
    const pk = buildApiKey({ class: 'pk', env: 'dev', cell: 'nz1' });
    const mon = buildMonitorToken({ cell: 'nz1' });
    const line = scrubSecrets(`failed ${KEY} ${pk} ${mon}`);
    assert.equal(line.includes(KEY), false);
    assert.equal(line.includes(pk), false);
    assert.equal(line.includes(mon), false);
    assert.equal(line, 'failed [redacted] [redacted] [redacted]');
    const classLess = `tal_prod_nz1_${'A'.repeat(49)}`;
    assert.equal(scrubSecrets(classLess), classLess);
  });
});

describe('release name and ingest URL', () => {
  it('derives branch@shortSha and maps / to -', () => {
    assert.equal(
      resolveActionRelease({
        env: { GITHUB_REF_NAME: 'feature/x', GITHUB_SHA: SHA },
      }),
      'feature-x@abcdef0',
    );
    assert.equal(RELEASE_NAME.test('feature-x@abcdef0'), true);
  });

  it('keeps an explicit release and rejects a slash in it', () => {
    assert.equal(
      resolveActionRelease({
        release: '2.0.0+build',
        env: githubEnv({ TALARIA_RELEASE: '1.4.2' }),
      }),
      '2.0.0+build',
    );
    assert.throws(
      () =>
        resolveActionRelease({
          release: 'feature/x@abcdef0',
          env: githubEnv(),
        }),
      /does not match/,
    );
  });

  it('prefers TALARIA_RELEASE over GitHub and fails closed without a release', () => {
    assert.equal(
      resolveActionRelease({
        env: githubEnv({ TALARIA_RELEASE: '1.4.2' }),
      }),
      '1.4.2',
    );
    assert.throws(
      () => resolveActionRelease({ env: { TALARIA_COMMIT_SHA: SHA } }),
      /Could not resolve a Talaria release/,
    );
  });

  it('derives the cell host unless TALARIA_URL or url is set', () => {
    assert.equal(
      resolveIngestUrl({ urlInput: '', envUrl: undefined, cell: 'nz1' }),
      'https://ingest-nz1.newtalaria.com',
    );
    assert.equal(
      resolveIngestUrl({ urlInput: '', envUrl: 'https://example.test/', cell: 'nz1' }),
      'https://example.test',
    );
    assert.equal(
      resolveIngestUrl({
        urlInput: 'https://custom.test',
        envUrl: 'https://example.test',
        cell: 'nz1',
      }),
      'https://custom.test',
    );
    assert.throws(
      () => resolveIngestUrl({ urlInput: '', envUrl: undefined, cell: 'self' }),
      /self-hosted cell needs TALARIA_URL/,
    );
  });

  it('rejects credentials and non-https URLs', () => {
    assert.doesNotThrow(() => assertSafeUrl('https://ingest-nz1.newtalaria.com'));
    assert.doesNotThrow(() => assertSafeUrl('http://localhost:8080'));
    assert.doesNotThrow(() => assertSafeUrl('http://127.0.0.1:8080'));
    assert.throws(() => assertSafeUrl('http://evil.example'), /API URL must use https/);
    assert.throws(
      () => assertSafeUrl('https://user:secret@ingest-nz1.newtalaria.com'),
      /must not include credentials/,
    );
    assert.throws(
      () => assertSafeUrl(`https://ingest-nz1.newtalaria.com/?key=${KEY}`),
      /must not include credentials/,
    );
  });
});

describe('problem+json', () => {
  it('formats code, detail, request id, cell, and url', () => {
    const message = describeProblem({
      status: 421,
      requestId: null,
      body: JSON.stringify({
        type: 'https://newtalaria.com/docs/reference/errors#wrong_cell',
        title: 'Wrong cell',
        status: 421,
        detail: 'Send this key to its cell',
        code: 'wrong_cell',
        requestId: 'req_abc',
        cell: 'eu1',
        url: 'https://ingest-eu1.newtalaria.com',
      }),
    });
    assert.match(message, /HTTP 421 wrong_cell/);
    assert.match(message, /Send this key to its cell/);
    assert.match(message, /cell eu1/);
    assert.match(message, /https:\/\/ingest-eu1\.newtalaria\.com/);
    assert.match(message, /requestId req_abc/);
  });
});

describe('release action', () => {
  it('posts the release to the derived cell host with a bearer sk key', async () => {
    const root = await workspace();
    const { io, secrets, outputs, failed, requests } = harness({ root });
    await run(io);
    assert.deepEqual(failed, []);
    assert.deepEqual(secrets, [KEY]);
    assert.deepEqual(outputs, [`release=main@abcdef0`, `commit-sha=${SHA}`]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, 'https://ingest-nz1.newtalaria.com/v1/releases');
    assert.equal(header(requests[0]!, 'Authorization'), `Bearer ${KEY}`);
    assert.equal(header(requests[0]!, 'X-API-Key'), undefined);
    assert.deepEqual(bodyOf(requests[0]!), {
      release: 'main@abcdef0',
      commitSha: SHA,
    });
  });

  it('uses TALARIA_URL and ignores TALARIA_BASE_URL', async () => {
    const root = await workspace();
    const { io, requests, failed } = harness({
      root,
      env: githubEnv({
        TALARIA_URL: 'https://override.example/',
        TALARIA_BASE_URL: 'https://old.example',
        TALARIA_API_KEY: buildApiKey({ class: 'pk', env: 'prod', cell: 'eu1' }),
      }),
    });
    await run(io);
    assert.deepEqual(failed, []);
    assert.equal(requests[0]!.url, 'https://override.example/v1/releases');
    assert.equal(header(requests[0]!, 'Authorization'), `Bearer ${KEY}`);
  });

  it('posts source maps as plain JSON and ignores the old sourcemaps input', async () => {
    const root = await workspace();
    const ignored = harness({
      root,
      inputs: { sourcemaps: 'dist' },
    });
    await run(ignored.io);
    assert.equal(
      ignored.requests.some((request) => request.url.endsWith('/v1/source-maps')),
      false,
    );

    const { io, failed, requests } = harness({
      root,
      inputs: { 'source-maps': 'dist' },
    });
    await run(io);
    assert.deepEqual(failed, []);
    const upload = requests.find((request) => request.url.endsWith('/v1/source-maps'));
    assert.ok(upload);
    assert.equal(upload.url, 'https://ingest-nz1.newtalaria.com/v1/source-maps');
    const payload = bodyOf(upload);
    assert.equal(payload.release, 'main@abcdef0');
    assert.equal(payload.fileName, 'app.js');
    assert.equal(typeof payload.debugId, 'string');
    assert.equal('__className__' in payload, false);
    assert.equal('input' in payload, false);
    const map = JSON.parse(gunzipSync(Buffer.from(String(payload.gzipBytes), 'base64')).toString('utf8')) as {
      mappings: string;
      debugId: string;
    };
    assert.equal(map.mappings, 'AAAA');
    assert.equal(map.debugId, payload.debugId);
    assert.equal(String(payload.gzipBytes).includes('decode('), false);
  });

  it('shifts Silverstripe combine-files mappings by one line', async () => {
    const root = await workspace();
    const { io, failed, requests } = harness({
      root,
      inputs: { 'source-maps': 'dist', 'silverstripe-combine-files': 'true' },
    });
    await run(io);
    assert.deepEqual(failed, []);
    const upload = requests.find((request) => request.url.endsWith('/v1/source-maps'));
    const payload = bodyOf(upload!);
    const map = JSON.parse(gunzipSync(Buffer.from(String(payload.gzipBytes), 'base64')).toString('utf8')) as {
      mappings: string;
    };
    assert.equal(map.mappings, ';AAAA');
  });

  it('sends previous..HEAD when set-commits is auto', async () => {
    const root = await workspace();
    const head: ReleaseCommit = {
      id: SHA,
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: '2026-10-29T00:00:00Z',
      message: 'head',
    };
    const older: ReleaseCommit = {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      timestamp: '2026-10-28T00:00:00Z',
      message: 'older',
    };
    let releaseCalls = 0;
    const { io, failed, requests, infos } = harness({
      root,
      inputs: { 'set-commits': 'auto' },
      listCommits: ({ previousCommitSha }) => (previousCommitSha ? [older, head] : [head]),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        releaseCalls += 1;
        return jsonResponse(200, {
          release: 'main@abcdef0',
          commitCount: releaseCalls === 1 ? 1 : 2,
          previousReleaseCommitSha: releaseCalls === 1 ? PREV : null,
        });
      },
    });
    await run(io);
    assert.deepEqual(failed, []);
    const posts = requests.filter((request) => request.url.endsWith('/v1/releases'));
    assert.equal(posts.length, 2);
    assert.deepEqual(bodyOf(posts[0]!).commits, [head]);
    assert.deepEqual(bodyOf(posts[1]!).commits, [older, head]);
    assert.equal(
      requests.some((request) => request.url.endsWith('/v1/deploys')),
      false,
    );
    assert.ok(infos.some((line) => line.includes('2 commits') && line.includes(PREV.slice(0, 7))));
  });

  it('reads commits from git for set-commits auto', async () => {
    const root = await workspace();
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'ada@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Ada'], { cwd: root });
    execFileSync('git', ['add', 'dist'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'first release'], { cwd: root });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const { io, failed, requests } = harness({
      root,
      env: githubEnv({ GITHUB_SHA: head }),
      inputs: { 'set-commits': 'auto' },
    });
    await run(io);
    assert.deepEqual(failed, []);
    const posts = requests.filter((request) => request.url.endsWith('/v1/releases'));
    assert.equal(posts.length, 1);
    const commits = bodyOf(posts[0]!).commits as ReleaseCommit[];
    assert.equal(commits[0]?.id, head);
    assert.equal(commits[0]?.message, 'first release');
    assert.equal(commits[0]?.authorName, 'Ada');
  });

  it('does not call /v1/deploys when deploy is true', async () => {
    const root = await workspace();
    const { io, failed, requests, infos } = harness({
      root,
      inputs: { deploy: 'true' },
    });
    await run(io);
    assert.deepEqual(failed, []);
    assert.equal(
      requests.some((request) => request.url.includes('/v1/deploys')),
      false,
    );
    assert.ok(infos.some((line) => line.includes('501')));
  });

  it('parses a problem+json error and does not echo the key', async () => {
    const root = await workspace();
    const { io, failed, outputs } = harness({
      root,
      fetch: async () =>
        jsonResponse(
          401,
          {
            type: 'https://newtalaria.com/docs/reference/errors#invalid_key',
            title: 'Invalid key',
            status: 401,
            detail: `Rejected ${KEY}`,
            code: 'invalid_key',
            requestId: 'req_auth',
          },
          { 'Content-Type': 'application/problem+json', 'Request-Id': 'req_auth' },
        ),
    });
    await run(io);
    assert.equal(failed.length, 1);
    assert.match(failed[0]!, /POST \/v1\/releases failed: HTTP 401 invalid_key/);
    assert.match(failed[0]!, /requestId req_auth/);
    assert.equal(failed[0]!.includes(KEY), false);
    assert.match(failed[0]!, /\[redacted\]/);
    assert.ok(outputs.includes('release=main@abcdef0'));
  });

  it('fails a 501 from /v1/releases instead of skipping it', async () => {
    const root = await workspace();
    const { io, failed } = harness({
      root,
      fetch: async () =>
        jsonResponse(501, {
          title: 'Not implemented',
          status: 501,
          detail: 'releases are off',
          code: 'not_implemented',
        }),
    });
    await run(io);
    assert.match(failed[0]!, /HTTP 501 not_implemented/);
  });

  it('refuses a pk key and a self cell before any request', async () => {
    const root = await workspace();
    const pk = harness({
      root,
      env: githubEnv({
        TALARIA_RELEASE_KEY: buildApiKey({ class: 'pk', env: 'prod', cell: 'nz1' }),
      }),
    });
    await run(pk.io);
    assert.equal(pk.requests.length, 0);
    assert.match(pk.failed[0]!, /Publishable keys/);

    const selfHosted = harness({
      root,
      env: githubEnv({
        TALARIA_RELEASE_KEY: buildApiKey({ class: 'sk', env: 'dev', cell: 'self' }),
      }),
    });
    await run(selfHosted.io);
    assert.equal(selfHosted.requests.length, 0);
    assert.match(selfHosted.failed[0]!, /TALARIA_URL/);
  });

  it('does not post when the key or the release is missing', async () => {
    const root = await workspace();
    const missingKey = harness({
      root,
      env: { GITHUB_REF_NAME: 'main', GITHUB_SHA: SHA },
    });
    await run(missingKey.io);
    assert.equal(missingKey.requests.length, 0);
    assert.match(missingKey.failed[0]!, /TALARIA_RELEASE_KEY/);

    const missingRelease = harness({
      root,
      env: { TALARIA_RELEASE_KEY: KEY },
    });
    await run(missingRelease.io);
    assert.equal(missingRelease.requests.length, 0);
    assert.equal(missingRelease.outputs.length, 0);
  });

  it('rejects a source-maps path outside the workspace and a non-https URL', async () => {
    const root = await workspace();
    const escaped = harness({
      root,
      inputs: { 'source-maps': '../outside' },
    });
    await run(escaped.io);
    assert.equal(escaped.requests.length, 0);
    assert.match(escaped.failed[0]!, /inside the workspace/);

    const http = harness({
      root,
      inputs: { url: 'http://evil.example' },
    });
    await run(http.io);
    assert.equal(http.requests.length, 0);
    assert.match(http.failed[0]!, /https/);
  });

  it('rejects set-commits values other than auto', async () => {
    const root = await workspace();
    const { io, failed, requests } = harness({
      root,
      inputs: { 'set-commits': 'yes' },
    });
    await run(io);
    assert.equal(requests.length, 0);
    assert.match(failed[0]!, /set-commits must be 'auto'/);
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { UploadSourceMapsOptions } from '@newtalaria/cli';
import {
  assertSafeUrl,
  resolveActionRelease,
  resolveApiUrl,
  scrubSecrets,
} from '../src/config.js';
import { run, type ActionIo } from '../src/run.js';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const KEY = 'tal_live_supersecretkey';

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
  const root = await mkdtemp(path.join(tmpdir(), 'talaria-action-'));
  await mkdir(path.join(root, 'source-maps'));
  return root;
}

function harness(options: {
  root: string;
  env?: NodeJS.ProcessEnv;
  inputs?: Record<string, string>;
  upload?: (options: UploadSourceMapsOptions) => Promise<number>;
}) {
  const inputs = options.inputs ?? { path: 'source-maps' };
  const secrets: string[] = [];
  const outputs: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const uploads: UploadSourceMapsOptions[] = [];
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
    upload: async (uploadOptions) => {
      uploads.push(uploadOptions);
      if (options.upload) return options.upload(uploadOptions);
      return 0;
    },
  };
  return { io, secrets, outputs, failed, errors, infos, uploads };
}

describe('release and url', () => {
  it('derives branch@shortSha from GitHub', () => {
    assert.equal(
      resolveActionRelease({
        env: { GITHUB_REF_NAME: 'main', GITHUB_SHA: SHA },
      }),
      'main@abcdef0',
    );
  });

  it('prefers an explicit release over TALARIA_RELEASE and GitHub', () => {
    assert.equal(
      resolveActionRelease({
        release: '2.0.0',
        env: githubEnv({ TALARIA_RELEASE: '1.4.2' }),
      }),
      '2.0.0',
    );
  });

  it('prefers TALARIA_RELEASE over GitHub', () => {
    assert.equal(
      resolveActionRelease({
        env: githubEnv({ TALARIA_RELEASE: '1.4.2' }),
      }),
      '1.4.2',
    );
  });

  it('fails closed when GitHub cannot supply a release', () => {
    assert.throws(
      () => resolveActionRelease({ env: { TALARIA_COMMIT_SHA: SHA } }),
      /Could not resolve a Talaria release/,
    );
  });

  it('defaults the API URL to the hosted ingest host', () => {
    assert.equal(resolveApiUrl('', undefined), 'https://ingest.newtalaria.com');
    assert.equal(
      resolveApiUrl('', 'https://example.test/'),
      'https://example.test',
    );
    assert.equal(
      resolveApiUrl('https://custom.test', 'https://example.test'),
      'https://custom.test',
    );
  });

  it('rejects credentials and non-https URLs', () => {
    assert.doesNotThrow(() => assertSafeUrl('https://ingest.newtalaria.com'));
    assert.doesNotThrow(() => assertSafeUrl('http://localhost:8080'));
    assert.doesNotThrow(() => assertSafeUrl('http://127.0.0.1:8080'));
    assert.throws(
      () => assertSafeUrl('http://evil.example'),
      /API URL must use https/,
    );
    assert.throws(
      () => assertSafeUrl('https://user:secret@ingest.newtalaria.com'),
      /must not include credentials/,
    );
    assert.throws(
      () => assertSafeUrl(`https://ingest.newtalaria.com/?key=${KEY}`),
      /must not include credentials/,
    );
  });

  it('scrubs API keys from text', () => {
    const line = scrubSecrets(`upload failed for ${KEY} and tal_live_other-key`);
    assert.equal(line.includes(KEY), false);
    assert.equal(line.includes('other-key'), false);
    assert.match(line, /tal_live_\[redacted\]/);
  });
});

describe('upload action', () => {
  it('uploads with the derived release and sets the output', async () => {
    const root = await workspace();
    const { io, secrets, outputs, failed, uploads } = harness({ root });
    await run(io);
    assert.deepEqual(failed, []);
    assert.deepEqual(secrets, [KEY]);
    assert.deepEqual(outputs, ['release=main@abcdef0']);
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0]!.argv, [
      'sourcemaps',
      'upload',
      path.join(root, 'source-maps'),
      '--release',
      'main@abcdef0',
      '--url',
      'https://ingest.newtalaria.com',
    ]);
    assert.equal(uploads[0]!.env.TALARIA_RELEASE_KEY, KEY);
    assert.equal(uploads[0]!.env.TALARIA_API_KEY, undefined);
  });

  it('passes an explicit release and drops TALARIA_API_KEY', async () => {
    const root = await workspace();
    const { io, outputs, uploads } = harness({
      root,
      inputs: { path: 'source-maps', release: '9.9.9' },
      env: githubEnv({ TALARIA_API_KEY: 'tal_live_ingestkeyvalue' }),
    });
    await run(io);
    assert.deepEqual(outputs, ['release=9.9.9']);
    assert.equal(uploads[0]!.argv.includes('--api-key'), false);
    assert.ok(uploads[0]!.argv.includes('9.9.9'));
    assert.equal(uploads[0]!.env.TALARIA_API_KEY, undefined);
    assert.equal(
      JSON.stringify(uploads[0]).includes('tal_live_ingestkeyvalue'),
      false,
    );
  });

  it('does not upload when the key is missing', async () => {
    const root = await workspace();
    const { io, failed, uploads } = harness({
      root,
      env: { GITHUB_REF_NAME: 'main', GITHUB_SHA: SHA },
    });
    await run(io);
    assert.equal(uploads.length, 0);
    assert.equal(failed.length, 1);
    assert.match(failed[0]!, /TALARIA_RELEASE_KEY/);
    assert.equal(failed[0]!.includes('local'), false);
  });

  it('does not upload or fall back to local when the release is missing', async () => {
    const root = await workspace();
    const { io, failed, uploads, outputs } = harness({
      root,
      env: { TALARIA_RELEASE_KEY: KEY },
    });
    await run(io);
    assert.equal(uploads.length, 0);
    assert.deepEqual(outputs, []);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.includes('local'), false);
  });

  it('rejects a path that escapes the workspace', async () => {
    const root = await workspace();
    const { io, failed, uploads } = harness({
      root,
      inputs: { path: '../outside' },
    });
    await run(io);
    assert.equal(uploads.length, 0);
    assert.match(failed[0]!, /inside the workspace/);
  });

  it('rejects a non-https API URL before upload', async () => {
    const root = await workspace();
    const { io, failed, uploads } = harness({
      root,
      inputs: { path: 'source-maps', url: 'http://evil.example' },
    });
    await run(io);
    assert.equal(uploads.length, 0);
    assert.match(failed[0]!, /https/);
  });

  it('scrubs a key from a thrown upload error and from CLI logs', async () => {
    const root = await workspace();
    const thrown = harness({
      root,
      upload: async () => {
        throw new Error(`Talaria rejected ${KEY}`);
      },
    });
    await run(thrown.io);
    assert.equal(thrown.failed.length, 1);
    assert.equal(thrown.failed[0]!.includes(KEY), false);
    assert.match(thrown.failed[0]!, /tal_live_\[redacted\]/);
    assert.deepEqual(thrown.outputs, ['release=main@abcdef0']);

    const logged = harness({
      root,
      upload: async (options) => {
        options.error?.(`main.js: ${KEY}`);
        return 1;
      },
    });
    await run(logged.io);
    assert.equal(logged.errors.join('\n').includes(KEY), false);
    assert.match(logged.errors.join('\n'), /tal_live_\[redacted\]/);
    assert.deepEqual(logged.failed, ['Source map upload failed']);
  });

  it('passes Silverstripe combine mode through to the CLI', async () => {
    const root = await workspace();
    const { io, failed, uploads } = harness({
      root,
      inputs: { path: 'source-maps', 'silverstripe-combine-files': 'true' },
    });
    await run(io);
    assert.deepEqual(failed, []);
    assert.equal(uploads[0]!.argv.at(-1), '--silverstripe-combine-files');
  });

  it('fails the step when the CLI exits non-zero', async () => {
    const root = await workspace();
    const { io, failed, outputs } = harness({
      root,
      upload: async () => 1,
    });
    await run(io);
    assert.deepEqual(outputs, ['release=main@abcdef0']);
    assert.deepEqual(failed, ['Source map upload failed']);
  });
});

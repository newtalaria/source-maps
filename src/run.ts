import { stat } from 'node:fs/promises';
import { listCommitsWithGit, type ReleaseCommit } from './commits.js';
import {
  assertSafeUrl,
  resolveActionRelease,
  resolveCommitSha,
  resolveIngestUrl,
  resolveMapDirectory,
  scrubSecrets,
} from './config.js';
import { postJson } from './http.js';
import { parseReleaseKey } from './key.js';
import { prepareSourceMaps } from './source-maps.js';

const FULL_SHA = /^[0-9a-f]{40}$/i;

export interface ActionIo {
  getInput: (name: string) => string;
  setOutput: (name: string, value: string) => void;
  setSecret: (secret: string) => void;
  setFailed: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
  env: NodeJS.ProcessEnv;
  workspace: string;
  fetch?: typeof fetch;
  listCommits?: (input: { commitSha: string; previousCommitSha?: string }) => ReleaseCommit[];
}

export async function run(io: ActionIo): Promise<void> {
  const info = (line: string) => io.info(scrubSecrets(line));
  const fetchImpl = io.fetch ?? globalThis.fetch;
  try {
    const key = io.env.TALARIA_RELEASE_KEY?.trim() ?? '';
    if (key) io.setSecret(key);
    const parsedKey = parseReleaseKey(key);
    const release = resolveActionRelease({
      release: io.getInput('release'),
      env: io.env,
    });
    const url = resolveIngestUrl({
      urlInput: io.getInput('url'),
      envUrl: io.env.TALARIA_URL,
      cell: parsedKey.cell,
    });
    assertSafeUrl(url);

    const sourceMapsInput = io.getInput('source-maps').trim();
    const setCommits = io.getInput('set-commits').trim().toLowerCase();
    const deploy = io.getInput('deploy').trim().toLowerCase() === 'true';
    if (setCommits && setCommits !== 'auto' && setCommits !== 'false') {
      throw new Error("set-commits must be 'auto' when it is set.");
    }
    const commitsAuto = setCommits === 'auto';
    const commitSha = resolveCommitSha(io.env);
    io.setOutput('release', release);
    if (commitSha) io.setOutput('commit-sha', commitSha);

    let payloads: Awaited<ReturnType<typeof prepareSourceMaps>> | undefined;
    if (sourceMapsInput) {
      const directory = resolveMapDirectory(io.workspace, sourceMapsInput);
      const infoStat = await stat(directory).catch(() => undefined);
      if (!infoStat?.isDirectory()) {
        throw new Error('source-maps is not a directory of built source maps');
      }
      payloads = await prepareSourceMaps({
        directory,
        release,
        silverstripeCombineFiles:
          io.getInput('silverstripe-combine-files').trim().toLowerCase() === 'true',
      });
    }

    info(`release ${release} -> ${url}`);

    await createRelease({
      fetchImpl,
      url,
      key,
      release,
      commitSha,
      commitsAuto,
      listCommits:
        io.listCommits ??
        ((input) => listCommitsWithGit(io.workspace, input)),
      info,
    });

    if (payloads) {
      for (const payload of payloads) {
        info(payload.fileName);
        await postJson(fetchImpl, {
          url: `${url}/v1/source-maps`,
          key,
          body: payload,
        });
      }
    }

    if (deploy) {
      info('Deploy skipped: POST /v1/deploys returns 501 not_implemented.');
    }
  } catch (err) {
    io.setFailed(scrubSecrets(err instanceof Error ? err.message : String(err)));
  }
}

async function createRelease(input: {
  fetchImpl: typeof fetch;
  url: string;
  key: string;
  release: string;
  commitSha: string | undefined;
  commitsAuto: boolean;
  listCommits: (range: { commitSha: string; previousCommitSha?: string }) => ReleaseCommit[];
  info: (line: string) => void;
}): Promise<void> {
  const base = {
    release: input.release,
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
  };
  if (!input.commitsAuto) {
    await postJson(input.fetchImpl, {
      url: `${input.url}/v1/releases`,
      key: input.key,
      body: base,
    });
    input.info('release created');
    return;
  }
  if (!input.commitSha) {
    throw new Error(
      'set-commits: auto needs a 40-character commit SHA in GITHUB_SHA or TALARIA_COMMIT_SHA.',
    );
  }
  const head = input
    .listCommits({ commitSha: input.commitSha })
    .filter((commit) => commit.id.toLowerCase() === input.commitSha)
    .slice(0, 1);
  let response = await postJson(input.fetchImpl, {
    url: `${input.url}/v1/releases`,
    key: input.key,
    body: head.length ? { ...base, commits: head } : base,
  });
  const previous = previousSha(response);
  let sent = head;
  if (previous && previous !== input.commitSha) {
    const range = input
      .listCommits({ commitSha: input.commitSha, previousCommitSha: previous })
      .slice(0, 250);
    if (range.length) {
      sent = range;
      response = await postJson(input.fetchImpl, {
        url: `${input.url}/v1/releases`,
        key: input.key,
        body: { ...base, commits: range },
      });
    }
  }
  if (sent.length === 0) {
    throw new Error('set-commits: auto could not read commits from git.');
  }
  const count = commitCount(response) ?? sent.length;
  input.info(
    `release created with ${count} commit${count === 1 ? '' : 's'}${
      previous ? ` since ${previous.slice(0, 7)}` : ''
    }`,
  );
}

function previousSha(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const value = record.previousReleaseCommitSha ?? record.previousCommitSha;
  if (typeof value !== 'string' || !FULL_SHA.test(value.trim())) return undefined;
  return value.trim().toLowerCase();
}

function commitCount(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>).commitCount;
  return typeof value === 'number' ? value : undefined;
}

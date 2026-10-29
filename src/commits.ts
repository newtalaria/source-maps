import { execFileSync } from 'node:child_process';

export interface ReleaseCommit {
  id: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
  message: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_COMMITS = 250;

export function listCommitsWithGit(
  workspace: string,
  input: { commitSha: string; previousCommitSha?: string },
): ReleaseCommit[] {
  const limit = MAX_COMMITS;
  const range =
    input.previousCommitSha && FULL_SHA.test(input.previousCommitSha)
      ? `${input.previousCommitSha}..${input.commitSha}`
      : input.commitSha;
  const format = '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e';
  let out = git(workspace, ['log', `--max-count=${limit}`, format, range]);
  if (out === undefined && range !== input.commitSha) {
    out = git(workspace, ['log', `--max-count=${limit}`, format, input.commitSha]);
  }
  if (!out) return [];
  return out
    .split('\x1e')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [id = '', authorName = '', authorEmail = '', timestamp = '', message = ''] =
        row.split('\x1f');
      return { id, authorName, authorEmail, timestamp, message };
    })
    .filter((commit) => FULL_SHA.test(commit.id))
    .slice(0, MAX_COMMITS);
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return (
      execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

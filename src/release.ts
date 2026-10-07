/**
 * Same rules as `@newtalaria/core` `resolveReleaseIdentity`.
 * `@newtalaria/core@0.5.4` does not export that function, and the published
 * CLI reads `--release` or `TALARIA_RELEASE` only. This action resolves the
 * release and passes `--release`, so the CLI does not substitute `local`.
 */

export interface ReleaseEnv {
  TALARIA_RELEASE?: string;
  TALARIA_COMMIT_SHA?: string;
  NEXT_PUBLIC_TALARIA_RELEASE?: string;
  NEXT_PUBLIC_TALARIA_COMMIT_SHA?: string;
  GITHUB_REF_NAME?: string;
  GITHUB_SHA?: string;
  GITHUB_REF_TYPE?: string;
  CI_COMMIT_REF_NAME?: string;
  CI_COMMIT_SHA?: string;
  CI_COMMIT_TAG?: string;
}

export function resolveReleaseIdentity(input: {
  release?: string;
  commitSha?: string;
  env?: ReleaseEnv;
}): { release?: string } {
  const env = input.env ?? {};
  const explicitRelease =
    nonEmpty(input.release) ??
    nonEmpty(env.TALARIA_RELEASE) ??
    nonEmpty(env.NEXT_PUBLIC_TALARIA_RELEASE);
  const explicitSha =
    nonEmpty(input.commitSha) ??
    nonEmpty(env.TALARIA_COMMIT_SHA) ??
    nonEmpty(env.NEXT_PUBLIC_TALARIA_COMMIT_SHA);

  if (explicitRelease || explicitSha) {
    return { release: explicitRelease };
  }

  return { release: fromCi(env) };
}

function fromCi(env: ReleaseEnv): string | undefined {
  const githubRef = nonEmpty(env.GITHUB_REF_NAME);
  const githubSha = nonEmpty(env.GITHUB_SHA);
  if (githubRef && githubSha && githubSha.length >= 7) {
    return `${githubRef}@${githubSha.slice(0, 7)}`;
  }

  const gitlabRef = nonEmpty(env.CI_COMMIT_REF_NAME);
  const gitlabSha = nonEmpty(env.CI_COMMIT_SHA);
  if (gitlabRef && gitlabSha && gitlabSha.length >= 7) {
    return `${gitlabRef}@${gitlabSha.slice(0, 7)}`;
  }

  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

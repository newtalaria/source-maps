/**
 * Release identity for the action.
 * The default CI string is `<ref>@<sha7>` with `/` in the ref replaced by `-`
 * (naming-audit M11). An explicit release is not rewritten.
 */

export const RELEASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,199}$/;

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

export function assertReleaseName(release: string): void {
  if (!RELEASE_NAME.test(release)) {
    throw new Error(
      `Release "${release}" does not match ${RELEASE_NAME}. The default ref replaces / with -.`,
    );
  }
}

function fromCi(env: ReleaseEnv): string | undefined {
  const githubRef = nonEmpty(env.GITHUB_REF_NAME);
  const githubSha = nonEmpty(env.GITHUB_SHA);
  if (githubRef && githubSha && githubSha.length >= 7) {
    return `${sanitizeRef(githubRef)}@${githubSha.slice(0, 7)}`;
  }

  const gitlabRef = nonEmpty(env.CI_COMMIT_REF_NAME);
  const gitlabSha = nonEmpty(env.CI_COMMIT_SHA);
  if (gitlabRef && gitlabSha && gitlabSha.length >= 7) {
    return `${sanitizeRef(gitlabRef)}@${gitlabSha.slice(0, 7)}`;
  }

  return undefined;
}

function sanitizeRef(ref: string): string {
  return ref.replaceAll('/', '-');
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

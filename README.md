# Talaria release

Creates a Talaria release with commits and source maps for GitHub Actions workflows.

This action handles release creation, commit association, and source map uploads per the Talaria Integration Standard (TIS v0.2). It wraps `@newtalaria/cli` commands for `sourcemaps upload` and `releases create`.

The release string matches the one your app sends at runtime. On GitHub Actions, that string is `GITHUB_REF_NAME` plus `@` plus the first 7 characters of `GITHUB_SHA`, unless you set `release` or `TALARIA_RELEASE`. The same value is the `release` output.

## Usage

### Source maps only

```yaml
- uses: newtalaria/release@v1
  id: release
  with:
    sourcemaps: dist
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

### Release with commits

```yaml
- uses: newtalaria/release@v1
  with:
    set-commits: auto
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

### Source maps and commits

```yaml
- uses: newtalaria/release@v1
  with:
    sourcemaps: dist
    set-commits: auto
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

`TALARIA_RELEASE_KEY` is an API key with `releases:write` scope. Put it in the environment as a repository secret. The action reads that variable and does not take the key as an input, so the value is not stored with the step inputs.

## Sharing the release with your build

To ensure your app and Talaria use the same release string, set it before both the build and this action:

```yaml
- name: Release identity
  run: |
    echo "TALARIA_RELEASE=${GITHUB_REF_NAME}@${GITHUB_SHA::7}" >> "$GITHUB_ENV"

- name: Build
  run: NEXT_PUBLIC_TALARIA_RELEASE="$TALARIA_RELEASE" npm run build

- uses: newtalaria/release@v1
  with:
    sourcemaps: dist
    set-commits: auto
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

`TALARIA_RELEASE` takes precedence over the GitHub ref, so both use one string.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `sourcemaps` | no | | Directory of built `*.js.map` files, relative to the workspace. When omitted, no source maps are uploaded. |
| `set-commits` | no | | Set to `auto` to associate commits with the release. When omitted, no commits are set. |
| `url` | no | `https://ingest.newtalaria.com` | Talaria API base URL. `TALARIA_URL` is used when this input is omitted and the env var is set. |
| `release` | no | `TALARIA_RELEASE`, then `NEXT_PUBLIC_TALARIA_RELEASE`, then `GITHUB_REF_NAME@<shortsha>` | Release string. |
| `silverstripe-combine-files` | no | `false` | Set to `true` when the uploaded script is the first file in Silverstripe `Requirements::combine_files`. The map's generated lines shift by one for the header. |

`http://localhost` and `http://127.0.0.1` are accepted for a local API. Any other URL must be `https`.

## Outputs

| Name | Description |
| --- | --- |
| `release` | Release string used |
| `commit-sha` | Full commit SHA for the release |

## When the step fails

The step fails when:
- The `TALARIA_RELEASE_KEY` is missing or invalid
- The release cannot be resolved
- `sourcemaps` is provided but is not a directory inside the workspace
- The API URL is not allowed
- Any file fails to upload (maps stored before a failure remain stored)

The action does not retry, and it does not print the API key.

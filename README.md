# Talaria release

Creates a Talaria release from GitHub Actions, associates commits, and uploads JavaScript source maps.

The action calls the ingest API directly:

- `POST /v1/releases` with `Authorization: Bearer` and `TALARIA_RELEASE_KEY`
- `POST /v1/source-maps` for each built `*.js.map`, when `source-maps` is set

`TALARIA_RELEASE_KEY` must be a secret `tal_sk_<env>_<cell>_…` key with `releases:write`. Publishable `tal_pk_` keys and `tal_mon_` monitor tokens are refused before any request. The action checks the key grammar and CRC32 checksum locally.

The ingest host is `https://ingest-<cell>.newtalaria.com`, taken from the key, unless `url` or `TALARIA_URL` is set. A `self` cell has no derived host and needs `TALARIA_URL`.

`POST /v1/deploys` returns `501 not_implemented`. The `deploy` input does not call it. The step stays successful and logs that the deploy was skipped.

## Usage

```yaml
- uses: newtalaria/release@v1
  id: release
  with:
    source-maps: dist
    set-commits: auto
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

Put the key in the environment. The action does not take it as an input.

To use one release string in the app build and in Talaria, set it before both steps. The name must match `^[A-Za-z0-9][A-Za-z0-9._+@-]{0,199}$`. The action's own default replaces `/` in `GITHUB_REF_NAME` with `-`, so `feature/x` becomes `feature-x@<sha7>`.

```yaml
- name: Release identity
  run: |
    ref="${GITHUB_REF_NAME//\//-}"
    echo "TALARIA_RELEASE=${ref}@${GITHUB_SHA::7}" >> "$GITHUB_ENV"

- name: Build
  run: NEXT_PUBLIC_TALARIA_RELEASE="$TALARIA_RELEASE" npm run build

- uses: newtalaria/release@v1
  with:
    source-maps: dist
    set-commits: auto
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

`set-commits: auto` posts the release, reads `previousReleaseCommitSha` from the response, then posts the `previous..HEAD` commits (at most 250). A checkout needs enough history to contain that commit.

A later step can read the outputs:

```yaml
- run: echo "${{ steps.release.outputs.release }} ${{ steps.release.outputs.commit-sha }}"
```

## Inputs

| Name | Required | Description |
| --- | --- | --- |
| `source-maps` | no | Directory of built `*.js.map` files, relative to the workspace. Omitted means no upload. |
| `set-commits` | no | `auto` associates commits. Any other value except `false` fails the step. |
| `deploy` | no | Accepted and skipped. The action does not call `POST /v1/deploys`. |
| `url` | no | Ingest base URL. Overrides `TALARIA_URL` and cell derivation. |
| `release` | no | Release name. Then `TALARIA_RELEASE`, `NEXT_PUBLIC_TALARIA_RELEASE`, then `<ref>@<sha7>` with `/` replaced by `-`. |
| `silverstripe-combine-files` | no | `true` when the uploaded script is the first file in `Requirements::combine_files`. Generated lines shift by Silverstripe's one-line header. Deploy the rewritten `.js`. |

`http://localhost` and `http://127.0.0.1` are accepted for a local API. Any other URL must be `https`.

Each map is posted as JSON: `release`, `fileName`, optional `debugId`, and `gzipBytes` (base64 of the gzipped map). When a sibling `.js` exists, the action writes one debug id into the `.js` and the map. Deploy those rewritten `.js` files.

## Outputs

| Name | Description |
| --- | --- |
| `release` | Release name sent to Talaria. |
| `commit-sha` | Full 40-character commit SHA, when `GITHUB_SHA`, `CI_COMMIT_SHA`, or `TALARIA_COMMIT_SHA` provides one. |

## Errors

Failed API calls are read as `application/problem+json` (`type`, `title`, `status`, `detail`, `code`, `requestId`). The step message includes the status, `code`, `detail`, and `requestId`. A `wrong_cell` response also includes `cell` and `url`.

The step fails when the key is missing, not a `tal_sk_` key, or has a bad checksum; the release name does not match the grammar; `source-maps` is not a directory inside the workspace; the URL is not allowed; or a release or source-map request fails. The action does not print the key.

## When the step fails

Maps already stored stay stored. The action does not retry.

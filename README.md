# Talaria source maps

Uploads a directory of already-built JavaScript source maps so Talaria can show original frames for that release.

Run this after the step that emits `*.js.map` files. The action does not build the app. It calls `@newtalaria/cli` (`talaria sourcemaps upload`), which posts each map to `POST /sourceMaps/upload`.

The release string matches the one the app sends. On GitHub Actions that string is `GITHUB_REF_NAME` plus `@` plus the first 7 characters of `GITHUB_SHA`, unless you set `release` or `TALARIA_RELEASE`. The same value is the `release` output.

## Usage

```yaml
- uses: newtalaria/source-maps@v1
  id: maps
  with:
    path: source-maps
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

`TALARIA_RELEASE_KEY` is an API key with only `releases:write`. Put it in the environment. The action reads that variable and does not take the key as an input, so the value is not stored with the step inputs.

A later step can read the release that was uploaded:

```yaml
- run: echo "${{ steps.maps.outputs.release }}"
```

To share that string with the app build, set it before both steps:

```yaml
- name: Release identity
  run: |
    echo "TALARIA_RELEASE=${GITHUB_REF_NAME}@${GITHUB_SHA::7}" >> "$GITHUB_ENV"

- name: Build
  run: NEXT_PUBLIC_TALARIA_RELEASE="$TALARIA_RELEASE" npm run build

- uses: newtalaria/source-maps@v1
  with:
    path: dist
  env:
    TALARIA_RELEASE_KEY: ${{ secrets.TALARIA_RELEASE_KEY }}
```

`TALARIA_RELEASE` wins over the GitHub ref, so the maps and the events use one string.

## Inputs

| Name | Required | Default |
| --- | --- | --- |
| `path` | yes | Directory of built `*.js.map` files, relative to the workspace. |
| `url` | no | `https://ingest.newtalaria.com`, or `TALARIA_BASE_URL` when that variable is set and `url` is omitted. |
| `release` | no | `TALARIA_RELEASE`, then `NEXT_PUBLIC_TALARIA_RELEASE`, then `GITHUB_REF_NAME` @ the first 7 characters of `GITHUB_SHA`. |

`http://localhost` and `http://127.0.0.1` are accepted for a local API. Any other URL must be `https`.

## Output

| Name | Description |
| --- | --- |
| `release` | Release string sent with each map. Set before the upload starts. |

## When the step fails

The step fails, and does not upload, when the key is missing, the release cannot be resolved, `path` is not a directory inside the workspace, or the API URL is not allowed. It also fails when any file fails to upload. Maps that were stored before a later file failed stay stored. The action does not retry, and it does not print the API key.

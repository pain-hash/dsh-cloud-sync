# Publishing dsh-cloud-sync

This folder is the publishable package. The installed `../dsh-sync` folder is
the development copy and keeps the `@local/dsh-sync` identity; do not publish
it.

> **No npm?** The npm website is not reachable from some networks. You can
> publish through GitHub only: `index.json` in this folder already uses
> `source.type: "git"`, and [GITHUB-UPLOAD.md](./GITHUB-UPLOAD.md) walks through
> the browser-only upload. In that mode users install from a pinned Git commit,
> so their machine needs Git. `index.npm.json` is the npm variant to switch to
> later.

## 1. Publish to npm (optional)

The unscoped name `dsh-sync` is already taken by another DSH plugin
(`ZhenHuangLab/dsh-sync`, a Git sync for Harness settings). This package uses
the scoped name `@pain-hash/dsh-cloud-sync`, which was unclaimed when checked.

```bash
cd dsh-cloud-sync
npm login          # must be the npm user that owns the @pain-hash scope
npm publish --access public
```

If the npm scope is not yours, change `name` in `package.json` (and the client
module id in `client.js`) to your own scope, then publish.

## 2. Host the market index

DSH has no official plugin store. The experimental plugin market reads
**index URLs the user adds**. The index must be served directly over HTTPS,
without credentials, query, fragment, or redirects.

Recommended: GitHub Pages.

1. Create a public repository `dsh-cloud-sync` under `pain-hash`.
2. Push this folder and `index.json` to the repository root.
3. Repository Settings → Pages → Deploy from branch → `main` / root.
4. Index URL:
   ```text
   https://pain-hash.github.io/dsh-cloud-sync/index.json
   ```
5. Open the URL in a browser and confirm it returns the JSON directly.

If GitHub Pages is slow or blocked on the network your users are on, host the
same `index.json` on another static HTTPS host (Gitee Pages, Aliyun OSS,
Tencent COS, Cloudflare Pages, or your own server). What matters is a direct
HTTPS response.

## 3. Test in DSH

1. Plugins page → Experimental plugins → turn on **Custom plugin indexes**.
2. Discover → add the index URL.
3. Search for `dsh-cloud-sync`; the entry should show version `1.0.0` and
   compatibility with the current Harness.
4. Install, refresh, then open Settings → Sync.

## 4. Release updates

1. Bump `version` in `package.json`.
2. Publish the new version.
3. Add a version entry in `index.json` with the new `version` and
   `publishTimestamp` (Unix seconds), and commit.
4. Users with the index added see the new version; DSH currently reports
   `update-available` rather than upgrading in place, so install the new
   version explicitly.

## 5. Keep `index.json` valid

The index format is `format: 1`; `name` must equal the published npm name;
`version` must equal the published version; `source.type` is `npm`; `engines.dsh`
uses the same SemVer range as `package.json`. The `icon` path is relative to
the index URL. A malformed index makes the Discover read fail with the JSON
path of the offending field.

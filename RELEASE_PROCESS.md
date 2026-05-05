# Release process

## Repository layout

```
pf2e-xp-tool/
├── module.json                  # FVTT module descriptor (id / version / manifest / download / compatibility)
├── scripts/main.js              # Main code (Hooks register the sidebar button + XP tool)
├── styles/main.css              # UI styles, namespaced under .xp-tool
├── lang/
│   ├── en.json                  # English translation
│   └── cn.json                  # Simplified Chinese (PF2e community uses lang code `cn`; also aliased to `zh-CN`)
├── .github/
│   ├── workflows/release.yml    # Pushing a tag triggers an automated release
│   └── release-body-template.md # Release notes template
├── .gitignore
├── README.md
└── RELEASE_PROCESS.md           # This file
```

## Per-release checklist

### 1. Code changes

Edit `scripts/main.js` / `styles/main.css` / `lang/*.json` and verify the module locally inside FVTT.

### 2. Update three fields in `module.json`

Replace `X.Y.Z` with the new version:

| Field | Value |
|---|---|
| `version` | `X.Y.Z` |
| `download` | `https://github.com/takaqiao/pf2e-xp-tool/releases/download/X.Y.Z/pf2e-xp-tool-vX.Y.Z.zip` |
| `changelog` | `https://github.com/takaqiao/pf2e-xp-tool/releases/tag/X.Y.Z` |

`manifest` is fixed at `releases/latest/download/module.json` and should not change.

### 3. Commit and push

```bash
git add -A
git commit -m "release: vX.Y.Z - <short summary>"
git push
```

### 4. Tag and push the tag (triggers the release workflow)

```bash
git tag X.Y.Z
git push origin X.Y.Z
```

> Tag names must not have a `v` prefix — the workflow matches `[0-9]+.[0-9]+.[0-9]+`.

### 5. Wait for GitHub Actions

`.github/workflows/release.yml` will:

1. Verify `module.json` `version` equals the tag.
2. Verify the `download` URL contains the right tag and zip name.
3. Build the zip, excluding `.git/`, `.github/`, `RELEASE_PROCESS.md`, `README.md`, `*.zip`, etc.
4. Create a GitHub Release with `module.json` and `pf2e-xp-tool-vX.Y.Z.zip` attached.
5. If `FOUNDRY_RELEASE_TOKEN` secret is set, ping the foundryvtt.com packages registry so the package page picks up the new version.

### 6. Verify the release

Open `https://github.com/takaqiao/pf2e-xp-tool/releases/latest` and confirm both files are attached:

- `module.json` (FVTT uses this for update checks)
- `pf2e-xp-tool-vX.Y.Z.zip` (FVTT downloads this)

FVTT install URL:

```
https://github.com/takaqiao/pf2e-xp-tool/releases/latest/download/module.json
```

## Common pitfalls

- **`module.json` `version` not bumped** — workflow step 1 fails.
- **`download` URL doesn't match the tag** — workflow step 2 fails.
- **Tag has a `v` prefix** (e.g. `v1.0.1`) — workflow does not trigger.
- **Code changed but no new tag** — FVTT clients won't see an update.

## Foundry packages registry (optional)

To have foundryvtt.com auto-pick up new versions:

1. Create a packages release token at https://foundryvtt.com/auth/profile/.
2. Add it as a repo secret: Settings → Secrets and variables → Actions → New repository secret → name `FOUNDRY_RELEASE_TOKEN`.
3. Subsequent release workflows will publish there automatically.

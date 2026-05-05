# PF2E XP Budget Tool

[![GitHub release](https://img.shields.io/github/v/release/takaqiao/pf2e-xp-tool?style=flat-square&label=release&logo=github)](https://github.com/takaqiao/pf2e-xp-tool/releases/latest)
[![Foundry version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Furl%3Dhttps%3A%2F%2Fgithub.com%2Ftakaqiao%2Fpf2e-xp-tool%2Freleases%2Flatest%2Fdownload%2Fmodule.json&style=flat-square)](https://foundryvtt.com/packages/pf2e-xp-tool)
[![Total downloads](https://img.shields.io/github/downloads/takaqiao/pf2e-xp-tool/total?style=flat-square&label=downloads&color=brightgreen)](https://github.com/takaqiao/pf2e-xp-tool/releases)
[![Latest downloads](https://img.shields.io/github/downloads/takaqiao/pf2e-xp-tool/latest/total?style=flat-square&label=latest)](https://github.com/takaqiao/pf2e-xp-tool/releases/latest)
[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v12%20%7C%20v14-orange?style=flat-square&logo=foundryvirtualtabletop&logoColor=white)](https://foundryvtt.com/)
[![Pathfinder 2e](https://img.shields.io/badge/system-PF2e-c1272d?style=flat-square)](https://foundryvtt.com/packages/pf2e)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](#license)

Encounter XP budget visualizer for the Pathfinder 2e system on Foundry VTT.

## Install

In Foundry → **Add-on Modules → Install Module**, paste the manifest URL:

```
https://github.com/takaqiao/pf2e-xp-tool/releases/latest/download/module.json
```

Compatibility: Foundry VTT v12 ~ v14, PF2e system.

Languages: English, Simplified Chinese (UI follows the Foundry client language).

## Usage

After enabling the module, a blue button labelled `PF2E XP Budget` appears at the bottom of the sidebar **Macros** and **Actors** tabs (GM only).

Workflow:

1. Select opposition tokens in the scene (PC tokens optional; without PCs the tool prompts for party size / level).
2. Click the button to open the tool window.
3. The header shows party size / level / threat rating / total XP. A progress bar marks the 4-player equivalent budget.
4. Each creature card has `[W][N][E]` toggles for live elite / weak preview.
5. The "Recommended plans" panel shows exact fill plans sorted by operation count:
   - **Adjust** — toggle elite/weak on existing creatures only
   - **Add / Remove** — add or remove a number of new creatures
   - **Combo** — both at once
6. Each plan card has a `Preview this plan` button that pushes the plan's adjustments into all related NPC previews at once.
7. The footer `Apply N template change(s)` button writes previews back to the actors.

## Design notes

- **Target is locked to the opening baseline**: switching preview doesn't make the target chase you; it only changes when you edit party size / level.
- **Exact plans only by default**: check "Show approximate plans", or rely on the auto-fallback when no exact plan exists.
- **Operation count**: 1 elite/weak toggle = 1 op; adding or removing 1 creature = 1 op (more creatures = more ops). Lower op count is preferred.
- **Elite / Weak math** follows the PF2e CRB exactly (`pf2e.mjs`):
  - Elite: `base < 1 ? base + 2 : base + 1` (so -1→1, 0→2, 1→2, 2→3, ...)
  - Weak: `base === 1 ? base - 2 : base - 1` (so -1→-2, 0→-1, 1→-1, 2→1, ...)

You can also invoke the tool from a macro:

```javascript
PF2EXPTool.open();
```

## Release process

See [RELEASE_PROCESS.md](./RELEASE_PROCESS.md).

## License

MIT

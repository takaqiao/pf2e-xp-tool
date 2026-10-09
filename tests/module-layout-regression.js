const assert = require("node:assert/strict");
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync("module.json", "utf8"));
assert.deepEqual(manifest.esmodules, ["scripts/main.mjs"]);
assert.equal(manifest.scripts, undefined);

const onceHooks = [];
const renderHooks = [];
globalThis.foundry = { appv1: { api: { Dialog: class {} } } };
globalThis.game = {
  i18n: { localize: key => key, format: key => key },
  pf2e: { gm: { calculateXP() {
    return {
      totalXP: 0, xpPerPlayer: 0, rating: "trivial",
      encounterBudgets: { trivial: 50, low: 75, moderate: 100, severe: 150, extreme: 200 },
    };
  } } },
};
globalThis.CONFIG = { PF2E: { creatureTraits: {} } };
globalThis.localStorage = { getItem() { return null; } };
globalThis.Hooks = {
  once(name) { onceHooks.push(name); },
  on(name) { renderHooks.push(name); },
};

(async () => {
  const main = await import("../scripts/main.mjs");
  const core = await import("../scripts/core.mjs");
  const view = await import("../scripts/view.mjs");
  assert.equal(typeof globalThis.PF2EXPTool.open, "function");
  assert.ok(onceHooks.includes("i18nInit"));
  assert.ok(onceHooks.includes("init"));
  assert.ok(renderHooks.includes("renderActorDirectory"));
  assert.ok(renderHooks.includes("renderMacroDirectory"));
  const state = main.createToolState(4, 5, [], [], []);
  core.recompute(state);
  const html = view.renderContent(state);
  assert.match(html, /xp-tool/);
  assert.match(html, /quick-group-select/);
  console.log("PASS: ES module entry registers localization, public API, and sidebar hooks");
})().catch(error => { console.error(error); process.exitCode = 1; });

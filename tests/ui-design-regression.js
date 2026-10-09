globalThis.foundry = { appv1: { api: { Dialog: class {} } }, utils: { deepClone: value => value } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = { pf2e: { gm: { calculateXP() { return {}; } } } };
async function run() {
const api = await import("../scripts/view.mjs");

const items = ["add", "adjust", "composite"].map((kind, sourceIdx) => ({ kind, sourceKey: "exact", sourceIdx }));
const expected = {
  best: ["add", "adjust", "composite"],
  creatures: ["add"],
  templates: ["adjust"],
  mixed: ["composite"]
};
for (const [filter, kinds] of Object.entries(expected)) {
  const actual = items.filter(item => api.planMatchesFilter(item, filter)).map(item => item.kind);
  if (JSON.stringify(actual) !== JSON.stringify(kinds)) {
    throw new Error(`Plan filter ${filter} returned ${JSON.stringify(actual)}`);
  }
}

if (api.planKey(items[0]) !== "add:exact:0") {
  throw new Error("Selected-plan key is unstable");
}

console.log("PASS: strategy filters and selected-plan keys");
}
run().catch(error => { console.error(error); process.exitCode = 1; });

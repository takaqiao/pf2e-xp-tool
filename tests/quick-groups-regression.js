const assert = require("node:assert/strict");

globalThis.foundry = { appv1: { api: { Dialog: class {} } }, utils: { deepClone: value => value } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = { i18n: { localize: key => key, format: key => key } };
(async () => {
globalThis.__quickGroupTest = { ...await import("../scripts/core.mjs"), ...await import("../scripts/view.mjs"), ...await import("../scripts/main.mjs") };

const api = globalThis.__quickGroupTest;
assert.equal(Object.keys(api.QUICK_GROUPS).length, 7);
const state = {
  partyLevel: 5, partySize: 4, pwol: false, gap: 120, theme: "goblin",
  quickGroup: "boss-lackeys", candidateLoadState: "ready",
  creatureCandidatesByLevel: new Map([
    [1, [{ name: "Goblin Lackey", uuid: "lackey", traits: ["goblin"] }]],
    [3, [{ name: "Goblin Scout", uuid: "scout", traits: ["goblin"] }]],
    [5, [{ name: "Goblin Soldier", uuid: "soldier", traits: ["goblin"] }]],
    [7, [{ name: "Goblin Boss", uuid: "boss", traits: ["goblin"] }]],
  ]),
};
assert.match(api.renderStructureControl(state), /class="quick-group-select active"/);
const groupedHtml = api.renderPlansSection(state);
assert.ok(groupedHtml.indexOf('data-plan-filter="mixed"') < groupedHtml.indexOf('class="quick-group-select active"'));
assert.match(groupedHtml, /data-plan-source="structure"/);
for (const [id, group] of Object.entries(api.QUICK_GROUPS)) {
  state.quickGroup = id;
  const plan = api.buildQuickGroupPlan(state);
  assert.ok(plan, id);
  assert.equal(plan.sum, group.budget, id);
  assert.equal(plan.totalCount, group.slots.length, id);
  assert.deepEqual(plan.parts.flatMap(part => Array(part.count).fill(part.level - 5)), group.slots, id);
}
state.quickGroup = "boss-lackeys";
assert.match(api.renderPlansSection(state), /data-plan-source="structure"/);
const filter = { dataset: { planFilter: "mixed" }, addEventListener(name, handler) { if (name === "click") this.click = handler; } };
const row = {
  dataset: { planKind: "add", planSource: "structure", planIdx: "0" },
  addEventListener(name, handler) { if (name === "click") this.click = handler; },
};
state.npcs = [];
const root = {
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === ".plan-row.clickable") return [row];
    if (selector === ".plan-filter") return [filter];
    return [];
  },
  addEventListener() {},
};
let refreshed = false;
api.attachListeners(root, state, () => { refreshed = true; });
row.click({ preventDefault() {} });
assert.equal(refreshed, true);
assert.equal(state.virtualPlanDelta, 120);
assert.deepEqual(state.previewEntities.map(entity => [entity.name, entity.count]), [
  ["Goblin Boss", 1], ["Goblin Lackey", 4],
]);
filter.click({ preventDefault() {} });
assert.equal(state.quickGroup, "auto");
assert.equal(state.planFilter, "mixed");
state.creatureCandidatesByLevel.delete(7);
state.themeCandidateCache = new Map();
assert.equal(api.buildQuickGroupPlan(state), null);

console.log("PASS: seven quick groups use exact creature levels and preview plan wiring");
})().catch(error => { console.error(error); process.exitCode = 1; });

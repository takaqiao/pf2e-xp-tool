const assert = require("node:assert/strict");

const dialogs = [];
globalThis.foundry = { appv1: { api: { Dialog: class {
  constructor(data) { this.data = data; dialogs.push(this); }
  render() { return this; }
} } } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = { user: { isGM: true }, i18n: { localize: key => key, format: key => key } };
globalThis.ui = { notifications: { error() { throw new Error("Selection should not be required"); }, warn() {} } };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.canvas = { tokens: { controlled: [] } };
(async () => {
const api = { ...await import("../scripts/main.mjs"), ...await import("../scripts/view.mjs") };
api.openFromSelection();
assert.equal(dialogs.length, 1);
const opened = api.createToolState(5, 4, [], [], []);
assert.equal(opened.targetMode, "moderate");
assert.deepEqual(opened.npcs, []);
assert.deepEqual(opened.hazards, []);
const previewHtml = api.renderNpcSection({
  npcs: [], hazards: [], previewEntities: [
    { action: "add", kind: "creature", name: "Book Beast", level: 6, xp: 60, count: 1, uuid: "test.book-beast" },
    { action: "add", kind: "creature", name: "Curseling", level: 2, xp: 20, count: 2, uuid: "test.curseling" },
  ],
});
assert.match(previewHtml, /Book Beast/);
assert.match(previewHtml, /Curseling/);
assert.match(previewHtml, /data-creature-uuid="test\.book-beast"/);
assert.doesNotMatch(previewHtml, /No opposition or hazard token selected/);

const selected = api.createToolState(5, 4, [{}], [], []);
assert.equal(selected.targetMode, "baseline");
assert.equal(selected.npcs.length, 1);

console.log("PASS: tool opens without selected enemies and starts empty encounters at Moderate");
})().catch(error => { console.error(error); process.exitCode = 1; });

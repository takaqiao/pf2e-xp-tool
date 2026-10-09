const assert = require("node:assert/strict");
const fs = require("node:fs");

const css = fs.readFileSync("styles/main.css", "utf8");
assert.match(css, /\.trait-picker \{[^}]*position: absolute;/);

globalThis.foundry = { appv1: { api: { Dialog: class {} } }, utils: {
  deepClone: value => value,
  getProperty(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); },
} };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = { i18n: { localize: key => key, format: key => key } };
globalThis.CONFIG = { PF2E: { creatureTraits: {
  fey: "Fey", demon: "Demon", undead: "Undead", forest: "Forest",
  dragon: "Dragon", fire: "Fire", leshy: "Leshy", plant: "Plant",
} } };
(async () => {
globalThis.__themeTest = { ...await import("../scripts/core.mjs"), ...await import("../scripts/view.mjs"), ...await import("../scripts/main.mjs") };

assert.equal(globalThis.__themeTest.creatureTraitOptions().length, 8);
const pickerState = { theme: "", traitPickerOpen: false, npcs: [] };
const handlers = {};
const plus = { addEventListener(name, handler) { handlers[`plus:${name}`] = handler; } };
const input = { value: "", focus() {}, addEventListener(name, handler) { handlers[`input:${name}`] = handler; } };
const option = { dataset: { traitSlug: "leshy", traitSearch: "leshy" }, hidden: false,
  addEventListener(name, handler) { handlers[`option:${name}`] = handler; },
  click() { handlers["option:click"](); } };
const andMode = { dataset: { themeMode: "and" }, addEventListener(name, handler) { handlers[`and:${name}`] = handler; } };
const root = {
  querySelector(selector) {
    if (selector === ".trait-add") return plus;
    if (selector === ".trait-search") return input;
    if (selector === ".trait-option:not([hidden])") return option.hidden ? null : option;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === ".trait-option") return [option];
    if (selector === ".trait-mode-btn") return [andMode];
    return [];
  },
  addEventListener() {},
};
let refreshCount = 0;
globalThis.__themeTest.attachListeners(root, pickerState, () => { refreshCount++; });
handlers["plus:click"]();
assert.equal(pickerState.traitPickerOpen, true);
assert.ok(refreshCount > 0);
const pickerHtml = globalThis.__themeTest.renderThemeControl(pickerState);
assert.equal((pickerHtml.match(/class="trait-option"/g) || []).length, 8);
assert.doesNotMatch(pickerHtml, /<datalist/);
assert.match(pickerHtml, /aria-expanded="true"/);
assert.match(pickerHtml, /class="trait-search"/);
assert.doesNotMatch(pickerHtml, /class="theme-input"/);
handlers["option:click"]();
assert.equal(pickerState.theme, "leshy");
handlers["and:click"]();
assert.equal(pickerState.themeMode, "and");
assert.match(globalThis.__themeTest.renderThemeControl(pickerState), /data-theme-mode="and" aria-pressed="true"/);
input.value = "misty ruins";
handlers["input:input"]();
assert.equal(option.hidden, true);
let prevented = false;
let stopped = false;
handlers["input:keydown"]({ key: "Enter", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
assert.equal(prevented, true);
assert.equal(stopped, true);
assert.equal(pickerState.theme, "leshy");
input.value = "leshy";
handlers["input:input"]();
assert.equal(option.hidden, false);
handlers["input:keydown"]({ key: "Enter", preventDefault() {}, stopPropagation() {} });
assert.equal(pickerState.theme, "leshy");

const state = {
  theme: "leshy", gap: 80, candidateLoadState: "ready",
  creatureCandidatesByLevel: new Map([[3, [
    { name: "Abandoned Zealot", uuid: "unrelated", traits: [], searchText: "" },
    { name: "Leaf Leshy", uuid: "leshy", traits: ["plant"], searchText: "" },
  ]]]),
};
const cardState = { theme: "" };
globalThis.__themeTest.addThemeTrait(cardState, "fire, leshy");
assert.equal(cardState.theme, "fire, leshy");
assert.match(globalThis.__themeTest.renderThemeControl(cardState), /class="trait-card"/);
globalThis.__themeTest.addThemeTrait(cardState, "FIRE");
assert.equal(cardState.theme, "fire, leshy");
globalThis.__themeTest.removeThemeTrait(cardState, 0);
assert.equal(cardState.theme, "leshy");
assert.match(globalThis.__themeTest.renderThemeControl(state), /class="trait-add"/);
assert.equal(globalThis.__themeTest.creatureCandidateFor({ level: 3 }, state, 0, 0).name, "Leaf Leshy");
assert.equal(globalThis.__themeTest.planMatchesTheme({ kind: "add", plan: { parts: [{ level: 3 }] } }, state), true);
state.creatureCandidatesByLevel.set(3, [{ name: "Abandoned Zealot", uuid: "unrelated", traits: [], searchText: "" }]);
state.themeCandidateCache = new Map();
assert.equal(globalThis.__themeTest.creatureCandidateFor({ level: 3 }, state, 0, 0), null);
assert.equal(globalThis.__themeTest.planMatchesTheme({ kind: "add", plan: { parts: [{ level: 3 }] } }, state), false);

const modeState = {
  theme: "fire, plant", themeMode: "or", gap: 80, candidateLoadState: "ready",
  creatureCandidatesByLevel: new Map([[3, [
    { name: "Flame", traits: ["fire"] },
    { name: "Leshy", traits: ["plant"] },
  ]]]),
};
const addPlan = { kind: "add", plan: { parts: [{ level: 3 }] } };
assert.equal(globalThis.__themeTest.planMatchesTheme(addPlan, modeState), true);
modeState.themeMode = "and";
assert.equal(globalThis.__themeTest.planMatchesTheme(addPlan, modeState), false);
modeState.creatureCandidatesByLevel.get(3).push({ name: "Burning Leshy", traits: ["fire", "plant"] });
modeState.themeCandidateCache = new Map();
assert.equal(globalThis.__themeTest.planMatchesTheme(addPlan, modeState), true);
assert.equal(globalThis.__themeTest.creatureCandidateFor({ level: 3 }, modeState, 0, 0).name, "Burning Leshy");
modeState.theme = "fire, amphibious";
modeState.creatureCandidatesByLevel.set(3, [{
  name: "Cathartic Slime", traits: ["amphibious", "ooze", "water"],
  searchText: "weakness fire 5",
}]);
modeState.themeCandidateCache = new Map();
assert.equal(globalThis.__themeTest.planMatchesTheme(addPlan, modeState), false);
modeState.themeMode = "or";
assert.equal(globalThis.__themeTest.planMatchesTheme(addPlan, modeState), true);

globalThis.game.packs = [{
  documentName: "Actor", collection: "test.bestiary",
  async getIndex({ fields }) {
    assert.ok(fields.includes("system.traits.value"));
    assert.ok(fields.includes("system.details.publicNotes"));
    return [{ _id: "plant", type: "npc", name: "Green Guardian",
      system: { details: { level: { value: 3 }, publicNotes: "A leshy guardian" }, traits: { value: ["plant"] } } }];
  },
}];
const byLevel = await globalThis.__themeTest.loadCreatureCandidates();
  const candidate = byLevel.get(3)[0];
  assert.deepEqual(candidate.traits, ["plant"]);
  assert.match(candidate.searchText, /leshy/);
  console.log("PASS: theme control and creature suggestions use indexed theme data");
})().catch(error => { console.error(error); process.exitCode = 1; });

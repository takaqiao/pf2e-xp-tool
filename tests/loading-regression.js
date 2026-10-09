globalThis.foundry = { appv1: { api: { Dialog: class {} } }, utils: { getProperty: () => 0, deepClone: value => value } };
globalThis.Hooks = { once() {}, on() {} };
globalThis.game = {
  i18n: { lang: "en" },
  packs: {
    filter(predicate) {
      return [{ documentName: "Actor", getIndex: () => new Promise(() => {}) }].filter(predicate);
    }
  }
};

(async () => {
  const { loadCreatureCandidates } = await import("../scripts/core.mjs");
  const verdict = await Promise.race([
    loadCreatureCandidates(50).then(() => "settled"),
    new Promise(resolve => setTimeout(() => resolve("timeout"), 500))
  ]);
  if (verdict !== "settled") {
    console.error("FAIL: creature candidate loading can remain pending forever");
    process.exitCode = 1;
    return;
  }
  console.log("PASS: creature candidate loading settles when one pack stalls");
})().catch(error => { console.error(error); process.exitCode = 1; });

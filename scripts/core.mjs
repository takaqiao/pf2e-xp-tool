import { MODULE_ID, T } from "./i18n.mjs";
import { runtime } from "./runtime.mjs";

export function levelDelta(baseLevel, adj) {
  if (adj === "elite") return baseLevel < 1 ? 2 : 1;
  if (adj === "weak")  return baseLevel === 1 ? -2 : -1;
  return 0;
}
export function effectiveLevel(baseLevel, adj) {
  return baseLevel + levelDelta(baseLevel, adj);
}

export const ADJ_KEYS = ["weak", "normal", "elite"];
export const ADJUSTMENTS = new Proxy({}, {
  get(_, key) {
    if (typeof key !== "string" || !ADJ_KEYS.includes(key)) return undefined;
    return { label: T(`adj.${key}.label`), short: T(`adj.${key}.short`) };
  },
  has(_, key) { return typeof key === "string" && ADJ_KEYS.includes(key); }
});

export function clampInt(value, fallback) {
  const n = Math.abs(Math.trunc(Number(value)));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function clampFloat(value, fallback) {
  const n = Math.abs(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}

export function signed(n) { return n >= 0 ? "+" + n : String(n); }

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function loadCreatureCandidates(timeoutMs = 3000) {
  if (runtime.creatureCandidatesPromise) return runtime.creatureCandidatesPromise;
  runtime.creatureCandidatesPromise = (async () => {
    const byLevel = new Map();
    const packs = game.packs.filter(pack => pack.documentName === "Actor");
    const results = await Promise.allSettled(packs.map(async pack => {
      const index = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve([]), timeoutMs);
        pack.getIndex({ fields: [
          "type", "system.details.level.value", "system.traits.rarity",
          "system.traits.value", "system.details.publicNotes",
          "system.details.description.value", "system.description.value"
        ] })
          .then(value => { clearTimeout(timer); resolve(value); })
          .catch(error => { clearTimeout(timer); reject(error); });
      });
      return { pack, index };
    }));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { pack, index } = result.value;
      for (const entry of index) {
        if (entry.type !== "npc") continue;
        const level = Number(foundry.utils.getProperty(entry, "system.details.level.value"));
        if (!Number.isFinite(level)) continue;
        const uuid = entry.uuid || `Compendium.${pack.collection}.Actor.${entry._id}`;
        const list = byLevel.get(level) || [];
        const traits = foundry.utils.getProperty(entry, "system.traits.value") || [];
        const description = foundry.utils.getProperty(entry, "system.details.publicNotes") ||
          foundry.utils.getProperty(entry, "system.details.description.value") ||
          foundry.utils.getProperty(entry, "system.description.value") || "";
        list.push({
          name: entry.name, uuid, pack: pack.collection,
          traits: Array.isArray(traits) ? traits : [],
          searchText: String(description).replace(/<[^>]*>/g, " ").toLowerCase()
        });
        byLevel.set(level, list);
      }
    }
    for (const [level, entries] of byLevel) {
      const seen = new Set();
      const unique = entries
        .filter(entry => entry.name && entry.uuid && !seen.has(entry.uuid) && seen.add(entry.uuid))
        .sort((a, b) => a.name.localeCompare(b.name));
      byLevel.set(level, unique);
    }
    return byLevel;
  })();
  return runtime.creatureCandidatesPromise;
}

export function getActorAdjustment(actor) {
  const adj = actor && actor.system && actor.system.attributes && actor.system.attributes.adjustment;
  return ADJUSTMENTS[adj] ? adj : "normal";
}

export function getActorHpBoost(actor) {
  return !!(actor && actor.getFlag && actor.getFlag(MODULE_ID, "hpBoost"));
}

export function getActorHpBoostPercent(actor) {
  const flag = actor && actor.getFlag && actor.getFlag(MODULE_ID, "hpBoost");
  return flag ? Number(flag.percent ?? 25) : 0;
}

export function getBaseLevel(actor) {
  if (!actor) return 0;
  const base = actor.system && actor.system.details && actor.system.details.level && actor.system.details.level.base;
  if (typeof base === "number") return base;
  const adj = getActorAdjustment(actor);
  const eff = Number(actor.level);
  if (adj === "elite") {
    if (eff <= 1) return -1;
    if (eff === 2) return 1;
    return eff - 1;
  }
  if (adj === "weak") {
    if (eff === -1) return 1;
    return eff + 1;
  }
  return eff;
}

export const STANDARD_XP_MAP = {
  "-4": 10, "-3": 15, "-2": 20, "-1": 30, "0": 40,
  "1": 60, "2": 80, "3": 120, "4": 160
};
export const PWOL_XP_MAP = {
  "-7": 9, "-6": 12, "-5": 14, "-4": 18, "-3": 21, "-2": 26, "-1": 32, "0": 40,
  "1": 48, "2": 60, "3": 72, "4": 90, "5": 108, "6": 135, "7": 160
};
export const SIMPLE_HAZARD_XP_MAP = {
  "-4": 2, "-3": 3, "-2": 4, "-1": 6, "0": 8,
  "1": 12, "2": 16, "3": 24, "4": 32
};
export const DIFFICULTY_KEYS = ["trivial", "low", "moderate", "severe", "extreme"];
export const BASE_ENCOUNTER_BUDGETS = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
export const CHARACTER_ADJUSTMENTS = { trivial: 10, low: 20, moderate: 20, severe: 30, extreme: 40 };
export const QUICK_GROUPS = {
  "boss-lackeys": { slots: [2, -4, -4, -4, -4], budget: 120 },
  "boss-lieutenant": { slots: [2, 0], budget: 120 },
  "elite-enemies": { slots: [0, 0, 0], budget: 120 },
  "lieutenant-lackeys": { slots: [0, -4, -4, -4, -4], budget: 80 },
  "mated-pair": { slots: [0, 0], budget: 80 },
  troop: { slots: [0, -2, -2], budget: 80 },
  "mook-squad": { slots: [-4, -4, -4, -4, -4, -4], budget: 60 }
};

export function encounterBudgetsForParty(partySize) {
  const extraCharacters = Number(partySize) - 4;
  return Object.fromEntries(DIFFICULTY_KEYS.map(difficulty => [
    difficulty,
    Math.max(0, BASE_ENCOUNTER_BUDGETS[difficulty] + CHARACTER_ADJUSTMENTS[difficulty] * extraCharacters)
  ]));
}

export function xpForDelta(delta, pwol) {
  const map = pwol ? PWOL_XP_MAP : STANDARD_XP_MAP;
  const range = pwol ? 7 : 4;
  const bounded = Math.max(-range, Math.min(range, delta));
  return map[String(bounded)] || 0;
}

export function calculateXP(partyLevel, partySize, npcLevels, hazards, pwol) {
  const result = game.pf2e.gm.calculateXP(partyLevel, partySize, npcLevels, hazards, { pwol: pwol });
  return { ...result, encounterBudgets: encounterBudgetsForParty(partySize) };
}

export function calculateXPWithHpBoost(partyLevel, partySize, npcLevels, hpPercents, hazards, pwol) {
  const result = calculateXP(partyLevel, partySize, npcLevels, hazards, pwol);
  const surcharge = Math.round(npcLevels.reduce((sum, level, index) =>
    sum + singleNpcXP(level, partyLevel, pwol) * (Number(hpPercents[index]) || 0) * 0.01, 0));
  const totalXP = result.totalXP + surcharge;
  const rating = ratingForTotal(totalXP, result.encounterBudgets);
  return {
    ...result,
    totalXP,
    rating,
    ratingXP: BASE_ENCOUNTER_BUDGETS[rating],
    xpPerPlayer: Math.floor(totalXP / partySize * 4),
    hpSurcharge: surcharge
  };
}

export function requiredFortifyPercent(targetXP, unboostedXP, selectedCreatureXP) {
  if (selectedCreatureXP <= 0 || targetXP <= unboostedXP) return 0;
  return Math.round(((targetXP - unboostedXP) / selectedCreatureXP) * 10000) / 100;
}

export function singleNpcXP(level, partyLevel, pwol) {
  return xpForDelta(level - partyLevel, pwol);
}

export function getCreatureXpOptions(partyLevel, pwol) {
  const minDelta = pwol ? -7 : -4;
  const maxDelta = pwol ? 7 : 4;
  const options = [];
  for (let delta = minDelta; delta <= maxDelta; delta++) {
    const level = partyLevel + delta;
    if (level < -1) continue;
    const xp = xpForDelta(delta, pwol);
    if (xp > 0) options.push({ delta, level, xp });
  }
  options.sort((a, b) => b.xp - a.xp || b.delta - a.delta);
  return options;
}

export function getHazardXpOptions(partyLevel, isComplex, pwol) {
  const minDelta = isComplex && pwol ? -7 : -4;
  const maxDelta = isComplex && pwol ? 7 : 4;
  const options = [];
  for (let delta = minDelta; delta <= maxDelta; delta++) {
    const level = partyLevel + delta;
    if (level < -1) continue;
    const xp = isComplex ? xpForDelta(delta, pwol) : (SIMPLE_HAZARD_XP_MAP[String(delta)] || 0);
    if (xp > 0) options.push({ delta, level, xp, isComplex });
  }
  options.sort((a, b) => b.xp - a.xp || b.delta - a.delta);
  return options;
}

export function hazardXpForLevel(level, partyLevel, isComplex, pwol) {
  if (isComplex) return singleNpcXP(level, partyLevel, pwol);
  const delta = Math.max(-4, Math.min(4, level - partyLevel));
  return SIMPLE_HAZARD_XP_MAP[String(delta)] || 0;
}

export function getRemovalOptions(entities, getKey, getOption) {
  const grouped = new Map();
  for (const entity of entities) {
    const key = getKey(entity);
    const current = grouped.get(key);
    if (current) current.maxCount++;
    else grouped.set(key, { ...getOption(entity), maxCount: 1 });
  }
  return Array.from(grouped.values()).sort((a, b) => b.xp - a.xp || b.level - a.level);
}

export function insertPlan(map, sum, plan, maxPerSum) {
  if (sum <= 0) return;
  const list = map.get(sum) || [];
  const signature = plan.parts
    .map(p => `${p.level}:${p.count}`)
    .join("|");
  if (list.some(p => p.signature === signature)) return;
  list.push({ ...plan, signature });
  list.sort((a, b) => {
    if (a.totalCount !== b.totalCount) return a.totalCount - b.totalCount;
    if (a.distinct !== b.distinct) return a.distinct - b.distinct;
    return b.sum - a.sum;
  });
  map.set(sum, list.slice(0, maxPerSum));
}

export function buildFillPlans(target, options) {
  const targetValue = Math.max(0, Math.trunc(target));
  if (targetValue <= 0 || options.length === 0) return { exact: [], near: [], bySum: new Map() };

  const maxXp = Math.max.apply(null, options.map(o => o.xp));
  const maxCreatures = 10;
  const maxSum = targetValue + maxXp;
  const maxPerSum = 10;
  const picks = new Array(options.length).fill(0);
  const plansBySum = new Map();

  function record(sum, used) {
    if (sum <= 0 || used <= 0) return;
    const parts = [];
    for (let i = 0; i < picks.length; i++) {
      if (picks[i] > 0) {
        const o = options[i];
        parts.push({
          count: picks[i], level: o.level, delta: o.delta,
          xp: o.xp, subtotal: o.xp * picks[i]
        });
      }
    }
    if (parts.length === 0) return;
    insertPlan(plansBySum, sum, {
      sum, parts, totalCount: used, distinct: parts.length
    }, maxPerSum);
  }

  function dfs(index, sum, used) {
    if (sum > maxSum || used > maxCreatures) return;
    if (index >= options.length) { record(sum, used); return; }
    const option = options[index];
    const maxByCount = maxCreatures - used;
    const maxBySum = Math.floor((maxSum - sum) / option.xp);
    const available = Number.isFinite(option.maxCount) ? option.maxCount : maxByCount;
    const maxTake = Math.max(0, Math.min(maxByCount, maxBySum, available));
    for (let take = maxTake; take >= 0; take--) {
      picks[index] = take;
      dfs(index + 1, sum + take * option.xp, used + take);
    }
    picks[index] = 0;
  }

  dfs(0, 0, 0);

  const all = [];
  plansBySum.forEach((list, sum) => {
    list.forEach(p => {
      all.push({ ...p, sum, deviation: Math.abs(sum - targetValue) });
    });
  });
  all.sort((a, b) => {
    if (a.deviation !== b.deviation) return a.deviation - b.deviation;
    if (a.totalCount !== b.totalCount) return a.totalCount - b.totalCount;
    if (a.distinct !== b.distinct) return a.distinct - b.distinct;
    return b.sum - a.sum;
  });
  return {
    exact: all.filter(p => p.deviation === 0).slice(0, 12),
    near: all.filter(p => p.deviation > 0).slice(0, 8),
    bySum: plansBySum
  };
}

export function buildAdjustOptions(state) {
  const options = [];
  state.npcs.forEach((npc, idx) => {
    const fromAdj = npc.previewAdjustment;
    const fromLevel = effectiveLevel(npc.baseLevel, fromAdj);
    const fromBaseXP = singleNpcXP(fromLevel, state.partyLevel, state.pwol);
    const fromXP = fromBaseXP + Math.round(fromBaseXP * npc.previewHpPercent * 0.01);
    ["weak", "normal", "elite"].forEach(toAdj => {
      if (toAdj === fromAdj) return;
      const toLevel = effectiveLevel(npc.baseLevel, toAdj);
      if (toLevel < -1) return;
      const toBaseXP = singleNpcXP(toLevel, state.partyLevel, state.pwol);
      const toXP = toBaseXP + Math.round(toBaseXP * npc.previewHpPercent * 0.01);
      const deltaXP = toXP - fromXP;
      if (deltaXP === 0) return;
      options.push({
        npcIdx: idx, npcName: npc.name,
        fromAdj, toAdj, fromLevel, toLevel,
        fromXP, toXP, deltaXP
      });
    });
  });
  return options;
}

export function buildAdjustmentCandidates(adjOptions, maxAdjust, maxPerState = 3) {
  const byNpc = new Map();
  adjOptions.forEach(option => {
    if (!byNpc.has(option.npcIdx)) byNpc.set(option.npcIdx, []);
    byNpc.get(option.npcIdx).push(option);
  });
  let states = new Map([["0:0", [{ sum: 0, picked: [] }]]]);

  function insert(map, candidate) {
    const key = `${candidate.picked.length}:${candidate.sum}`;
    const list = map.get(key) || [];
    const signature = candidate.picked.map(option => `${option.npcIdx}:${option.toAdj}`).join("|");
    if (list.some(entry => entry.signature === signature)) return;
    list.push({ ...candidate, signature });
    map.set(key, list.slice(0, maxPerState));
  }

  byNpc.forEach(options => {
    const next = new Map();
    states.forEach(list => list.forEach(candidate => {
      insert(next, candidate);
      if (candidate.picked.length >= maxAdjust) return;
      options.forEach(option => insert(next, {
        sum: candidate.sum + option.deltaXP,
        picked: [...candidate.picked, option]
      }));
    }));
    states = next;
  });

  const candidates = [];
  states.forEach(list => list.forEach(candidate => {
    if (candidate.picked.length > 0) candidates.push(candidate);
  }));
  return candidates;
}

export function buildAdjustPlans(targetGap, adjOptions, maxAdjust, maxResults) {
  if (adjOptions.length === 0) return { exact: [], near: [] };
  const raw = buildAdjustmentCandidates(adjOptions, maxAdjust).map(candidate => ({
    ...candidate,
    deviation: Math.abs(candidate.sum - targetGap),
    count: candidate.picked.length
  }));

  function dedupSorted(arr) {
    const seen = new Set();
    const unique = [];
    for (const p of arr) {
      const sig = p.picked.map(o => `${o.npcIdx}:${o.toAdj}`).sort().join("|");
      if (!seen.has(sig)) { seen.add(sig); unique.push(p); }
    }
    return unique;
  }

  const exact = raw.filter(p => p.deviation === 0);
  exact.sort((a, b) => a.count - b.count || Math.abs(a.sum) - Math.abs(b.sum));
  const near = raw.filter(p => p.deviation > 0);
  near.sort((a, b) => a.deviation - b.deviation || a.count - b.count);
  return {
    exact: dedupSorted(exact).slice(0, maxResults),
    near: dedupSorted(near).slice(0, maxResults)
  };
}

export function buildCompositePlans(targetGap, adjOptions, addPlansResult, isAdd, maxAdjust, maxResults) {
  if (!adjOptions || adjOptions.length === 0) return { exact: [], near: [] };
  const addBySum = (addPlansResult && addPlansResult.bySum) || new Map();
  if (addBySum.size === 0) return { exact: [], near: [] };

  const addSums = [];
  addBySum.forEach((_, sum) => { if (sum > 0) addSums.push(sum); });
  addSums.sort((a, b) => a - b);

  const addDirection = isAdd ? 1 : -1;
  const allComposite = [];

  function tryCombineWithAdds(adjustsPicked, adjustSum) {
    const addNeeded = (targetGap - adjustSum) * addDirection;
    const ranked = addSums
      .map(s => ({ sum: s, dev: Math.abs(s - addNeeded) }))
      .sort((a, b) => a.dev - b.dev)
      .slice(0, 4);
    ranked.forEach(cs => {
      const plansForSum = addBySum.get(cs.sum) || [];
      plansForSum.slice(0, 2).forEach(ap => {
        const totalSum = adjustSum + ap.sum * addDirection;
        allComposite.push({
          adjustsPicked: adjustsPicked.slice(),
          addParts: ap.parts,
          adjustSum,
          addSum: ap.sum,
          addDirection,
          totalSum,
          adjustCount: adjustsPicked.length,
          addCount: ap.totalCount,
          totalCount: adjustsPicked.length + ap.totalCount,
          deviation: Math.abs(totalSum - targetGap)
        });
      });
    });
  }

  buildAdjustmentCandidates(adjOptions, maxAdjust, 2).forEach(candidate => {
    tryCombineWithAdds(candidate.picked, candidate.sum);
  });

  allComposite.sort((a, b) => {
    if (a.deviation !== b.deviation) return a.deviation - b.deviation;
    if (a.totalCount !== b.totalCount) return a.totalCount - b.totalCount;
    return a.adjustCount - b.adjustCount;
  });

  const seen = new Set();
  const unique = [];
  allComposite.forEach(p => {
    if (p.addCount === 0) return;
    const adjSig = p.adjustsPicked.map(o => `${o.npcIdx}:${o.toAdj}`).sort().join("|");
    const addSig = p.addParts.map(q => `${q.level}:${q.count}`).sort().join("|");
    const sig = `${adjSig}/${addSig}`;
    if (!seen.has(sig)) { seen.add(sig); unique.push(p); }
  });

  return {
    exact: unique.filter(p => p.deviation === 0).slice(0, maxResults),
    near: unique.filter(p => p.deviation > 0).slice(0, Math.max(2, Math.floor(maxResults / 2)))
  };
}

export function recompute(state) {
  if (!state.openingLevels) {
    state.openingLevels = state.npcs.map(n => effectiveLevel(n.baseLevel, n.currentAdjustment));
    state.openingHpPercents = state.npcs.map(n => n.currentHpPercent);
  }
  const baselineLevels = state.openingLevels;
  const baselineHpPercents = state.openingHpPercents;
  const npcLevels = state.npcs.map(n => effectiveLevel(n.baseLevel, n.previewAdjustment));
  state.npcLevels = npcLevels;
  state.baselineLevels = baselineLevels;
  const unboostedXP = calculateXP(state.partyLevel, state.partySize, npcLevels, state.hazardActors, state.pwol);
  state.baselineXP = calculateXPWithHpBoost(state.partyLevel, state.partySize, baselineLevels, baselineHpPercents, state.hazardActors, state.pwol);
  state.base4 = calculateXPWithHpBoost(state.partyLevel, 4, baselineLevels, baselineHpPercents, state.hazardActors, state.pwol);
  const baselineTarget = Math.ceil((state.base4.xpPerPlayer * state.partySize) / 4);
  state.targetTotal = state.targetMode === "custom"
    ? state.customTarget
    : DIFFICULTY_KEYS.includes(state.targetMode)
      ? unboostedXP.encounterBudgets[state.targetMode]
      : baselineTarget;
  const selectedCreatureXP = state.npcs.reduce((sum, npc, index) =>
    sum + (npc.previewHpBoost ? singleNpcXP(npcLevels[index], state.partyLevel, state.pwol) : 0), 0);
  state.fortifyPercent = requiredFortifyPercent(state.targetTotal, unboostedXP.totalXP, selectedCreatureXP);
  state.canFortify = state.targetTotal > unboostedXP.totalXP;
  state.npcs.forEach(npc => { npc.previewHpPercent = npc.previewHpBoost ? state.fortifyPercent : 0; });
  const hpPercents = state.npcs.map(n => n.previewHpPercent);
  state.xp = calculateXPWithHpBoost(state.partyLevel, state.partySize, npcLevels, hpPercents, state.hazardActors, state.pwol);
  state.gap = state.targetTotal - state.xp.totalXP;
  state.baselineGap = state.targetTotal - state.baselineXP.totalXP;
  state.options = state.gap < 0
    ? getRemovalOptions(
        state.npcs.map((npc, index) => ({ level: state.npcLevels[index], hpPercent: npc.previewHpPercent })),
        entity => `${entity.level}:${entity.hpPercent}`,
        entity => {
          const baseXP = singleNpcXP(entity.level, state.partyLevel, state.pwol);
          return {
            level: entity.level, delta: entity.level - state.partyLevel,
            xp: baseXP + Math.round(baseXP * entity.hpPercent * 0.01)
          };
        }
      )
    : getCreatureXpOptions(state.partyLevel, state.pwol);
  state.addPlans = buildFillPlans(Math.abs(state.gap), state.options);
  const simpleHazardOptions = state.gap < 0
    ? getRemovalOptions(
        state.hazards.filter(h => !h.isComplex),
        h => String(h.level),
        h => ({ level: h.level, delta: h.level - state.partyLevel, xp: hazardXpForLevel(h.level, state.partyLevel, false, state.pwol), isComplex: false })
      )
    : getHazardXpOptions(state.partyLevel, false, state.pwol);
  const complexHazardOptions = state.gap < 0
    ? getRemovalOptions(
        state.hazards.filter(h => h.isComplex),
        h => String(h.level),
        h => ({ level: h.level, delta: h.level - state.partyLevel, xp: hazardXpForLevel(h.level, state.partyLevel, true, state.pwol), isComplex: true })
      )
    : getHazardXpOptions(state.partyLevel, true, state.pwol);
  state.simpleHazardPlans = buildFillPlans(
    Math.abs(state.gap), simpleHazardOptions
  );
  state.complexHazardPlans = state.gap > 0
    ? state.addPlans
    : buildFillPlans(Math.abs(state.gap), complexHazardOptions);
  state.adjustOptions = buildAdjustOptions(state);
  state.adjustPlans = buildAdjustPlans(state.gap, state.adjustOptions, 5, 8);
  state.compositePlans = buildCompositePlans(
    state.gap, state.adjustOptions, state.addPlans, state.gap > 0, 4, 8
  );
}

export function planActions(item) {
  if (item.kind === "adjust") return 1;
  if (item.kind === "add") return item.plan.totalCount;
  if (item.kind === "composite") return 1 + item.plan.addCount;
  if (item.kind === "simple-hazard" || item.kind === "complex-hazard") return item.plan.totalCount;
  return 0;
}

export function kindRank(kind) {
  if (kind === "adjust") return 0;
  if (kind === "add") return 1;
  if (kind === "composite") return 2;
  if (kind === "simple-hazard") return 3;
  if (kind === "complex-hazard") return 4;
  return 3;
}

export function getAllPlans(state, includeNear) {
  const all = [];
  state.adjustPlans.exact.forEach((p, i) => all.push({ kind: "adjust", plan: p, sourceKey: "exact", sourceIdx: i }));
  state.addPlans.exact.forEach((p, i) => all.push({ kind: "add", plan: p, sourceKey: "exact", sourceIdx: i }));
  state.compositePlans.exact.forEach((p, i) => all.push({ kind: "composite", plan: p, sourceKey: "exact", sourceIdx: i }));
  if (includeNear) {
    state.adjustPlans.near.forEach((p, i) => all.push({ kind: "adjust", plan: p, sourceKey: "near", sourceIdx: i }));
    state.addPlans.near.forEach((p, i) => all.push({ kind: "add", plan: p, sourceKey: "near", sourceIdx: i }));
    state.compositePlans.near.forEach((p, i) => all.push({ kind: "composite", plan: p, sourceKey: "near", sourceIdx: i }));
  }
  all.forEach(item => {
    item.actions = planActions(item);
    item.deviation = item.plan.deviation || 0;
  });
  all.sort((a, b) => {
    if (a.deviation !== b.deviation) return a.deviation - b.deviation;
    if (a.actions !== b.actions) return a.actions - b.actions;
    return kindRank(a.kind) - kindRank(b.kind);
  });
  return all;
}

export function projectedTotal(state) {
  return Math.max(0, state.xp.totalXP + (state.previewActive ? state.virtualPlanDelta : 0));
}

export function ratingForTotal(total, budgets) {
  if (total <= budgets.trivial) return "trivial";
  if (total <= budgets.low) return "low";
  if (total <= budgets.moderate) return "moderate";
  if (total <= budgets.severe) return "severe";
  return "extreme";
}

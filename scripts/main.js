"use strict";

(function () {
  const MODULE_ID = "pf2e-xp-tool";

  const DialogClass =
    (typeof foundry !== "undefined" && foundry.appv1 && foundry.appv1.api && foundry.appv1.api.Dialog) ||
    globalThis.Dialog;

  const L = function (key) { return game.i18n.localize(key); };
  const T = function (key, data) {
    const full = `PF2EXPTool.${key}`;
    return data ? game.i18n.format(full, data) : game.i18n.localize(full);
  };

  // PF2e Elite/Weak adjustment math, mirroring pf2e.mjs:
  //   Elite: base < 1 ? base + 2 : base + 1   (-1->1, 0->2, 1->2, 2->3, ...)
  //   Weak:  base === 1 ? base - 2 : base - 1 (-1->-2, 0->-1, 1->-1, 2->1, 3->2, ...)
  function levelDelta(baseLevel, adj) {
    if (adj === "elite") return baseLevel < 1 ? 2 : 1;
    if (adj === "weak")  return baseLevel === 1 ? -2 : -1;
    return 0;
  }
  function effectiveLevel(baseLevel, adj) {
    return baseLevel + levelDelta(baseLevel, adj);
  }

  // Adjustment keys recognized by PF2e (system.attributes.adjustment).
  // Display label/short come from i18n; visual color is owned by CSS (.adj-text.{key}).
  const ADJ_KEYS = ["weak", "normal", "elite"];
  const ADJUSTMENTS = new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string" || !ADJ_KEYS.includes(key)) return undefined;
      return { label: T(`adj.${key}.label`), short: T(`adj.${key}.short`) };
    },
    has(_, key) { return typeof key === "string" && ADJ_KEYS.includes(key); }
  });

  // ---------------- helpers ----------------

  function clampInt(value, fallback) {
    const n = Math.abs(Math.trunc(Number(value)));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function clampFloat(value, fallback) {
    const n = Math.abs(Number(value));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.round(n * 100) / 100;
  }

  function signed(n) { return n >= 0 ? "+" + n : String(n); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getActorAdjustment(actor) {
    const adj = actor && actor.system && actor.system.attributes && actor.system.attributes.adjustment;
    return ADJUSTMENTS[adj] ? adj : "normal";
  }

  function getBaseLevel(actor) {
    if (!actor) return 0;
    // PF2e NPCs store base level (without elite/weak) at system.details.level.base
    const base = actor.system && actor.system.details && actor.system.details.level && actor.system.details.level.base;
    if (typeof base === "number") return base;
    // Fallback: derive base from actor.level (rarely hit; not always unique at boundaries)
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

  // ---------------- XP math ----------------

  // PF2e standard XP table (CRB Table 10-2, mirrors pf2e.mjs:30920+)
  const STANDARD_XP_MAP = {
    "-4": 10, "-3": 15, "-2": 20, "-1": 30, "0": 40,
    "1": 60, "2": 80, "3": 120, "4": 160
  };
  const PWOL_XP_MAP = {
    "-7": 9, "-6": 12, "-5": 14, "-4": 18, "-3": 21, "-2": 26, "-1": 32, "0": 40,
    "1": 48, "2": 60, "3": 72, "4": 90, "5": 108, "6": 135, "7": 160
  };

  function xpForDelta(delta, pwol) {
    const map = pwol ? PWOL_XP_MAP : STANDARD_XP_MAP;
    const range = pwol ? 7 : 4;
    const bounded = Math.max(-range, Math.min(range, delta));
    return map[String(bounded)] || 0;
  }

  function calculateXP(partyLevel, partySize, npcLevels, hazards, pwol) {
    return game.pf2e.gm.calculateXP(partyLevel, partySize, npcLevels, hazards, { pwol: pwol });
  }

  function singleNpcXP(level, partyLevel, pwol) {
    return xpForDelta(level - partyLevel, pwol);
  }

  function getCreatureXpOptions(partyLevel, pwol) {
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

  function insertPlan(map, sum, plan, maxPerSum) {
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

  function buildFillPlans(target, options) {
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
      const maxTake = Math.max(0, Math.min(maxByCount, maxBySum));
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

  function buildAdjustOptions(state) {
    const options = [];
    state.npcs.forEach((npc, idx) => {
      const fromAdj = npc.previewAdjustment;
      const fromLevel = effectiveLevel(npc.baseLevel, fromAdj);
      const fromXP = singleNpcXP(fromLevel, state.partyLevel, state.pwol);
      ["weak", "normal", "elite"].forEach(toAdj => {
        if (toAdj === fromAdj) return;
        const toLevel = effectiveLevel(npc.baseLevel, toAdj);
        if (toLevel < -1) return;
        const toXP = singleNpcXP(toLevel, state.partyLevel, state.pwol);
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

  function buildAdjustPlans(targetGap, adjOptions, maxAdjust, maxResults) {
    if (adjOptions.length === 0) return { exact: [], near: [] };
    const byNpc = new Map();
    adjOptions.forEach(o => {
      if (!byNpc.has(o.npcIdx)) byNpc.set(o.npcIdx, []);
      byNpc.get(o.npcIdx).push(o);
    });
    const npcIdxs = Array.from(byNpc.keys());
    const raw = [];

    function dfs(idx, sum, picked) {
      if (picked.length > maxAdjust) return;
      if (idx >= npcIdxs.length) {
        if (picked.length > 0) {
          raw.push({
            sum, picked: picked.slice(),
            deviation: Math.abs(sum - targetGap),
            count: picked.length
          });
        }
        return;
      }
      dfs(idx + 1, sum, picked);
      const opts = byNpc.get(npcIdxs[idx]);
      for (let i = 0; i < opts.length; i++) {
        picked.push(opts[i]);
        dfs(idx + 1, sum + opts[i].deltaXP, picked);
        picked.pop();
      }
    }

    dfs(0, 0, []);

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

  function buildCompositePlans(targetGap, adjOptions, addPlansResult, isAdd, maxAdjust, maxResults) {
    if (!adjOptions || adjOptions.length === 0) return { exact: [], near: [] };
    const addBySum = (addPlansResult && addPlansResult.bySum) || new Map();
    if (addBySum.size === 0) return { exact: [], near: [] };

    const byNpc = new Map();
    adjOptions.forEach(o => {
      if (!byNpc.has(o.npcIdx)) byNpc.set(o.npcIdx, []);
      byNpc.get(o.npcIdx).push(o);
    });
    const npcIdxs = Array.from(byNpc.keys());

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

    function dfsAdjust(idx, adjustSum, adjustsPicked) {
      if (adjustsPicked.length > maxAdjust) return;
      if (adjustsPicked.length >= 1) tryCombineWithAdds(adjustsPicked, adjustSum);
      if (idx >= npcIdxs.length) return;
      dfsAdjust(idx + 1, adjustSum, adjustsPicked);
      const opts = byNpc.get(npcIdxs[idx]);
      for (let i = 0; i < opts.length; i++) {
        adjustsPicked.push(opts[i]);
        dfsAdjust(idx + 1, adjustSum + opts[i].deltaXP, adjustsPicked);
        adjustsPicked.pop();
      }
    }

    dfsAdjust(0, 0, []);

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

  function recompute(state) {
    if (!state.openingLevels) {
      state.openingLevels = state.npcs.map(n => effectiveLevel(n.baseLevel, n.currentAdjustment));
    }
    const baselineLevels = state.openingLevels;
    const npcLevels = state.npcs.map(n => effectiveLevel(n.baseLevel, n.previewAdjustment));
    state.npcLevels = npcLevels;
    state.baselineLevels = baselineLevels;
    state.xp = calculateXP(state.partyLevel, state.partySize, npcLevels, state.hazardActors, state.pwol);
    state.baselineXP = calculateXP(state.partyLevel, state.partySize, baselineLevels, state.hazardActors, state.pwol);
    state.base4 = calculateXP(state.partyLevel, 4, baselineLevels, state.hazardActors, state.pwol);
    state.targetTotal = Math.ceil((state.base4.xpPerPlayer * state.partySize) / 4);
    state.gap = state.targetTotal - state.xp.totalXP;
    state.baselineGap = state.targetTotal - state.baselineXP.totalXP;
    state.options = getCreatureXpOptions(state.partyLevel, state.pwol);
    state.addPlans = buildFillPlans(Math.abs(state.gap), state.options);
    state.adjustOptions = buildAdjustOptions(state);
    state.adjustPlans = buildAdjustPlans(state.gap, state.adjustOptions, 5, 8);
    state.compositePlans = buildCompositePlans(
      state.gap, state.adjustOptions, state.addPlans, state.gap > 0, 4, 8
    );
  }

  // ---------------- operation count / unified plan list ----------------

  function planActions(item) {
    if (item.kind === "adjust") return item.plan.picked.length;
    if (item.kind === "add") return item.plan.totalCount;
    if (item.kind === "composite") return item.plan.adjustCount + item.plan.addCount;
    return 0;
  }

  function kindRank(kind) {
    if (kind === "adjust") return 0;
    if (kind === "add") return 1;
    if (kind === "composite") return 2;
    return 3;
  }

  function getAllPlans(state, includeNear) {
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


  // ---------------- render: header / progress / gap ----------------

  function renderHeader(state) {
    const threatLabel = L("PF2E.Encounter.Budget.Threats." + state.xp.rating);
    return `
      <div class="xp-header">
        <div class="xp-stat">
          <div class="xp-stat-label">${T("header.partySize")}</div>
          <div class="xp-stat-value">
            <input type="number" class="xp-input party-size-input" value="${state.partySize}" min="1" step="0.5">
          </div>
        </div>
        <div class="xp-stat">
          <div class="xp-stat-label">${T("header.partyLevel")}</div>
          <div class="xp-stat-value">
            <input type="number" class="xp-input party-level-input" value="${state.partyLevel}" min="1">
          </div>
        </div>
        <div class="xp-stat threat ${state.xp.rating}">
          <div class="xp-stat-label">${T("header.threat")}</div>
          <div class="xp-stat-value">${threatLabel}</div>
        </div>
      </div>
    `;
  }

  function renderProgressBar(state) {
    const current = state.xp.totalXP;
    const target = state.targetTotal;
    let max = Math.max(current, target);
    if (max === 0) max = 1;
    max = max * 1.15;
    const currentPct = Math.min(100, (current / max) * 100);
    const targetPct = Math.min(100, (target / max) * 100);
    const ratio = target > 0 ? current / target : 1;
    const fillCls = ratio < 0.95 ? "under" : (ratio <= 1.05 ? "match" : "over");
    const gap = state.gap;
    let gapHtml;
    if (gap === 0) gapHtml = `<span class="gap-label match">${T("gap.match")}</span>`;
    else if (gap > 0) gapHtml = `<span class="gap-label under">${T("gap.under", { n: gap })}</span>`;
    else                gapHtml = `<span class="gap-label over">${T("gap.over",  { n: Math.abs(gap) })}</span>`;
    return `
      <div class="xp-bar-wrap">
        <div class="xp-bar-labels">
          <span>${T("progress.currentTarget", { current, target })}</span>
          ${gapHtml}
        </div>
        <div class="xp-bar">
          <div class="xp-bar-fill ${fillCls}" style="width:${currentPct}%"></div>
          <div class="xp-bar-target" style="left:${targetPct}%"></div>
        </div>
      </div>
    `;
  }

  // ---------------- render: NPC list ----------------

  function renderNpcCard(npc, idx, state) {
    const finalLevel = effectiveLevel(npc.baseLevel, npc.previewAdjustment);
    const changed = npc.previewAdjustment !== npc.currentAdjustment;
    const adjKey = npc.previewAdjustment;
    const npcXP = singleNpcXP(finalLevel, state.partyLevel, state.pwol);

    const buttons = ["weak", "normal", "elite"].map(a => {
      const active = adjKey === a ? ` active adj-${a}` : "";
      return `<button type="button" class="adj-btn${active}" data-npc-idx="${idx}" data-adj="${a}" title="${ADJUSTMENTS[a].label}">${ADJUSTMENTS[a].short}</button>`;
    }).join("");

    return `
      <div class="npc-card${changed ? " changed" : ""}">
        <div class="npc-name">${escapeHtml(npc.name)}${changed ? ' <span class="changed-dot">●</span>' : ""}</div>
        <div class="npc-level ${adjKey}">Lv ${finalLevel}</div>
        <div class="npc-xp">${npcXP} XP</div>
        <div class="adj-toggle">${buttons}</div>
      </div>
    `;
  }

  function renderNpcSection(state) {
    const hasContent = state.npcs.length > 0 || state.hazards.length > 0;
    if (!hasContent) {
      return `<details open><summary>${T("npc.selectedUnits")}</summary><div class="details-body"><p class="empty-msg">${T("npc.empty")}</p></div></details>`;
    }
    const npcsHtml = state.npcs.map((n, i) => renderNpcCard(n, i, state)).join("");
    let hazardsHtml = "";
    if (state.hazards.length > 0) {
      hazardsHtml = `<div class="hazard-list"><strong>${T("npc.hazardsLabel")}</strong>${
        state.hazards.map(h => `<span>${escapeHtml(h.name)} Lv ${h.level}</span>`).join("")
      }</div>`;
    }
    const changedCount = state.npcs.filter(n => n.previewAdjustment !== n.currentAdjustment).length;
    const summaryExtra = changedCount > 0
      ? ` <span class="pending-tag">${T("npc.pendingApply", { n: changedCount })}</span>`
      : "";
    const summaryBody = state.hazards.length > 0
      ? T("npc.summaryWithHazards", { npcs: state.npcs.length, hazards: state.hazards.length })
      : T("npc.summary", { npcs: state.npcs.length });
    const summary = `${T("npc.selectedUnits")} (${summaryBody})${summaryExtra}`;
    return `<details open><summary>${summary}</summary><div class="details-body">${npcsHtml}${hazardsHtml}</div></details>`;
  }

  // ---------------- render: plan rows (one-line each) ----------------

  // Renders a single-line description of a plan, free of HTML.
  function planDesc(item, state) {
    const kind = item.kind;
    const plan = item.plan;
    if (kind === "add") {
      const parts = plan.parts.map(p => `${p.count}× Lv ${p.level}`).join(" + ");
      return T(state.gap > 0 ? "plans.addDesc" : "plans.removeDesc", { parts });
    }
    if (kind === "adjust") return adjustDesc(plan.picked);
    if (kind === "composite") {
      const adj = adjustDesc(plan.adjustsPicked);
      const adds = plan.addParts.map(p => `${p.count}× Lv ${p.level}`).join(" + ");
      const add = T(state.gap > 0 ? "plans.addDesc" : "plans.removeDesc", { parts: adds });
      return T("plans.compositeDesc", { adjust: adj, add });
    }
    return "";
  }

  function adjustDesc(picked) {
    if (!picked || picked.length === 0) return "";
    const fmt = (op) => ({ name: op.npcName, to: ADJUSTMENTS[op.toAdj].label });
    if (picked.length === 1) return T("plans.adjustDescOne", fmt(picked[0]));
    if (picked.length === 2) {
      return T("plans.adjustDescTwo", {
        a: picked[0].npcName, ta: ADJUSTMENTS[picked[0].toAdj].label,
        b: picked[1].npcName, tb: ADJUSTMENTS[picked[1].toAdj].label
      });
    }
    return T("plans.adjustDescMore", { ...fmt(picked[0]), extra: picked.length - 1 });
  }

  function planSumSigned(item, state) {
    const kind = item.kind;
    if (kind === "adjust") return item.plan.sum;
    if (kind === "composite") return item.plan.totalSum;
    return state.gap > 0 ? item.plan.sum : -item.plan.sum;
  }

  function planIconHtml(item, state) {
    const kind = item.kind;
    if (kind === "adjust") return '<i class="fas fa-sliders"></i>';
    if (kind === "composite") return '<i class="fas fa-shuffle"></i>';
    return state.gap > 0 ? '<i class="fas fa-plus"></i>' : '<i class="fas fa-minus"></i>';
  }

  function renderPlanItem(item, state) {
    const kind = item.kind;
    const plan = item.plan;
    const sum = planSumSigned(item, state);
    const sumCls = sum >= 0 ? "positive" : "negative";
    const sumLabel = (sum >= 0 ? "+" : "") + sum;
    const ops = planActions(item);
    const desc = escapeHtml(planDesc(item, state));
    const clickable = (kind === "adjust" || kind === "composite");
    const dev = plan.deviation > 0
      ? ` <span class="plan-deviation">≈${plan.deviation}</span>`
      : "";
    const titleAttr = clickable ? ` title="${T("plans.previewHint")}"` : "";
    const data = `data-plan-kind="${kind}" data-plan-source="${item.sourceKey || ""}" data-plan-idx="${item.sourceIdx != null ? item.sourceIdx : ""}"`;
    return `
      <div class="plan-row ${kind}${clickable ? " clickable" : ""}" ${data}${titleAttr}>
        <span class="plan-icon">${planIconHtml(item, state)}</span>
        <span class="plan-desc">${desc}${dev}</span>
        <span class="plan-sum ${sumCls}">${sumLabel}</span>
        <span class="plan-ops">${T("card.ops", { n: ops })}</span>
      </div>
    `;
  }

  // ---------------- render: plans section (auto fallback, top N, by ops) ----------------

  function renderPlansSection(state) {
    if (state.gap === 0) {
      return `<details open><summary>${T("plans.title")}</summary><div class="details-body"><p class="empty-msg">${T("plans.done")}</p></div></details>`;
    }
    const MAX_SHOWN = 8;
    const exactAll = getAllPlans(state, false);
    let all = exactAll;
    let usedFallback = false;
    if (exactAll.length < 3) {
      all = getAllPlans(state, true);
      usedFallback = exactAll.length === 0;
    }
    if (all.length === 0) {
      return `<details open><summary>${T("plans.title")}</summary><div class="details-body"><p class="empty-msg">${T("plans.empty")}</p></div></details>`;
    }
    const top = all.slice(0, MAX_SHOWN);
    const summary = all.length > top.length
      ? T("plans.titleWithCount", { shown: top.length, total: all.length })
      : T("plans.title");
    const fallbackNote = usedFallback
      ? `<div class="plan-note">${T("plans.noteFallback")}</div>`
      : "";
    return `
      <details open>
        <summary>${summary}</summary>
        <div class="details-body">
          ${fallbackNote}
          ${top.map(item => renderPlanItem(item, state)).join("")}
        </div>
      </details>
    `;
  }

  // ---------------- render: reference table + footer actions ----------------

  // Always renders the full Table 10-2 (9 rows / 15 for PWoL) with the Suggested Role column
  function getReferenceTable(partyLevel, pwol) {
    const minDelta = pwol ? -7 : -4;
    const maxDelta = pwol ? 7 : 4;
    const rows = [];
    for (let delta = minDelta; delta <= maxDelta; delta++) {
      const level = partyLevel + delta;
      const xp = xpForDelta(delta, pwol);
      const exists = level >= -1;
      const roleKey = !pwol && delta >= -4 && delta <= 4 ? `ref.role.${delta >= 0 ? "p" + delta : "n" + (-delta)}` : null;
      rows.push({ delta, level, xp, exists, roleKey });
    }
    return rows;
  }

  function renderReferenceSection(state) {
    const ref = getReferenceTable(state.partyLevel, state.pwol);
    const rows = ref.map(o => {
      const rowCls = (o.delta === 0 ? " party" : "") + (!o.exists ? " missing" : "");
      const levelCell = o.exists
        ? `Lv ${o.level}`
        : `Lv ${o.level} <span class="ref-na">(N/A)</span>`;
      const role = o.roleKey ? T(o.roleKey) : "";
      return `<tr class="ref-row${rowCls}"><td>${levelCell}</td><td>${signed(o.delta)}</td><td>${o.xp}</td><td class="role">${role}</td></tr>`;
    }).join("");
    return `
      <details>
        <summary>${T("ref.title")}</summary>
        <div class="details-body">
          <table class="ref-table">
            <thead><tr><th>${T("ref.level")}</th><th>${T("ref.vsParty")}</th><th>${T("ref.xp")}</th><th>${T("ref.roleHeader")}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="ref-note">${T("ref.note")}</div>
        </div>
      </details>
    `;
  }

  function renderActions(state) {
    const changedCount = state.npcs.filter(n => n.previewAdjustment !== n.currentAdjustment).length;
    const canAct = changedCount > 0;
    const dis = canAct ? "" : " disabled";
    return `
      <div class="btn-row">
        <button type="button" id="reset-btn"${dis}>${T("btn.reset")}</button>
        <div class="spacer"></div>
        <button type="button" class="bright" id="apply-btn"${dis}>
          ${canAct ? T("btn.applyN", { n: changedCount }) : T("btn.noChanges")}
        </button>
      </div>
    `;
  }

  function renderContent(state) {
    return `
      <div class="xp-tool">
        ${renderHeader(state)}
        ${renderProgressBar(state)}
        ${renderNpcSection(state)}
        ${renderPlansSection(state)}
        ${renderReferenceSection(state)}
        ${renderActions(state)}
      </div>
    `;
  }

  // ---------------- apply templates (write back to token / actor) ----------------

  async function applyAdjustments(state) {
    const changed = state.npcs.filter(n => n.previewAdjustment !== n.currentAdjustment);
    if (changed.length === 0) return { applied: 0, failed: [] };
    const failed = [];
    let applied = 0;
    for (const npc of changed) {
      const actor = (npc.token && npc.token.actor) || (game.actors && game.actors.get(npc.actorId));
      if (!actor) { failed.push(npc.name); continue; }
      try {
        const value = npc.previewAdjustment === "normal" ? null : npc.previewAdjustment;
        if (typeof actor.applyAdjustment === "function") {
          await actor.applyAdjustment(value);
        } else {
          await actor.update({ "system.attributes.adjustment": value });
        }
        npc.currentAdjustment = npc.previewAdjustment;
        applied++;
      } catch (e) {
        console.error(`[${MODULE_ID}] ${T("notif.applyFailed")}:`, npc.name, e);
        failed.push(npc.name);
      }
    }
    return { applied, failed };
  }

  // ---------------- listeners ----------------

  function attachListeners(rootEl, state, refresh) {
    rootEl.querySelectorAll(".adj-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        const idx = Number(btn.dataset.npcIdx);
        const adj = btn.dataset.adj;
        if (state.npcs[idx] && ADJUSTMENTS[adj]) {
          state.npcs[idx].previewAdjustment = adj;
          refresh();
        }
      });
    });

    rootEl.querySelectorAll(".plan-row.clickable").forEach(row => {
      row.addEventListener("click", e => {
        e.preventDefault();
        const kind = row.dataset.planKind;
        const sourceKey = row.dataset.planSource;
        const idx = Number(row.dataset.planIdx);
        let plan;
        if (kind === "adjust") plan = state.adjustPlans[sourceKey] && state.adjustPlans[sourceKey][idx];
        else if (kind === "composite") plan = state.compositePlans[sourceKey] && state.compositePlans[sourceKey][idx];
        if (!plan) return;
        const picked = kind === "composite" ? plan.adjustsPicked : plan.picked;
        picked.forEach(op => {
          if (state.npcs[op.npcIdx]) state.npcs[op.npcIdx].previewAdjustment = op.toAdj;
        });
        refresh();
      });
    });

    const sizeInput = rootEl.querySelector(".party-size-input");
    if (sizeInput) {
      sizeInput.addEventListener("change", e => {
        const v = clampFloat(e.target.value, state.partySize);
        if (v !== state.partySize) {
          state.partySize = v;
          try { localStorage.setItem("xpMacroPartySize", String(v)); } catch (_) {}
          refresh();
        }
      });
    }

    const levelInput = rootEl.querySelector(".party-level-input");
    if (levelInput) {
      levelInput.addEventListener("change", e => {
        const v = clampInt(e.target.value, state.partyLevel);
        if (v !== state.partyLevel) {
          state.partyLevel = v;
          try { localStorage.setItem("xpMacroPartyLevel", String(v)); } catch (_) {}
          refresh();
        }
      });
    }

    rootEl.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
        e.preventDefault();
        e.target.blur();
      }
    });

    const resetBtn = rootEl.querySelector("#reset-btn");
    if (resetBtn && !resetBtn.disabled) {
      resetBtn.addEventListener("click", () => {
        state.npcs.forEach(n => { n.previewAdjustment = n.currentAdjustment; });
        refresh();
      });
    }

    const applyBtn = rootEl.querySelector("#apply-btn");
    if (applyBtn && !applyBtn.disabled) {
      applyBtn.addEventListener("click", async () => {
        applyBtn.disabled = true;
        applyBtn.textContent = T("btn.applying");
        const result = await applyAdjustments(state);
        if (result.failed.length === 0) {
          ui.notifications.info(T("notif.applied", { n: result.applied }));
        } else {
          ui.notifications.warn(T("notif.partialApplied", { applied: result.applied, names: result.failed.join(", ") }));
        }
        refresh();
      });
    }
  }

  // ---------------- dialog ----------------

  function showXPTool(state) {
    recompute(state);
    let dialog;
    const rootRef = { el: null };

    function refresh() {
      recompute(state);
      if (!rootRef.el) return;
      rootRef.el.innerHTML = renderContent(state);
      attachListeners(rootRef.el, state, refresh);
      if (dialog && dialog.setPosition) {
        try { dialog.setPosition({ height: "auto" }); } catch (_) {}
      }
    }

    dialog = new DialogClass({
      title: T("title"),
      content: renderContent(state),
      buttons: { close: { icon: '<i class="fas fa-times"></i>', label: T("btn.close") } },
      default: "close",
      render: html => {
        const formEl = (html && html[0]) || html;
        if (!formEl) return;
        const contentEl = (formEl.querySelector && formEl.querySelector(".dialog-content")) || formEl;
        rootRef.el = contentEl;
        attachListeners(contentEl, state, refresh);
      }
    }, { width: 600, resizable: true });

    dialog.render(true);
  }

  // ---------------- selection / entry points ----------------

  function buildNpcs(tokens) {
    return tokens.filter(t => {
      const a = t && t.actor;
      if (!a) return false;
      if (a.alliance !== "opposition") return false;
      if (a.type === "hazard") return false;
      if (a.traits && a.traits.has && a.traits.has("minion")) return false;
      return true;
    }).map(t => {
      const actor = t.actor;
      const adj = getActorAdjustment(actor);
      return {
        token: t, actorId: actor.id,
        name: t.name || actor.name,
        baseLevel: getBaseLevel(actor),
        currentAdjustment: adj,
        previewAdjustment: adj
      };
    });
  }

  function buildHazards(tokens) {
    return tokens.filter(t => t && t.actor && t.actor.type === "hazard")
      .map(t => ({ name: t.name || t.actor.name, level: t.actor.level }));
  }

  function getHazardActors(tokens) {
    return tokens.map(t => t && t.actor).filter(a => a && a.type === "hazard");
  }

  function getPCs(tokens) {
    return tokens.filter(t => {
      const a = t && t.actor;
      return !!a && a.alliance === "party" && !(a.traits && a.traits.has && a.traits.has("minion"));
    }).map(t => t.actor);
  }

  function openTool(partyLevel, partySize, npcs, hazards, hazardActors) {
    const pwol = !!(game.pf2e && game.pf2e.settings && game.pf2e.settings.variants &&
      game.pf2e.settings.variants.pwol && game.pf2e.settings.variants.pwol.enabled);
    showXPTool({ partyLevel, partySize, npcs, hazards, hazardActors, pwol });
  }

  function askPartyAndOpen(npcs, hazards, hazardActors) {
    const savedSize = clampFloat(localStorage.getItem("xpMacroPartySize"), 4);
    const savedLevel = clampInt(localStorage.getItem("xpMacroPartyLevel"), 1);
    const content = `
      <form>
        <div class="form-group">
          <label>${L("PF2E.Encounter.Budget.PartySize")}</label>
          <input name="party-size" type="number" value="${savedSize}" min="1" step="0.5">
        </div>
        <div class="form-group">
          <label>${L("PF2E.Encounter.Budget.PartyLevel")}</label>
          <input name="party-level" type="number" value="${savedLevel}" min="1">
        </div>
      </form>
    `;
    new DialogClass({
      title: T("partyDialogTitle"),
      content,
      buttons: {
        no: { icon: '<i class="fas fa-times"></i>', label: T("btn.cancel") },
        yes: {
          icon: '<i class="fas fa-calculator"></i>',
          label: T("btn.calculate"),
          callback: html => {
            const root = (html && html[0]) || html;
            const partySize = clampFloat(root.querySelector('[name="party-size"]').value, 4);
            const partyLevel = clampInt(root.querySelector('[name="party-level"]').value, 1);
            try {
              localStorage.setItem("xpMacroPartySize", String(partySize));
              localStorage.setItem("xpMacroPartyLevel", String(partyLevel));
            } catch (_) {}
            openTool(partyLevel, partySize, npcs, hazards, hazardActors);
          }
        }
      },
      default: "yes"
    }).render(true);
  }

  function openFromSelection() {
    if (!game.user || !game.user.isGM) {
      ui.notifications.warn(T("notif.gmOnly"));
      return;
    }
    const tokens = (canvas && canvas.tokens && canvas.tokens.controlled) || [];
    const npcs = buildNpcs(tokens);
    const hazards = buildHazards(tokens);
    const hazardActors = getHazardActors(tokens);
    if (npcs.length === 0 && hazardActors.length === 0) {
      ui.notifications.error(T("notif.needSelection"));
      return;
    }
    const pcs = getPCs(tokens);
    if (pcs.length === 0) askPartyAndOpen(npcs, hazards, hazardActors);
    else openTool(pcs[0].level, pcs.length, npcs, hazards, hazardActors);
  }

  // ---------------- public API + hooks ----------------

  globalThis.PF2EXPTool = { open: openFromSelection };

  function injectButton(app, html) {
    const root = (html && html.length !== undefined && html[0]) ? html[0] : (html && html.querySelector ? html : null);
    if (!root || !root.querySelector) return;
    if (!game.user || !game.user.isGM) return;
    if (root.querySelector(`.${MODULE_ID}-btn`)) return;
    const target =
      root.querySelector(".directory-footer.action-buttons") ||
      root.querySelector(".directory-footer") ||
      root.querySelector("footer.action-buttons") ||
      root.querySelector("footer") ||
      root;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${MODULE_ID}-btn`;
    btn.innerHTML = `<i class="fas fa-calculator"></i> ${T("buttonLabel")}`;
    btn.addEventListener("click", () => openFromSelection());
    target.appendChild(btn);
  }

  // ---------------- i18n source-of-truth (inlined, overrides any stale lang-file cache) ----------------
  // Foundry only loads lang/*.json on world start. A stale cached cn.json with old
  // placeholders ({gap}/{per}) plus new JS that passes {n} produces "需补 undefined
  // XP". We treat the JS-inlined dict as authoritative and overwrite the merged
  // PF2EXPTool subtree at i18nInit so placeholders always match.
  const I18N_FALLBACK = {
    en: {
      title: "PF2E XP Budget Tool", buttonLabel: "PF2E XP Budget", partyDialogTitle: "Party Info",
      adj: { weak: { label: "Weak", short: "W" }, normal: { label: "Normal", short: "N" }, elite: { label: "Elite", short: "E" } },
      header: { partySize: "Size", partyLevel: "Level", threat: "Threat" },
      progress: { currentTarget: "{current} / {target} XP" },
      gap: { match: "On target ✓", under: "{n} short", over: "{n} over" },
      npc: {
        selectedUnits: "Selected units", empty: "No opposition or hazard token selected.",
        hazardsLabel: "Hazards: ", pendingApply: "({n} pending)",
        summary: "{npcs} creature(s)", summaryWithHazards: "{npcs} creature(s) / {hazards} hazard(s)"
      },
      btn: {
        cancel: "Cancel", calculate: "Calculate XP", close: "Close", reset: "Reset preview",
        applyN: "Apply {n} template change(s)", noChanges: "No pending changes",
        applying: "Applying…", previewPlan: "Preview this plan"
      },
      notif: {
        gmOnly: "GM-only tool",
        needSelection: "Select at least one opposition or hazard token in the scene (PCs optional)",
        applied: "Applied {n} template change(s)",
        partialApplied: "Applied {applied}; failed: {names}",
        applyFailed: "Failed to apply template"
      },
      plans: {
        title: "Suggested plans", titleWithCount: "Suggested plans ({shown}/{total})",
        done: "Target met, nothing to adjust ✓", empty: "No plans available",
        noteFallback: "No exact plans; showing closest approximations",
        addDesc: "Add {parts}", removeDesc: "Remove {parts}",
        adjustDescOne: "{name} → {to}",
        adjustDescTwo: "{a} → {ta}, {b} → {tb}",
        adjustDescMore: "{name} → {to} +{extra} more",
        compositeDesc: "{adjust} + {add}", previewHint: "Click row to preview"
      },
      card: { ops: "{n} op(s)" },
      ref: {
        title: "Per-creature XP reference (Table 10-2)",
        level: "Level", vsParty: "vs party", xp: "XP", roleHeader: "Suggested role",
        note: "Rows marked N/A are below Lv -1: PF2e has no such creatures, shown for XP-table reference only.",
        role: {
          n4: "Low-threat lackey", n3: "Low- or moderate-threat lackey",
          n2: "Any lackey or standard creature", n1: "Any standard creature",
          p0: "Any standard creature or low-threat boss",
          p1: "Low- or moderate-threat boss", p2: "Moderate- or severe-threat boss",
          p3: "Severe- or extreme-threat boss", p4: "Extreme-threat solo boss"
        }
      }
    },
    cn: {
      title: "PF2E XP 预算工具", buttonLabel: "PF2E XP 预算工具", partyDialogTitle: "队伍信息",
      adj: { weak: { label: "弱小", short: "弱" }, normal: { label: "普通", short: "普" }, elite: { label: "精英", short: "精" } },
      header: { partySize: "人数", partyLevel: "等级", threat: "威胁" },
      progress: { currentTarget: "{current} / {target} XP" },
      gap: { match: "达标 ✓", under: "缺 {n}", over: "超 {n}" },
      npc: {
        selectedUnits: "已选单位", empty: "未选择任何敌对或陷阱单位。",
        hazardsLabel: "陷阱：", pendingApply: "({n} 项待应用)",
        summary: "{npcs} 怪物", summaryWithHazards: "{npcs} 怪物 / {hazards} 陷阱"
      },
      btn: {
        cancel: "取消", calculate: "计算 XP", close: "关闭", reset: "重置预览",
        applyN: "应用 {n} 项模板更改", noChanges: "无待应用更改",
        applying: "应用中…", previewPlan: "预览此方案"
      },
      notif: {
        gmOnly: "此工具仅限 GM 使用",
        needSelection: "请至少在场景中选中一个敌对或陷阱 Token（可额外选择 PC）",
        applied: "已应用 {n} 项模板",
        partialApplied: "已应用 {applied} 项；失败：{names}",
        applyFailed: "应用模板失败"
      },
      plans: {
        title: "推荐方案", titleWithCount: "推荐方案 ({shown}/{total})",
        done: "已达成目标，无需调整 ✓", empty: "无可用方案",
        noteFallback: "无精确方案，显示最接近的近似方案",
        addDesc: "添加 {parts}", removeDesc: "移除 {parts}",
        adjustDescOne: "{name} → {to}",
        adjustDescTwo: "{a} → {ta}, {b} → {tb}",
        adjustDescMore: "{name} → {to} +{extra} 项",
        compositeDesc: "{adjust} + {add}", previewHint: "点击行预览"
      },
      card: { ops: "{n} 步" },
      ref: {
        title: "单只怪贡献参考表 (Table 10-2)",
        level: "等级", vsParty: "vs 队伍", xp: "XP", roleHeader: "建议角色",
        note: "标 N/A 的等级低于 -1，PF2e 中不存在该等级的怪物，仅作 XP 数值参考。",
        role: {
          n4: "低威胁喽啰", n3: "低/中威胁喽啰",
          n2: "任意喽啰或标准生物", n1: "任意标准生物",
          p0: "任意标准生物或低威胁 boss",
          p1: "低/中威胁 boss", p2: "中/重威胁 boss",
          p3: "重/极端威胁 boss", p4: "极端威胁独行 boss"
        }
      }
    }
  };
  const I18N_LANG_ALIAS = { "zh-CN": "cn", "zh-Hans": "cn", "zh": "cn" };

  Hooks.once("i18nInit", () => {
    const lang = (game.i18n && game.i18n.lang) || "en";
    const key = I18N_FALLBACK[lang] ? lang : (I18N_LANG_ALIAS[lang] || "en");
    // Wholesale replace: inlined dict is authoritative.
    game.i18n.translations.PF2EXPTool = foundry.utils.deepClone(I18N_FALLBACK[key] || I18N_FALLBACK.en);
  });

  Hooks.once("init", () => {
    console.log(`${MODULE_ID} | init`);
  });

  Hooks.on("renderMacroDirectory", injectButton);
  Hooks.on("renderActorDirectory", injectButton);
  Hooks.on("renderMacroDirectoryV2", injectButton);
  Hooks.on("renderActorDirectoryV2", injectButton);

})();

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
            Lv <input type="number" class="xp-input party-level-input" value="${state.partyLevel}" min="1">
          </div>
        </div>
        <div class="xp-stat threat ${state.xp.rating}">
          <div class="xp-stat-label">${T("header.threat")}</div>
          <div class="xp-stat-value">${threatLabel}</div>
        </div>
        <div class="xp-stat">
          <div class="xp-stat-label">${T("header.totalPerPlayer")}</div>
          <div class="xp-stat-value">${state.xp.totalXP} / ${state.xp.xpPerPlayer}</div>
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
    return `
      <div class="xp-bar-wrap">
        <div class="xp-bar-labels">
          <span>${T("progress.currentLabel")} <strong>${current}</strong> XP</span>
          <span>${T("progress.targetLabel")} <strong>${target}</strong> XP</span>
        </div>
        <div class="xp-bar">
          <div class="xp-bar-fill ${fillCls}" style="width:${currentPct}%"></div>
          <div class="xp-bar-target" style="left:${targetPct}%"></div>
          <div class="xp-bar-text">${Math.round(ratio * 100)}%</div>
        </div>
      </div>
    `;
  }

  function renderGapBanner(state) {
    const gap = state.gap;
    if (gap === 0) return `<div class="gap-banner match">${T("gap.match")}</div>`;
    if (gap > 0) {
      return `<div class="gap-banner under">${T("gap.under", { gap, per: Math.round(gap / state.partySize) })}</div>`;
    }
    const abs = Math.abs(gap);
    return `<div class="gap-banner over">${T("gap.over", { abs, per: Math.round(abs / state.partySize) })}</div>`;
  }

  // ---------------- render: NPC list ----------------

  function renderNpcCard(npc, idx, state) {
    const finalLevel = effectiveLevel(npc.baseLevel, npc.previewAdjustment);
    const changed = npc.previewAdjustment !== npc.currentAdjustment;
    const adj = ADJUSTMENTS[npc.previewAdjustment];
    const npcXP = singleNpcXP(finalLevel, state.partyLevel, state.pwol);

    let metaHtml;
    if (npc.previewAdjustment === "normal") {
      metaHtml = `<span>Lv ${finalLevel}</span><span class="meta-xp">${npcXP} XP</span>`;
    } else {
      metaHtml = `
        <span class="meta-base">${T("npc.baseLevel", { lv: npc.baseLevel })}</span>
        <span class="meta-arrow">→</span>
        <span class="adj-text ${npc.previewAdjustment}">${adj.label} Lv ${finalLevel}</span>
        <span class="meta-xp">${npcXP} XP</span>
      `;
    }

    const buttons = ["weak", "normal", "elite"].map(a => {
      const active = npc.previewAdjustment === a ? ` active adj-${a}` : "";
      return `<button type="button" class="adj-btn${active}" data-npc-idx="${idx}" data-adj="${a}" title="${ADJUSTMENTS[a].label}">${ADJUSTMENTS[a].short}</button>`;
    }).join("");

    return `
      <div class="npc-card${changed ? " changed" : ""}">
        <div class="npc-info">
          <div class="npc-name">${escapeHtml(npc.name)}${changed ? ' <span class="changed-dot">●</span>' : ""}</div>
          <div class="npc-meta">${metaHtml}</div>
        </div>
        <div class="npc-final ${npc.previewAdjustment}">Lv ${finalLevel}</div>
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

  // ---------------- render: individual plan cards ----------------

  function planToHtml(plan, isAdd, sourceKey, sourceIdx) {
    if (!plan) return "";
    const actionWord = isAdd ? T("action.add") : T("action.remove");
    const cls = isAdd ? "add" : "remove";
    const tag = `<span class="plan-tag ${cls}">${actionWord}</span>`;
    const parts = plan.parts.map(p => `
      <div class="plan-line">
        <span class="plan-count">${p.count} ×</span>
        <span class="plan-level">Lv ${p.level}</span>
        <span class="plan-delta">(${signed(p.delta)})</span>
        <span class="plan-xp">${p.xp}×${p.count}=<strong>${p.subtotal}</strong></span>
      </div>
    `).join("");
    const devTag = plan.deviation > 0
      ? ` <span class="deviation">${T("card.deviation", { n: plan.deviation })}</span>`
      : "";
    const actions = plan.totalCount;
    return `
      <div class="plan-card ${cls}" data-plan-kind="add" data-plan-source="${sourceKey || ""}" data-plan-idx="${sourceIdx != null ? sourceIdx : ""}">
        <div class="plan-header">
          ${tag}
          <strong>${T("card.addHeader", { action: actionWord, sum: plan.sum })}</strong>
          <span class="op-summary">${T("card.addOps", { count: plan.totalCount, distinct: plan.distinct, actions })}</span>
          ${devTag}
        </div>
        <div class="plan-body">${parts}</div>
      </div>
    `;
  }

  function adjustPlanToHtml(plan, sourceKey, sourceIdx) {
    const deltaSum = plan.sum;
    const sumLabel = (deltaSum >= 0 ? "+" : "") + deltaSum + " XP";
    const sumCls = deltaSum >= 0 ? "positive" : "negative";
    const devTag = plan.deviation > 0
      ? ` <span class="deviation">${T("card.deviation", { n: plan.deviation })}</span>`
      : "";
    const lines = plan.picked.map(op => {
      const opCls = op.deltaXP >= 0 ? "positive" : "negative";
      const deltaSign = op.deltaXP >= 0 ? "+" : "";
      return `
        <div class="adjust-line">
          <span class="adjust-name">${escapeHtml(op.npcName)}</span>
          <span class="adjust-flow">
            <span class="adj-text ${op.fromAdj}">${ADJUSTMENTS[op.fromAdj].label} Lv ${op.fromLevel}</span>
            <span class="meta-arrow">→</span>
            <span class="adj-text ${op.toAdj}">${ADJUSTMENTS[op.toAdj].label} Lv ${op.toLevel}</span>
          </span>
          <span class="adjust-delta ${opCls}">${deltaSign}${op.deltaXP} XP</span>
        </div>
      `;
    }).join("");
    return `
      <div class="plan-card adjust" data-plan-kind="adjust" data-plan-source="${sourceKey}" data-plan-idx="${sourceIdx}">
        <div class="plan-header">
          <span class="plan-tag adjust">${T("tag.adjust")}</span>
          <strong class="${sumCls}">${sumLabel}</strong>
          <span class="op-summary">${T("card.adjustOps", { n: plan.count })}</span>
          ${devTag}
          <button type="button" class="plan-preview-btn" data-preview-kind="adjust" data-preview-source="${sourceKey}" data-preview-idx="${sourceIdx}">${T("btn.previewPlan")}</button>
        </div>
        <div class="plan-body">${lines}</div>
      </div>
    `;
  }

  function compositePlanToHtml(plan, sourceKey, sourceIdx, isAdd) {
    const sumCls = plan.totalSum >= 0 ? "positive" : "negative";
    const sumLabel = (plan.totalSum >= 0 ? "+" : "") + plan.totalSum + " XP";
    const devTag = plan.deviation > 0
      ? ` <span class="deviation">${T("card.deviation", { n: plan.deviation })}</span>`
      : "";
    const adjustLines = plan.adjustsPicked.map(op => {
      const opCls = op.deltaXP >= 0 ? "positive" : "negative";
      const deltaSign = op.deltaXP >= 0 ? "+" : "";
      return `
        <div class="adjust-line">
          <span class="adjust-name">${escapeHtml(op.npcName)}</span>
          <span class="adjust-flow">
            <span class="adj-text ${op.fromAdj}">${ADJUSTMENTS[op.fromAdj].label} Lv ${op.fromLevel}</span>
            <span class="meta-arrow">→</span>
            <span class="adj-text ${op.toAdj}">${ADJUSTMENTS[op.toAdj].label} Lv ${op.toLevel}</span>
          </span>
          <span class="adjust-delta ${opCls}">${deltaSign}${op.deltaXP} XP</span>
        </div>
      `;
    }).join("");
    const addAction = isAdd ? T("action.add") : T("action.remove");
    const stepLabel = isAdd ? T("card.step2Add") : T("card.step2Remove");
    const addLines = plan.addParts.map(p => `
      <div class="plan-line">
        <span class="plan-count">${p.count} ×</span>
        <span class="plan-level">Lv ${p.level}</span>
        <span class="plan-delta">(${signed(p.delta)})</span>
        <span class="plan-xp">${p.xp}×${p.count}=<strong>${p.subtotal}</strong></span>
      </div>
    `).join("");
    const totalActions = plan.adjustCount + plan.addCount;
    return `
      <div class="plan-card composite" data-plan-kind="composite" data-plan-source="${sourceKey}" data-plan-idx="${sourceIdx}">
        <div class="plan-header">
          <span class="plan-tag composite">${T("tag.composite")}</span>
          <strong class="${sumCls}">${sumLabel}</strong>
          <span class="op-summary">${T("card.compOps", { adjust: plan.adjustCount, action: addAction, addCount: plan.addCount, total: totalActions })}</span>
          ${devTag}
          <button type="button" class="plan-preview-btn" data-preview-kind="composite" data-preview-source="${sourceKey}" data-preview-idx="${sourceIdx}">${T("btn.previewAdjustOnly")}</button>
        </div>
        <div class="plan-body">
          <div class="step-label">${T("card.step1Adjust")}</div>
          ${adjustLines}
          <div class="step-label">${stepLabel}</div>
          ${addLines}
        </div>
      </div>
    `;
  }

  function renderPlanItem(item, state) {
    if (item.kind === "adjust") return adjustPlanToHtml(item.plan, item.sourceKey, item.sourceIdx);
    if (item.kind === "add") return planToHtml(item.plan, state.gap > 0, item.sourceKey, item.sourceIdx);
    if (item.kind === "composite") return compositePlanToHtml(item.plan, item.sourceKey, item.sourceIdx, state.gap > 0);
    return "";
  }

  // ---------------- render: plan area (by-actions / by-type) ----------------

  function renderPlanControls(state) {
    const byActionsActive = state.viewMode === "by-actions" ? " active" : "";
    const byTypeActive = state.viewMode === "by-type" ? " active" : "";
    const checked = state.showNear ? "checked" : "";
    return `
      <div class="plan-controls">
        <span class="control-label">${T("view.orderLabel")}</span>
        <div class="view-tabs">
          <button type="button" class="view-tab${byActionsActive}" data-view="by-actions">${T("view.byActions")}</button>
          <button type="button" class="view-tab${byTypeActive}" data-view="by-type">${T("view.byType")}</button>
        </div>
        <label class="show-near-label" title="${T("view.showNearTip")}">
          <input type="checkbox" class="show-near-cb" ${checked}> ${T("view.showNear")}
        </label>
      </div>
    `;
  }

  function renderUnifiedPlans(state) {
    const includeNear = state.showNear;
    let all = getAllPlans(state, includeNear);
    let exactCount = all.filter(i => i.deviation === 0).length;
    if (exactCount === 0 && !includeNear) {
      all = getAllPlans(state, true);
      exactCount = 0;
    }
    if (all.length === 0) return `<p class="empty-msg">${T("plans.emptyAny")}</p>`;
    const top = all.slice(0, 12);
    const note = (exactCount === 0 && !includeNear)
      ? `<div class="plan-note">${T("plans.noteUnifiedAuto")}</div>`
      : `<div class="plan-note">${T("plans.noteUnifiedAsc", { total: all.length, top: top.length })}</div>`;
    return note + top.map(item => renderPlanItem(item, state)).join("");
  }

  function renderTypedSection(state, kind, sectionTitle) {
    const isAdd = state.gap > 0;
    const includeNear = state.showNear;
    const planList = state[kind === "adjust" ? "adjustPlans"
                          : kind === "add" ? "addPlans"
                          : "compositePlans"];
    let exact = planList.exact || [];
    let near = planList.near || [];
    let content = "";
    if (exact.length === 0 && near.length === 0) {
      return `<details><summary>${sectionTitle}</summary><div class="details-body"><p class="empty-msg">${T("plans.emptyAny")}</p></div></details>`;
    }
    if (exact.length > 0) {
      content += `<div class="plan-note">${T("plans.noteExactCount", { n: exact.length })}</div>`;
      content += exact.map((p, i) => {
        const item = { kind, plan: p, sourceKey: "exact", sourceIdx: i };
        item.actions = planActions(item);
        return renderPlanItem(item, state);
      }).join("");
    }
    if (near.length > 0 && (includeNear || exact.length === 0)) {
      const heading = exact.length === 0
        ? T("plans.noteNearOnly")
        : T("plans.noteNearAltShort");
      content += `<div class="plan-note">${heading}</div>`;
      content += near.map((p, i) => {
        const item = { kind, plan: p, sourceKey: "near", sourceIdx: i };
        item.actions = planActions(item);
        return renderPlanItem(item, state);
      }).join("");
    }
    return `<details open><summary>${sectionTitle}</summary><div class="details-body">${content}</div></details>`;
  }

  function renderTypedPlans(state) {
    const isAdd = state.gap > 0;
    const addAction = isAdd ? T("action.add") : T("action.remove");
    return [
      renderTypedSection(state, "adjust", T("plans.sectionAdjust")),
      renderTypedSection(state, "add", T("plans.sectionAdd", { action: addAction })),
      renderTypedSection(state, "composite", T("plans.sectionComposite", { action: addAction }))
    ].join("");
  }

  function renderPlansSection(state) {
    if (state.gap === 0) {
      return `<details open><summary>${T("plans.titleDefault")}</summary><div class="details-body"><p class="empty-msg">${T("plans.done")}</p></div></details>`;
    }
    const diffLabel = state.gap > 0
      ? T("plans.diffUnder", { abs: Math.abs(state.gap) })
      : T("plans.diffOver", { abs: Math.abs(state.gap) });
    const inner = state.viewMode === "by-type" ? renderTypedPlans(state) : renderUnifiedPlans(state);
    const wrapped = state.viewMode === "by-type"
      ? inner
      : `<details open><summary>${T("plans.titleByActions")}</summary><div class="details-body">${inner}</div></details>`;
    return `
      <div class="plans-section">
        ${renderPlanControls(state)}
        ${wrapped}
        <div class="plan-diffline">${T("plans.diffLine", { label: diffLabel })}</div>
      </div>
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
        ${renderGapBanner(state)}
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

    rootEl.querySelectorAll(".plan-preview-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        const kind = btn.dataset.previewKind;
        const sourceKey = btn.dataset.previewSource;
        const idx = Number(btn.dataset.previewIdx);
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

    rootEl.querySelectorAll(".view-tab").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        const mode = btn.dataset.view;
        if (mode && mode !== state.viewMode) {
          state.viewMode = mode;
          try { localStorage.setItem("pf2eXpTool.viewMode", mode); } catch (_) {}
          refresh();
        }
      });
    });

    const showNearCb = rootEl.querySelector(".show-near-cb");
    if (showNearCb) {
      showNearCb.addEventListener("change", e => {
        state.showNear = !!e.target.checked;
        try { localStorage.setItem("pf2eXpTool.showNear", state.showNear ? "1" : "0"); } catch (_) {}
        refresh();
      });
    }

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

  function getInitialPrefs() {
    let viewMode = "by-actions";
    let showNear = false;
    try {
      const v = localStorage.getItem("pf2eXpTool.viewMode");
      if (v === "by-type" || v === "by-actions") viewMode = v;
      const sn = localStorage.getItem("pf2eXpTool.showNear");
      if (sn === "1") showNear = true;
    } catch (_) {}
    return { viewMode, showNear };
  }

  function openTool(partyLevel, partySize, npcs, hazards, hazardActors) {
    const pwol = !!(game.pf2e && game.pf2e.settings && game.pf2e.settings.variants &&
      game.pf2e.settings.variants.pwol && game.pf2e.settings.variants.pwol.enabled);
    const prefs = getInitialPrefs();
    showXPTool({
      partyLevel, partySize,
      npcs, hazards, hazardActors, pwol,
      viewMode: prefs.viewMode,
      showNear: prefs.showNear
    });
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

  Hooks.once("init", () => {
    console.log(`${MODULE_ID} | init`);
  });

  Hooks.on("renderMacroDirectory", injectButton);
  Hooks.on("renderActorDirectory", injectButton);
  Hooks.on("renderMacroDirectoryV2", injectButton);
  Hooks.on("renderActorDirectoryV2", injectButton);

})();

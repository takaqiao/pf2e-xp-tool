import { L, T } from "./i18n.mjs";
import { runtime } from "./runtime.mjs";
import {
  effectiveLevel,
  ADJUSTMENTS,
  signed,
  escapeHtml,
  DIFFICULTY_KEYS,
  QUICK_GROUPS,
  xpForDelta,
  singleNpcXP,
  planActions,
  kindRank,
  getAllPlans,
  projectedTotal,
  ratingForTotal,
} from "./core.mjs";

function renderHeader(state) {
  const targetOptions = ["baseline", ...DIFFICULTY_KEYS, "custom"].map(key =>
    `<option value="${key}"${state.targetMode === key ? " selected" : ""}>${T(`difficulty.${key}`)}</option>`
  ).join("");
  const customInput = state.targetMode === "custom"
    ? `<input type="number" class="xp-input custom-target-input" value="${state.customTarget}" min="1" step="1" title="${T("difficulty.customXP")}">`
    : "";
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
      <div class="xp-stat target">
        <div class="xp-stat-label">${T("header.target")}</div>
        <div class="xp-stat-value target-control">
          <select class="difficulty-input">${targetOptions}</select>${customInput}
        </div>
      </div>
    </div>
  `;
}

export function themeTraits(state) {
  return String(state.theme || "").split(",").map(value => value.trim()).filter(Boolean);
}

export function addThemeTrait(state, value) {
  const traits = themeTraits(state);
  for (const trait of String(value || "").split(",").map(part => part.trim()).filter(Boolean)) {
    if (!traits.some(existing => existing.toLowerCase() === trait.toLowerCase())) traits.push(trait);
  }
  state.theme = traits.join(", ");
  state.themeCandidateCache = new Map();
}

export function removeThemeTrait(state, index) {
  const traits = themeTraits(state);
  if (index < 0 || index >= traits.length) return;
  traits.splice(index, 1);
  state.theme = traits.join(", ");
  state.themeCandidateCache = new Map();
}

export function creatureTraitOptions() {
  return Object.entries(globalThis.CONFIG?.PF2E?.creatureTraits ?? {}).map(([slug, key]) => {
    const localized = game?.i18n?.localize?.(key);
    return { slug, label: localized && localized !== key ? localized : slug };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export function renderThemeControl(state) {
  const options = creatureTraitOptions();
  const labels = new Map(options.map(({ slug, label }) => [slug.toLowerCase(), label]));
  const cards = themeTraits(state).map((trait, index) => `
    <span class="trait-card">
      <span>${escapeHtml(labels.get(trait.toLowerCase()) ?? trait)}</span>
      <button type="button" class="trait-remove" data-trait-index="${index}"
        aria-label="${T("plans.removeTrait", { trait: escapeHtml(trait) })}" title="${T("plans.removeTrait", { trait: escapeHtml(trait) })}">
        <i class="fas fa-xmark"></i>
      </button>
    </span>
  `).join("");
  return `
    <div class="xp-theme-row">
      <label for="xp-tool-theme">${T("plans.theme")}</label>
      <div class="trait-card-list">
        ${cards}
        <div class="trait-mode" role="group" aria-label="${T("plans.themeMode")}">
          ${["or", "and"].map(mode => `<button type="button" class="trait-mode-btn${(state.themeMode || "or") === mode ? " active" : ""}"
            data-theme-mode="${mode}" aria-pressed="${(state.themeMode || "or") === mode}"
            title="${T(`plans.themeModeHint.${mode}`)}">${mode.toUpperCase()}</button>`).join("")}
        </div>
        <button id="xp-tool-theme" type="button" class="trait-add" aria-controls="xp-tool-trait-picker"
          aria-expanded="${Boolean(state.traitPickerOpen)}" title="${T("plans.addTrait")}">
          <i class="fas fa-plus"></i> ${T("plans.addTrait")}
        </button>
        ${state.traitPickerOpen ? `<div id="xp-tool-trait-picker" class="trait-picker">
          <input class="trait-search" type="search" placeholder="${T("plans.themePlaceholder")}" aria-label="${T("plans.themePlaceholder")}" autocomplete="off">
          <div class="trait-picker-options" role="listbox">${options.map(({ slug, label }) => `
          <button type="button" class="trait-option" role="option" data-trait-slug="${escapeHtml(slug)}"
            data-trait-search="${escapeHtml(`${label} ${slug}`.toLowerCase())}">${escapeHtml(label)}</button>
          `).join("")}</div>
        </div>` : ""}
      </div>
    </div>
  `;
}

export function renderStructureControl(state) {
  const options = Object.entries(QUICK_GROUPS).map(([id, group]) =>
    `<option value="${id}"${state.quickGroup === id ? " selected" : ""}>${T(`plans.quickGroupOptions.${id}`)}${state.pwol ? "" : ` (${group.budget} XP)`}</option>`
  ).join("");
  return `
    <div class="xp-structure-control">
      <label for="xp-tool-structure">${T("plans.quickGroup")}</label>
      <select id="xp-tool-structure" class="quick-group-select${state.quickGroup && state.quickGroup !== "auto" ? " active" : ""}">
        <option value="auto"${!state.quickGroup || state.quickGroup === "auto" ? " selected" : ""}>${T("plans.quickGroupAuto")}</option>
        ${options}
      </select>
    </div>
  `;
}

export function buildQuickGroupPlan(state) {
  const group = QUICK_GROUPS[state.quickGroup];
  if (!group || state.gap <= 0 || state.candidateLoadState !== "ready") return null;
  const parts = [];
  for (const delta of group.slots) {
    const level = state.partyLevel + delta;
    if (level < -1 || themeCandidatesAtLevel(level, state).length === 0) return null;
    const last = parts[parts.length - 1];
    if (last && last.level === level) last.count++;
    else parts.push({ level, count: 1, xp: xpForDelta(delta, state.pwol) });
  }
  const sum = parts.reduce((total, part) => total + part.count * part.xp, 0);
  return { parts, sum, totalCount: group.slots.length, deviation: Math.abs(state.gap - sum) };
}

export function renderProgressBar(state) {
  const current = projectedTotal(state);
  const target = state.targetTotal;
  const currentRating = ratingForTotal(current, state.xp.encounterBudgets);
  const targetRating = DIFFICULTY_KEYS.includes(state.targetMode)
    ? state.targetMode
    : ratingForTotal(target, state.xp.encounterBudgets);
  const currentThreat = L("PF2E.Encounter.Budget.Threats." + currentRating);
  const targetThreat = L("PF2E.Encounter.Budget.Threats." + targetRating);
  let max = Math.max(current, target);
  if (max === 0) max = 1;
  max = max * 1.15;
  const currentPct = Math.min(100, (current / max) * 100);
  const targetPct = Math.min(100, (target / max) * 100);
  const ratio = target > 0 ? current / target : 1;
  const fillCls = ratio < 0.95 ? "under" : (ratio <= 1.05 ? "match" : "over");
  const gap = target - current;
  let gapHtml;
  if (gap === 0) gapHtml = `<span class="gap-label match">${T("gap.match")}</span>`;
  else if (gap > 0) gapHtml = `<span class="gap-label under">${T("gap.under", { n: gap })}</span>`;
  else                gapHtml = `<span class="gap-label over">${T("gap.over",  { n: Math.abs(gap) })}</span>`;
  const fortifyWarning = state.fortifyPercent > 50
    ? `<div class="fortify-warning"><i class="fas fa-triangle-exclamation"></i> ${T("hpBoost.warning", { percent: state.fortifyPercent })}</div>`
    : "";
  return `
    <div class="xp-bar-wrap">
      <div class="encounter-route">
        <div class="route-point current ${currentRating}">
          <span class="route-label">${T(state.previewActive ? "header.previewThreat" : "header.threat")}</span>
          <strong>${currentThreat}</strong><span>${current} XP</span>
        </div>
        <i class="fas fa-arrow-right route-arrow"></i>
        <div class="route-point target ${targetRating}">
          <span class="route-label">${T("header.target")}</span>
          <strong>${targetThreat}</strong><span>${target} XP</span>
        </div>
        ${gapHtml}
      </div>
      <div class="xp-bar">
        <div class="xp-bar-fill ${fillCls}" style="width:${currentPct}%"></div>
        <div class="xp-bar-target" style="left:${targetPct}%"></div>
      </div>
      ${fortifyWarning}
    </div>
  `;
}

export function npcHasPendingChange(npc) {
  return npc.previewAdjustment !== npc.currentAdjustment ||
    Math.abs((npc.previewHpPercent || 0) - (npc.currentHpPercent || 0)) > 0.01;
}

export function toggleAllHpBoost(npcs) {
  const enable = npcs.some(npc => !npc.previewHpBoost);
  npcs.forEach(npc => { npc.previewHpBoost = enable; });
  return enable;
}

export function renderNpcCard(npc, idx, state) {
  const finalLevel = effectiveLevel(npc.baseLevel, npc.previewAdjustment);
  const changed = npcHasPendingChange(npc);
  const adjKey = npc.previewAdjustment;
  const baseXP = singleNpcXP(finalLevel, state.partyLevel, state.pwol);
  const npcXP = baseXP + Math.round(baseXP * npc.previewHpPercent * 0.01);
  const hpDisabled = !state.canFortify && !npc.previewHpBoost;

  const buttons = ["weak", "normal", "elite"].map(a => {
    const active = adjKey === a ? ` active adj-${a}` : "";
    return `<button type="button" class="adj-btn${active}" data-npc-idx="${idx}" data-adj="${a}" title="${ADJUSTMENTS[a].label}">${ADJUSTMENTS[a].short}</button>`;
  }).join("");

  return `
    <div class="npc-card${changed ? " changed" : ""}">
      <div class="npc-name"><button type="button" class="npc-sheet-link" data-npc-idx="${idx}" title="${T("npc.openSheet")}">${escapeHtml(npc.name)}</button>${changed ? ' <span class="changed-dot">●</span>' : ""}</div>
      <div class="npc-level ${adjKey}">Lv ${finalLevel}</div>
      <div class="npc-xp">${npcXP} XP</div>
      <div class="adj-toggle">${buttons}</div>
      <button type="button" class="hp-boost-btn${npc.previewHpBoost ? " active" : ""}" data-npc-idx="${idx}" title="${T("hpBoost.title", { percent: npc.previewHpPercent })}"${hpDisabled ? " disabled" : ""}>${npc.previewHpBoost ? T("hpBoost.active", { percent: npc.previewHpPercent }) : T("hpBoost.short")}</button>
    </div>
  `;
}

export function renderNpcSection(state) {
  const hasContent = state.npcs.length > 0 || state.hazards.length > 0 ||
    (state.previewEntities || []).some(entity => entity.action === "add" && entity.kind === "creature");
  if (!hasContent) {
    return `<details open><summary>${T("npc.selectedUnits")}</summary><div class="details-body"><p class="empty-msg">${T("npc.empty")}</p></div></details>`;
  }
  const npcsHtml = state.npcs.map((n, i) => renderNpcCard(n, i, state)).join("");
  const allHpBoosted = state.npcs.length > 0 && state.npcs.every(npc => npc.previewHpBoost);
  const anyHpBoosted = state.npcs.some(npc => npc.previewHpBoost);
  const bulkHpButton = state.npcs.length > 0
    ? `<div class="npc-column-head">
        <span>${T("npc.creature")}</span><span>${T("npc.level")}</span><span>${T("npc.xp")}</span>
        <span>${T("npc.template")}</span>
        <button type="button" class="hp-boost-all-btn${allHpBoosted ? " active" : ""}" title="${T("hpBoost.allTitle")}"${!state.canFortify && !anyHpBoosted ? " disabled" : ""}>${allHpBoosted ? T("hpBoost.clearAll") : T("hpBoost.selectAll")}</button>
      </div>`
    : "";
  const previewCreatures = (state.previewEntities || []).filter(entity => entity.action === "add" && entity.kind === "creature");
  const previewCreaturesHtml = previewCreatures.map(entity => `
    <div class="npc-card preview-added">
      <div class="npc-name"><i class="fas fa-plus"></i> <button type="button" class="preview-creature-link" data-creature-uuid="${escapeHtml(entity.uuid || "")}">${escapeHtml(entity.count > 1 ? `${entity.count}× ${entity.name}` : entity.name)}</button></div>
      <div class="npc-level normal">Lv ${entity.level}</div>
      <div class="npc-xp">${entity.xp * entity.count} XP</div>
      <div class="preview-tag">${T("npc.previewAdd")}</div>
    </div>
  `).join("");
  let hazardsHtml = "";
  if (state.hazards.length > 0) {
    hazardsHtml = `<div class="hazard-list"><strong>${T("npc.hazardsLabel")}</strong>${
      state.hazards.map(h => `<span>${escapeHtml(h.name)} Lv ${h.level} (${T(h.isComplex ? "plans.complexHazard" : "plans.simpleHazard")})</span>`).join("")
    }</div>`;
  }
  const changedCount = state.npcs.filter(npcHasPendingChange).length;
  const previewCount = previewCreatures.reduce((sum, entity) => sum + entity.count, 0);
  const summaryExtra = (changedCount > 0 ? ` <span class="pending-tag">${T("npc.pendingApply", { n: changedCount })}</span>` : "") +
    (previewCount > 0 ? ` <span class="preview-count-tag">${T("npc.previewAddN", { n: previewCount })}</span>` : "");
  const summaryBody = state.hazards.length > 0
    ? T("npc.summaryWithHazards", { npcs: state.npcs.length, hazards: state.hazards.length })
    : T("npc.summary", { npcs: state.npcs.length });
  const summary = `${T("npc.selectedUnits")} (${summaryBody})${summaryExtra}`;
  return `<details open><summary>${summary}</summary><div class="details-body">${bulkHpButton}${npcsHtml}${previewCreaturesHtml}${hazardsHtml}</div></details>`;
}

export function creatureCandidateFor(part, state, seed, partIndex) {
  const candidates = themeCandidatesAtLevel(part.level, state);
  if (state.gap <= 0 || !candidates || candidates.length === 0) return null;
  return candidates[((seed || 0) + (partIndex || 0)) % candidates.length];
}

export function themeCandidateScore(candidate, terms, mode) {
  const name = String(candidate.name || "").toLowerCase();
  const text = String(candidate.searchText || "").toLowerCase();
  const traits = candidate.traits || [];
  const traitSet = new Set(traits.map(trait => String(trait).toLowerCase()));
  if (mode === "and") return terms.every(term => traitSet.has(term)) ? terms.length * 10 : 0;
  const scores = terms.map(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z])${escaped}(s|es|ies)?([^a-z]|$)`, "i");
    if (traits.some(trait => pattern.test(String(trait)))) return 10;
    if (pattern.test(name)) return 7;
    return pattern.test(text) ? 2 : 0;
  });
  return scores.reduce((sum, score) => sum + score, 0);
}

export function themeCandidatesAtLevel(level, state) {
  const candidates = state.creatureCandidatesByLevel && state.creatureCandidatesByLevel.get(level);
  if (!candidates || !state.theme || !state.theme.trim()) return candidates || [];
  const mode = state.themeMode === "and" ? "and" : "or";
  const key = `${state.theme.toLowerCase()}|${mode}|${level}`;
  state.themeCandidateCache ||= new Map();
  if (state.themeCandidateCache.has(key)) return state.themeCandidateCache.get(key);
  const terms = themeTraits(state).map(trait => trait.toLowerCase());
  const matches = candidates.map(candidate => ({ candidate, score: themeCandidateScore(candidate, terms, mode) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(result => result.candidate);
  state.themeCandidateCache.set(key, matches);
  return matches;
}

export function planMatchesTheme(item, state) {
  if (!state.theme || !state.theme.trim() || state.gap <= 0 || state.candidateLoadState !== "ready") return true;
  const parts = item.kind === "add" ? item.plan.parts :
    item.kind === "composite" && item.plan.addDirection > 0 ? item.plan.addParts : [];
  return parts.every(part => themeCandidatesAtLevel(part.level, state).length > 0);
}

export function creaturePartsDesc(parts, state, seed) {
  return parts.map((part, partIndex) => {
    if (state.gap < 0) {
      const names = state.npcs
        .filter(npc => effectiveLevel(npc.baseLevel, npc.previewAdjustment) === part.level)
        .slice(0, part.count)
        .map(npc => npc.name);
      if (names.length === part.count) return names.join(" + ");
    }
    const candidates = themeCandidatesAtLevel(part.level, state);
    const candidate = creatureCandidateFor(part, state, seed, partIndex);
    if (candidate) {
      return T("plans.creatureCandidate", {
        count: part.count, name: candidate.name, level: part.level, matches: candidates.length
      });
    }
    return `${part.count}× Lv ${part.level}`;
  }).join(" + ");
}

export function planDesc(item, state) {
  const kind = item.kind;
  const plan = item.plan;
  if (kind === "add") {
    const parts = creaturePartsDesc(plan.parts, state, item.sourceIdx);
    if (item.sourceKey === "structure") return T("plans.quickGroupDesc", {
      name: T(`plans.quickGroupOptions.${state.quickGroup}`), parts
    });
    return T(state.gap > 0 ? "plans.addDesc" : "plans.removeDesc", { parts });
  }
  if (kind === "adjust") return adjustDesc(plan.picked);
  if (kind === "simple-hazard" || kind === "complex-hazard") {
    const parts = plan.parts.map(p => `${p.count}× Lv ${p.level}`).join(" + ");
    const type = kind === "complex-hazard" ? T("plans.complexHazard") : T("plans.simpleHazard");
    return T(state.gap > 0 ? "plans.addHazardDesc" : "plans.removeHazardDesc", { type, parts });
  }
  if (kind === "composite") {
    const adj = adjustDesc(plan.adjustsPicked);
    const adds = creaturePartsDesc(plan.addParts, state, item.sourceIdx);
    const add = T(state.gap > 0 ? "plans.addDesc" : "plans.removeDesc", { parts: adds });
    return T("plans.compositeDesc", { adjust: adj, add });
  }
  return "";
}

export function adjustDesc(picked) {
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

export function planSumSigned(item, state) {
  const kind = item.kind;
  if (kind === "adjust") return item.plan.sum;
  if (kind === "composite") return item.plan.totalSum;
  return state.gap > 0 ? item.plan.sum : -item.plan.sum;
}

export function planIconHtml(item, state) {
  const kind = item.kind;
  if (kind === "adjust") return '<i class="fas fa-sliders"></i>';
  if (kind === "composite") return '<i class="fas fa-shuffle"></i>';
  if (kind === "simple-hazard" || kind === "complex-hazard") return '<i class="fas fa-triangle-exclamation"></i>';
  return state.gap > 0 ? '<i class="fas fa-plus"></i>' : '<i class="fas fa-minus"></i>';
}

export function planKey(item) {
  return `${item.kind}:${item.sourceKey || ""}:${item.sourceIdx ?? ""}`;
}

export function planMatchesFilter(item, filter) {
  if (!filter || filter === "best") return true;
  if (filter === "creatures") return item.kind === "add";
  if (filter === "templates") return item.kind === "adjust";
  if (filter === "mixed") return item.kind === "composite";
  return true;
}

export function renderPlanItem(item, state) {
  const kind = item.kind;
  const plan = item.plan;
  const sum = planSumSigned(item, state);
  const sumCls = sum >= 0 ? "positive" : "negative";
  const sumLabel = (sum >= 0 ? "+" : "") + sum;
  const ops = planActions(item);
  const desc = escapeHtml(planDesc(item, state));
  const clickable = ["adjust", "add", "composite", "simple-hazard", "complex-hazard"].includes(kind);
  const dev = plan.deviation > 0
    ? ` <span class="plan-deviation">≈${plan.deviation}</span>`
    : "";
  const titleAttr = clickable ? ` title="${T("plans.previewHint")}"` : "";
  const data = `data-plan-kind="${kind}" data-plan-source="${item.sourceKey || ""}" data-plan-idx="${item.sourceIdx != null ? item.sourceIdx : ""}"`;
  const selected = state.selectedPlanKey === planKey(item) ? " selected" : "";
  return `
    <div class="plan-row ${kind}${clickable ? " clickable" : ""}${selected}" ${data}${titleAttr}>
      <span class="plan-icon">${planIconHtml(item, state)}</span>
      <span class="plan-desc">${desc}${dev}</span>
      <span class="plan-sum ${sumCls}">${sumLabel} XP</span>
      <span class="plan-ops">${T("card.ops", { n: ops })}</span>
    </div>
  `;
}

export function renderPlansSection(state) {
  const activeFilter = state.planFilter || "best";
  const filters = ["best", "creatures", "templates", "mixed"];
  const tabs = `<div class="plan-filters">${filters.map(filter =>
    `<button type="button" class="plan-filter${(!state.quickGroup || state.quickGroup === "auto") && activeFilter === filter ? " active" : ""}" data-plan-filter="${filter}">${T(`plans.filter.${filter}`)}</button>`
  ).join("")}${renderStructureControl(state)}</div>`;
  if (state.quickGroup && state.quickGroup !== "auto" && state.gap > 0) {
    state.structurePlan = buildQuickGroupPlan(state);
    const item = state.structurePlan
      ? renderPlanItem({ kind: "add", plan: state.structurePlan, sourceKey: "structure", sourceIdx: 0 }, state)
      : `<p class="empty-msg">${T(state.candidateLoadState === "loading" ? "plans.candidatesLoading" : "plans.quickGroupUnavailable")}</p>`;
    return `<details open><summary>${T("plans.title")}</summary><div class="details-body">
      ${tabs}<div class="plan-note">${T("plans.quickGroupNote")}</div>${item}
    </div></details>`;
  }
  if (state.gap === 0) {
    return `<details open><summary>${T("plans.title")}</summary><div class="details-body">${tabs}<p class="empty-msg success">${T("plans.done")}</p></div></details>`;
  }
  const MAX_SHOWN = 8;
  const exactAll = getAllPlans(state, false).filter(item => planMatchesFilter(item, activeFilter) && planMatchesTheme(item, state));
  let all = exactAll;
  let usedFallback = false;
  if (exactAll.length < 3) {
    all = getAllPlans(state, true).filter(item => planMatchesFilter(item, activeFilter) && planMatchesTheme(item, state));
    usedFallback = exactAll.length === 0;
  }
  if (all.length === 0) {
    const message = state.theme && state.gap > 0 && state.candidateLoadState === "ready"
      ? T("plans.noThemeMatches") : T("plans.emptyFiltered");
    return `<details open><summary>${T("plans.title")}</summary><div class="details-body">${tabs}<p class="empty-msg">${message}</p></div></details>`;
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
        ${tabs}
        ${fallbackNote}
        ${state.candidateLoadState === "loading" && state.gap > 0 ? `<div class="plan-note"><i class="fas fa-spinner fa-spin"></i> ${T("plans.candidatesLoading")}</div>` : ""}
        ${top.map(item => renderPlanItem(item, state)).join("")}
      </div>
    </details>
  `;
}

export function renderHazardPlansSection(state) {
  if (state.gap === 0) return "";
  const exact = [];
  state.simpleHazardPlans.exact.forEach((plan, i) => exact.push({ kind: "simple-hazard", plan, sourceKey: "exact", sourceIdx: i }));
  state.complexHazardPlans.exact.forEach((plan, i) => exact.push({ kind: "complex-hazard", plan, sourceKey: "exact", sourceIdx: i }));
  let plans = exact;
  let usedFallback = false;
  if (plans.length === 0) {
    usedFallback = true;
    plans = [];
    state.simpleHazardPlans.near.forEach((plan, i) => plans.push({ kind: "simple-hazard", plan, sourceKey: "near", sourceIdx: i }));
    state.complexHazardPlans.near.forEach((plan, i) => plans.push({ kind: "complex-hazard", plan, sourceKey: "near", sourceIdx: i }));
  }
  plans.forEach(item => {
    item.actions = planActions(item);
    item.deviation = item.plan.deviation || 0;
  });
  plans.sort((a, b) => a.deviation - b.deviation || a.actions - b.actions || kindRank(a.kind) - kindRank(b.kind));
  const top = plans.slice(0, 6);
  if (top.length === 0) return "";
  return `
    <details>
      <summary>${T("plans.hazardTitle")}</summary>
      <div class="details-body">
        ${usedFallback ? `<div class="plan-note">${T("plans.noteFallback")}</div>` : ""}
        ${top.map(item => renderPlanItem(item, state)).join("")}
      </div>
    </details>
  `;
}

export function getReferenceTable(partyLevel, pwol) {
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

export function renderReferenceSection(state) {
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

export function renderActions(state) {
  const changedCount = state.npcs.filter(npcHasPendingChange).length;
  const additionCount = (state.previewEntities || []).filter(entity => entity.action === "add" && entity.kind === "creature")
    .reduce((sum, entity) => sum + entity.count, 0);
  const canApply = changedCount > 0 || additionCount > 0;
  const applyLabel = additionCount > 0
    ? changedCount > 0
      ? T("btn.applyMixed", { templates: changedCount, creatures: additionCount })
      : T("btn.applyCreatures", { n: additionCount })
    : changedCount > 0
      ? T("btn.applyN", { n: changedCount })
      : T("btn.selectPlan");
  const resetDis = canApply || state.previewActive ? "" : " disabled";
  const applyDis = canApply ? "" : " disabled";
  return `
    <div class="btn-row">
      <div class="selected-plan-summary">
        <span>${state.selectedPlanLabel ? T("plans.selected") : T("plans.selectionHint")}</span>
        ${state.selectedPlanLabel ? `<strong>${escapeHtml(state.selectedPlanLabel)}</strong>` : ""}
      </div>
      <button type="button" class="secondary" id="reset-btn"${resetDis}><i class="fas fa-rotate-left"></i> ${T("btn.reset")}</button>
      <button type="button" class="secondary" id="undo-btn"${runtime.lastAppliedBatch.length > 0 || runtime.lastAddedTokens.length > 0 ? "" : " disabled"}><i class="fas fa-clock-rotate-left"></i> ${T("btn.undo")}</button>
      <div class="spacer"></div>
      <button type="button" class="bright" id="apply-btn"${applyDis}>
        <i class="fas fa-check"></i> ${applyLabel}
      </button>
    </div>
  `;
}

export function renderContent(state) {
  return `
    <div class="xp-tool">
      ${renderHeader(state)}
      ${renderThemeControl(state)}
      ${renderProgressBar(state)}
      ${renderNpcSection(state)}
      ${renderPlansSection(state)}
      ${renderHazardPlansSection(state)}
      ${renderReferenceSection(state)}
      ${renderActions(state)}
    </div>
  `;
}

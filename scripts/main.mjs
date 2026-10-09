import { MODULE_ID, L, T, registerI18n } from "./i18n.mjs";
import { runtime } from "./runtime.mjs";
import {
  ADJUSTMENTS,
  clampInt,
  clampFloat,
  loadCreatureCandidates,
  getActorAdjustment,
  getActorHpBoost,
  getActorHpBoostPercent,
  getBaseLevel,
  DIFFICULTY_KEYS,
  recompute,
} from "./core.mjs";
import {
  addThemeTrait,
  removeThemeTrait,
  toggleAllHpBoost,
  creatureCandidateFor,
  planDesc,
  planKey,
  renderContent,
} from "./view.mjs";
import { applyAdjustments, applyPreviewAdditions, undoLastApplication, syncNpcAdjustments } from "./actions.mjs";

const DialogClass =
  (typeof foundry !== "undefined" && foundry.appv1 && foundry.appv1.api && foundry.appv1.api.Dialog) ||
  globalThis.Dialog;

export function attachListeners(rootEl, state, refresh) {
  function clearPlanPreview() {
    state.previewActive = false;
    state.virtualPlanDelta = 0;
    state.previewEntities = [];
    state.selectedPlanKey = null;
    state.selectedPlanLabel = "";
  }

  const traitSearch = rootEl.querySelector(".trait-search");
  if (traitSearch) {
    traitSearch.addEventListener("input", () => {
      rootEl.querySelectorAll(".trait-option").forEach(option => {
        option.hidden = !option.dataset.traitSearch.includes(traitSearch.value.trim().toLowerCase());
      });
    });
    traitSearch.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        rootEl.querySelector(".trait-option:not([hidden])")?.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        state.traitPickerOpen = false;
        refresh();
        rootEl.querySelector(".trait-add")?.focus();
      }
    });
  }
  rootEl.querySelector(".trait-add")?.addEventListener("click", () => {
    state.traitPickerOpen = !state.traitPickerOpen;
    refresh();
    rootEl.querySelector(state.traitPickerOpen ? ".trait-search" : ".trait-add")?.focus();
  });
  rootEl.querySelectorAll(".trait-option").forEach(button => button.addEventListener("click", () => {
    clearPlanPreview();
    addThemeTrait(state, button.dataset.traitSlug);
    state.traitPickerOpen = false;
    refresh();
  }));
  rootEl.addEventListener("click", e => {
    if (state.traitPickerOpen && !e.target.closest(".trait-card-list")) {
      state.traitPickerOpen = false;
      refresh();
    }
  });
  rootEl.querySelectorAll(".trait-remove").forEach(button => button.addEventListener("click", () => {
    clearPlanPreview();
    removeThemeTrait(state, Number(button.dataset.traitIndex));
    refresh();
  }));
  rootEl.querySelectorAll(".trait-mode-btn").forEach(button => button.addEventListener("click", () => {
    if (state.themeMode === button.dataset.themeMode) return;
    clearPlanPreview();
    state.themeMode = button.dataset.themeMode;
    state.themeCandidateCache = new Map();
    refresh();
  }));
  rootEl.querySelector(".quick-group-select")?.addEventListener("change", e => {
    clearPlanPreview();
    state.quickGroup = e.target.value;
    state.structurePlan = null;
    refresh();
  });

  rootEl.querySelectorAll(".npc-sheet-link").forEach(button => {
    button.addEventListener("click", e => {
      e.preventDefault();
      const npc = state.npcs[Number(button.dataset.npcIdx)];
      const actor = npc && ((npc.token && npc.token.actor) || (game.actors && game.actors.get(npc.actorId)));
      if (actor && actor.sheet) actor.sheet.render(true);
    });
  });

  rootEl.querySelectorAll(".adj-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      const idx = Number(btn.dataset.npcIdx);
      const adj = btn.dataset.adj;
      if (state.npcs[idx] && ADJUSTMENTS[adj]) {
        clearPlanPreview();
        state.npcs[idx].previewAdjustment = adj;
        refresh();
      }
    });
  });

  rootEl.querySelectorAll(".hp-boost-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      const npc = state.npcs[Number(btn.dataset.npcIdx)];
      if (!npc) return;
      clearPlanPreview();
      npc.previewHpBoost = !npc.previewHpBoost;
      refresh();
    });
  });

  const hpBoostAllBtn = rootEl.querySelector(".hp-boost-all-btn");
  if (hpBoostAllBtn) {
    hpBoostAllBtn.addEventListener("click", e => {
      e.preventDefault();
      clearPlanPreview();
      toggleAllHpBoost(state.npcs);
      refresh();
    });
  }

  rootEl.querySelectorAll(".plan-filter").forEach(button => {
    button.addEventListener("click", e => {
      e.preventDefault();
      state.quickGroup = "auto";
      state.structurePlan = null;
      state.planFilter = button.dataset.planFilter || "best";
      refresh();
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
      else if (kind === "add") plan = sourceKey === "structure"
        ? state.structurePlan : state.addPlans[sourceKey] && state.addPlans[sourceKey][idx];
      else if (kind === "simple-hazard") plan = state.simpleHazardPlans[sourceKey] && state.simpleHazardPlans[sourceKey][idx];
      else if (kind === "complex-hazard") plan = state.complexHazardPlans[sourceKey] && state.complexHazardPlans[sourceKey][idx];
      if (!plan) return;
      const selectedItem = { kind, plan, sourceKey, sourceIdx: idx };
      state.selectedPlanKey = planKey(selectedItem);
      state.selectedPlanLabel = planDesc(selectedItem, state);
      state.npcs.forEach(npc => {
        npc.previewAdjustment = npc.currentAdjustment;
        npc.previewHpBoost = npc.currentHpBoost;
        npc.previewHpPercent = npc.currentHpPercent;
      });
      const picked = kind === "composite" ? plan.adjustsPicked : (kind === "adjust" ? plan.picked : []);
      for (const op of picked) {
        if (state.npcs[op.npcIdx]) state.npcs[op.npcIdx].previewAdjustment = op.toAdj;
      }
      const direction = state.gap > 0 ? 1 : -1;
      state.virtualPlanDelta = kind === "composite"
        ? plan.addSum * plan.addDirection
        : (kind === "add" || kind === "simple-hazard" || kind === "complex-hazard")
          ? plan.sum * direction
          : 0;
      const creatureParts = kind === "composite" ? plan.addParts : (kind === "add" ? plan.parts : []);
      const creatureDirection = kind === "composite" ? plan.addDirection : direction;
      state.previewEntities = creatureDirection > 0
        ? creatureParts.map((part, partIndex) => {
            const candidate = creatureCandidateFor(part, state, idx, partIndex);
            return {
              action: "add", kind: "creature", count: part.count, level: part.level, xp: part.xp,
              name: candidate ? candidate.name : T("npc.levelCreature", { level: part.level }),
              uuid: candidate ? candidate.uuid : null
            };
          })
        : [];
      state.previewActive = true;
      refresh();
    });
  });

  rootEl.querySelectorAll(".preview-creature-link").forEach(button => {
    button.addEventListener("click", async e => {
      e.preventDefault();
      e.stopPropagation();
      if (!button.dataset.creatureUuid) return;
      try {
        const actor = await fromUuid(button.dataset.creatureUuid);
        if (actor && actor.sheet) actor.sheet.render(true);
      } catch (error) {
        console.warn(`[${MODULE_ID}] ${T("notif.candidateOpenFailed")}`, error);
      }
    });
  });

  const sizeInput = rootEl.querySelector(".party-size-input");
  if (sizeInput) {
    sizeInput.addEventListener("change", e => {
      const v = clampFloat(e.target.value, state.partySize);
      if (v !== state.partySize) {
        clearPlanPreview();
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
        clearPlanPreview();
        state.partyLevel = v;
        try { localStorage.setItem("xpMacroPartyLevel", String(v)); } catch (_) {}
        refresh();
      }
    });
  }

  const difficultyInput = rootEl.querySelector(".difficulty-input");
  if (difficultyInput) {
    difficultyInput.addEventListener("change", e => {
      const value = e.target.value;
      if (value === "baseline" || value === "custom" || DIFFICULTY_KEYS.includes(value)) {
        clearPlanPreview();
        state.targetMode = value;
        try { localStorage.setItem("xpToolTargetMode", value); } catch (_) {}
        refresh();
      }
    });
  }

  const customTargetInput = rootEl.querySelector(".custom-target-input");
  if (customTargetInput) {
    customTargetInput.addEventListener("change", e => {
      clearPlanPreview();
      state.customTarget = clampInt(e.target.value, state.customTarget);
      try { localStorage.setItem("xpToolCustomTarget", String(state.customTarget)); } catch (_) {}
      refresh();
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
      clearPlanPreview();
      state.npcs.forEach(n => {
        n.previewAdjustment = n.currentAdjustment;
        n.previewHpBoost = n.currentHpBoost;
        n.previewHpPercent = n.currentHpPercent;
      });
      refresh();
    });
  }

  const undoBtn = rootEl.querySelector("#undo-btn");
  if (undoBtn && !undoBtn.disabled) {
    undoBtn.addEventListener("click", async () => {
      clearPlanPreview();
      undoBtn.disabled = true;
      undoBtn.textContent = T("btn.undoing");
      const result = await undoLastApplication();
      const removedIds = new Set(result.removedTokenIds);
      state.npcs = state.npcs.filter(npc => {
        const token = npc.token && (npc.token.document || npc.token);
        return !token || !removedIds.has(token.id);
      });
      syncNpcAdjustments(state);
      if (result.failed.length === 0) ui.notifications.info(T("notif.undonePlan", { templates: result.restored, creatures: result.removed }));
      else ui.notifications.warn(T("notif.partialUndo", { restored: result.restored, names: result.failed.join(", ") }));
      refresh();
    });
  }

  const applyBtn = rootEl.querySelector("#apply-btn");
  if (applyBtn && !applyBtn.disabled) {
    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = T("btn.applying");
      runtime.lastAppliedBatch = [];
      runtime.lastAddedTokens = [];
      const result = await applyAdjustments(state);
      const additions = await applyPreviewAdditions(state);
      for (const tokenDocument of additions.created) {
        const actor = tokenDocument.actor;
        if (!actor) continue;
        const adjustment = getActorAdjustment(actor);
        state.npcs.push({
          token: tokenDocument.object || tokenDocument, actorId: actor.id, name: tokenDocument.name || actor.name,
          baseLevel: getBaseLevel(actor), currentAdjustment: adjustment, previewAdjustment: adjustment,
          currentHpBoost: getActorHpBoost(actor), previewHpBoost: getActorHpBoost(actor),
          currentHpPercent: getActorHpBoostPercent(actor), previewHpPercent: getActorHpBoostPercent(actor)
        });
      }
      state.previewActive = false;
      state.virtualPlanDelta = 0;
      state.previewEntities = [];
      state.selectedPlanKey = null;
      state.selectedPlanLabel = "";
      const failed = [...result.failed, ...additions.failed];
      if (failed.length === 0) {
        ui.notifications.info(T("notif.appliedPlan", { templates: result.applied, creatures: additions.created.length }));
      } else {
        ui.notifications.warn(T("notif.partialApplied", { applied: result.applied + additions.created.length, names: failed.join(", ") }));
      }
      refresh();
    });
  }
}

export function showXPTool(state) {
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
    buttons: {},
    render: html => {
      const formEl = (html && html[0]) || html;
      if (!formEl) return;
      const contentEl = (formEl.querySelector && formEl.querySelector(".dialog-content")) || formEl;
      rootRef.el = contentEl;
      attachListeners(contentEl, state, refresh);
    }
  }, { width: 720, resizable: true, classes: ["pf2e-xp-tool-dialog", "pf2e-xp-tool-main-dialog"] });

  dialog.render(true);
  loadCreatureCandidates().then(byLevel => {
    state.creatureCandidatesByLevel = byLevel;
    state.themeCandidateCache = new Map();
    state.candidateLoadState = "ready";
    if (rootRef.el && rootRef.el.isConnected) refresh();
  }).catch(error => {
    state.candidateLoadState = "error";
    runtime.creatureCandidatesPromise = null;
    console.warn(`[${MODULE_ID}] ${T("notif.candidateLoadFailed")}`, error);
    if (rootRef.el && rootRef.el.isConnected) refresh();
  });
}

export function buildNpcs(tokens) {
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
      previewAdjustment: adj,
      currentHpBoost: getActorHpBoost(actor),
      previewHpBoost: getActorHpBoost(actor),
      currentHpPercent: getActorHpBoostPercent(actor),
      previewHpPercent: getActorHpBoostPercent(actor)
    };
  });
}

export function buildHazards(tokens) {
  return tokens.filter(t => t && t.actor && t.actor.type === "hazard")
    .map(t => ({ name: t.name || t.actor.name, level: t.actor.level, isComplex: !!t.actor.isComplex }));
}

export function getHazardActors(tokens) {
  return tokens.map(t => t && t.actor).filter(a => a && a.type === "hazard");
}

export function getPCs(tokens) {
  return tokens.filter(t => {
    const a = t && t.actor;
    return !!a && a.alliance === "party" && !(a.traits && a.traits.has && a.traits.has("minion"));
  }).map(t => t.actor);
}

export function openTool(partyLevel, partySize, npcs, hazards, hazardActors) {
  showXPTool(createToolState(partyLevel, partySize, npcs, hazards, hazardActors));
}

export function createToolState(partyLevel, partySize, npcs, hazards, hazardActors) {
  const pwol = !!(game.pf2e && game.pf2e.settings && game.pf2e.settings.variants &&
    game.pf2e.settings.variants.pwol && game.pf2e.settings.variants.pwol.enabled);
  let targetMode = "baseline";
  try { targetMode = localStorage.getItem("xpToolTargetMode") || "baseline"; } catch (_) {}
  if (targetMode !== "baseline" && targetMode !== "custom" && !DIFFICULTY_KEYS.includes(targetMode)) targetMode = "baseline";
  if (targetMode === "baseline" && npcs.length === 0 && hazards.length === 0) targetMode = "moderate";
  let customTarget = 80;
  try { customTarget = clampInt(localStorage.getItem("xpToolCustomTarget"), 80); } catch (_) {}
  return {
    partyLevel, partySize, npcs, hazards, hazardActors, pwol, targetMode, customTarget,
    creatureCandidatesByLevel: new Map(), candidateLoadState: "loading",
    previewActive: false, virtualPlanDelta: 0, previewEntities: [],
    planFilter: "best", selectedPlanKey: null, selectedPlanLabel: "", theme: "", themeMode: "or", quickGroup: "auto"
  };
}

export function askPartyAndOpen(npcs, hazards, hazardActors) {
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
  }, { classes: ["pf2e-xp-tool-dialog", "pf2e-xp-tool-party-dialog"] }).render(true);
}

export function openFromSelection() {
  if (!game.user || !game.user.isGM) {
    ui.notifications.warn(T("notif.gmOnly"));
    return;
  }
  const tokens = (canvas && canvas.tokens && canvas.tokens.controlled) || [];
  const npcs = buildNpcs(tokens);
  const hazards = buildHazards(tokens);
  const hazardActors = getHazardActors(tokens);
  const pcs = getPCs(tokens);
  if (pcs.length === 0) askPartyAndOpen(npcs, hazards, hazardActors);
  else openTool(pcs[0].level, pcs.length, npcs, hazards, hazardActors);
}

globalThis.PF2EXPTool = { open: openFromSelection };

export function injectButton(app, html) {
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

registerI18n();
Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});

Hooks.on("renderMacroDirectory", injectButton);
Hooks.on("renderActorDirectory", injectButton);
Hooks.on("renderMacroDirectoryV2", injectButton);
Hooks.on("renderActorDirectoryV2", injectButton);

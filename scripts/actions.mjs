import { MODULE_ID, T } from "./i18n.mjs";
import { runtime } from "./runtime.mjs";
import { effectiveLevel, getActorAdjustment, getActorHpBoost, getActorHpBoostPercent } from "./core.mjs";

export async function setActorHpBoost(actor, enabled, percent = 0) {
  const flag = actor.getFlag(MODULE_ID, "hpBoost");
  if (enabled && flag) return;
  if (!enabled && !flag) return;
  const hp = actor.system.attributes.hp;
  const preparedMax = Number(hp.max);
  const sourceMax = Number(actor._source?.system?.attributes?.hp?.max ?? preparedMax);
  const derivedMaxAdjustment = preparedMax - sourceMax;
  if (enabled) {
    const damage = Math.max(0, preparedMax - Number(hp.value));
    const boostedPreparedMax = Math.ceil(preparedMax * (1 + percent / 100));
    const boostedSourceMax = boostedPreparedMax - derivedMaxAdjustment;
    await actor.update({
      "system.attributes.hp.max": boostedSourceMax,
      [`flags.${MODULE_ID}.hpBoost`]: { baseMax: preparedMax, sourceMax, preparedMax, boostedPreparedMax, percent }
    });
    await actor.update({ "system.attributes.hp.value": Math.max(0, boostedPreparedMax - damage) });
  } else {
    const basePreparedMax = Number(flag.preparedMax ?? flag.baseMax);
    const baseSourceMax = Number(flag.sourceMax ?? (basePreparedMax - derivedMaxAdjustment));
    const boostedPreparedMax = Number(flag.boostedPreparedMax ?? Math.ceil(basePreparedMax * (1 + Number(flag.percent ?? 0) / 100)));
    const damage = Math.max(0, boostedPreparedMax - Number(hp.value));
    await actor.update({ "system.attributes.hp.value": Math.max(0, basePreparedMax - damage) });
    await actor.update({ "system.attributes.hp.max": baseSourceMax });
    await actor.unsetFlag(MODULE_ID, "hpBoost");
  }
}

export async function applyAdjustments(state) {
  const changed = state.npcs.filter(npcHasPendingChange);
  if (changed.length === 0) return { applied: 0, failed: [] };
  const failed = [];
  const undoEntries = [];
  let applied = 0;
  for (const npc of changed) {
    const actor = (npc.token && npc.token.actor) || (game.actors && game.actors.get(npc.actorId));
    if (!actor) { failed.push(npc.name); continue; }
    try {
      if (npc.currentHpBoost) await setActorHpBoost(actor, false);
      const value = npc.previewAdjustment === "normal" ? null : npc.previewAdjustment;
      if (npc.previewAdjustment !== npc.currentAdjustment) {
        if (typeof actor.applyAdjustment === "function") {
          await actor.applyAdjustment(value);
        } else {
          await actor.update({ "system.attributes.adjustment": value });
        }
      }
      if (npc.previewHpBoost) await setActorHpBoost(actor, true, npc.previewHpPercent);
      undoEntries.push({
        uuid: actor.uuid, actorId: actor.id, name: npc.name,
        adjustment: npc.currentAdjustment, hpBoost: npc.currentHpBoost, hpPercent: npc.currentHpPercent
      });
      npc.currentAdjustment = npc.previewAdjustment;
      npc.currentHpBoost = npc.previewHpBoost;
      npc.currentHpPercent = npc.previewHpPercent;
      applied++;
    } catch (e) {
      console.error(`[${MODULE_ID}] ${T("notif.applyFailed")}:`, npc.name, e);
      failed.push(npc.name);
    }
  }
  if (undoEntries.length > 0) runtime.lastAppliedBatch = undoEntries;
  return { applied, failed };
}

export async function getOrImportCreature(uuid) {
  const existing = game.actors.find(actor => actor.getFlag(MODULE_ID, "sourceUuid") === uuid);
  if (existing) return existing;
  const source = await fromUuid(uuid);
  if (!source || source.type !== "npc" || !source.pack) throw new Error("Creature compendium actor not found");
  const pack = game.packs.get(source.pack);
  if (!pack) throw new Error("Creature compendium not found");
  const actor = await game.actors.importFromCompendium(pack, source.id, {}, { renderSheet: false });
  await actor.setFlag(MODULE_ID, "sourceUuid", uuid);
  return actor;
}

export function getAddedTokenOrigin(state) {
  const grid = canvas.grid.size || 100;
  const sceneRect = canvas.dimensions && canvas.dimensions.sceneRect;
  const docs = state.npcs.map(npc => npc.token && (npc.token.document || npc.token)).filter(doc => doc && Number.isFinite(doc.x) && Number.isFinite(doc.y));
  if (docs.length === 0) {
    return { x: Math.round(canvas.stage.pivot.x / grid) * grid, y: Math.round(canvas.stage.pivot.y / grid) * grid };
  }
  let x = Math.max(...docs.map(doc => doc.x + (Number(doc.width) || 1) * grid)) + grid;
  let y = Math.min(...docs.map(doc => doc.y));
  if (sceneRect && x + grid * 4 > sceneRect.x + sceneRect.width) {
    x = Math.min(...docs.map(doc => doc.x));
    y = Math.max(...docs.map(doc => doc.y + (Number(doc.height) || 1) * grid)) + grid;
  }
  if (sceneRect) {
    x = Math.max(sceneRect.x, Math.min(x, sceneRect.x + sceneRect.width - grid));
    y = Math.max(sceneRect.y, Math.min(y, sceneRect.y + sceneRect.height - grid));
  }
  return { x, y };
}

export async function applyPreviewAdditions(state) {
  const additions = (state.previewEntities || []).filter(entity => entity.action === "add" && entity.kind === "creature");
  if (additions.length === 0) return { created: [], failed: [] };
  if (!canvas.scene) return { created: [], failed: additions.map(entity => entity.name) };
  const origin = getAddedTokenOrigin(state);
  const grid = canvas.grid.size || 100;
  const tokenData = [];
  const failed = [];
  let tokenIndex = 0;
  for (const addition of additions) {
    try {
      if (!addition.uuid) throw new Error("No compendium creature match");
      const actor = await getOrImportCreature(addition.uuid);
      for (let i = 0; i < addition.count; i++) {
        const column = tokenIndex % 2;
        const row = Math.floor(tokenIndex / 2);
        const token = await actor.getTokenDocument({
          x: origin.x + column * grid * 2,
          y: origin.y + row * grid * 2
        });
        const data = token.toObject();
        delete data._id;
        tokenData.push(data);
        tokenIndex++;
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] ${T("notif.addCreatureFailed")}:`, addition.name, error);
      failed.push(addition.name);
    }
  }
  let created = [];
  try {
    created = tokenData.length > 0 ? await canvas.scene.createEmbeddedDocuments("Token", tokenData) : [];
  } catch (error) {
    console.error(`[${MODULE_ID}] ${T("notif.addCreatureFailed")}:`, error);
    failed.push(...additions.map(entity => entity.name).filter(name => !failed.includes(name)));
  }
  runtime.lastAddedTokens = created.map(token => ({ sceneId: canvas.scene.id, tokenId: token.id, name: token.name }));
  return { created, failed };
}

export async function undoLastApplication() {
  if (runtime.lastAppliedBatch.length === 0 && runtime.lastAddedTokens.length === 0) return { restored: 0, removed: 0, removedTokenIds: [], failed: [] };
  const failed = [];
  const remaining = [];
  let restored = 0;
  for (const entry of runtime.lastAppliedBatch) {
    try {
      const actor = (entry.uuid && typeof fromUuid === "function" ? await fromUuid(entry.uuid) : null) ||
        (game.actors && game.actors.get(entry.actorId));
      if (!actor) throw new Error("Actor not found");
      if (getActorHpBoost(actor)) await setActorHpBoost(actor, false);
      const value = entry.adjustment === "normal" ? null : entry.adjustment;
      if (typeof actor.applyAdjustment === "function") await actor.applyAdjustment(value);
      else await actor.update({ "system.attributes.adjustment": value });
      if (entry.hpBoost) await setActorHpBoost(actor, true, entry.hpPercent);
      restored++;
    } catch (error) {
      console.error(`[${MODULE_ID}] ${T("notif.undoFailed")}:`, entry.name, error);
      failed.push(entry.name);
      remaining.push(entry);
    }
  }
  runtime.lastAppliedBatch = remaining;
  const removedTokenIds = [];
  const remainingTokens = [];
  const tokensByScene = new Map();
  for (const entry of runtime.lastAddedTokens) {
    if (!tokensByScene.has(entry.sceneId)) tokensByScene.set(entry.sceneId, []);
    tokensByScene.get(entry.sceneId).push(entry);
  }
  for (const [sceneId, entries] of tokensByScene) {
    const scene = game.scenes.get(sceneId);
    const ids = entries.map(entry => entry.tokenId).filter(id => scene && scene.tokens.has(id));
    try {
      if (scene && ids.length > 0) await scene.deleteEmbeddedDocuments("Token", ids);
      removedTokenIds.push(...ids);
    } catch (error) {
      console.error(`[${MODULE_ID}] ${T("notif.undoAddedFailed")}:`, error);
      failed.push(...entries.map(entry => entry.name));
      remainingTokens.push(...entries);
    }
  }
  runtime.lastAddedTokens = remainingTokens;
  return { restored, removed: removedTokenIds.length, removedTokenIds, failed };
}

export function syncNpcAdjustments(state) {
  state.npcs.forEach(npc => {
    const actor = (npc.token && npc.token.actor) || (game.actors && game.actors.get(npc.actorId));
    if (!actor) return;
    const adjustment = getActorAdjustment(actor);
    const hpBoost = getActorHpBoost(actor);
    const hpPercent = getActorHpBoostPercent(actor);
    npc.currentAdjustment = adjustment;
    npc.previewAdjustment = adjustment;
    npc.currentHpBoost = hpBoost;
    npc.previewHpBoost = hpBoost;
    npc.currentHpPercent = hpPercent;
    npc.previewHpPercent = hpPercent;
  });
  state.openingLevels = state.npcs.map(n => effectiveLevel(n.baseLevel, n.currentAdjustment));
  state.openingHpPercents = state.npcs.map(n => n.currentHpPercent);
}

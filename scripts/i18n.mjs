export const MODULE_ID = "pf2e-xp-tool";
export const L = key => game.i18n.localize(key);
export const T = (key, data) => {
  const full = `PF2EXPTool.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
};

export function registerI18n() {
const I18N_FALLBACK = {
    en: {
      title: "PF2E XP Budget Tool", buttonLabel: "PF2E XP Budget", partyDialogTitle: "Party Info",
      adj: { weak: { label: "Weak", short: "W" }, normal: { label: "Normal", short: "N" }, elite: { label: "Elite", short: "E" } },
      hpBoost: {
        short: "H+", active: "H+{percent}%",
        title: "Fortify to target: +{percent}% HP; effective XP fills remaining budget",
        selectAll: "Fortify all", clearAll: "Clear fortify", allTitle: "Toggle Fortify HP for all selected enemies",
        warning: "Fortify requires +{percent}% HP. Consider selecting more enemies or adding a creature."
      },
      header: { partySize: "Size", partyLevel: "Level", target: "Target", threat: "Current threat", previewThreat: "Preview threat" },
      difficulty: {
        baseline: "Original budget", trivial: "Trivial", low: "Low", moderate: "Moderate",
        severe: "Severe", extreme: "Extreme", custom: "Custom", customXP: "Custom XP target"
      },
      progress: { currentTarget: "{current} / {target} XP", previewCurrentTarget: "Preview: {current} / {target} XP" },
      gap: { match: "On target ✓", under: "{n} short", over: "{n} over" },
      npc: {
        selectedUnits: "Selected units", empty: "No opposition or hazard token selected.",
        hazardsLabel: "Hazards: ", pendingApply: "({n} pending)",
        summary: "{npcs} creature(s)", summaryWithHazards: "{npcs} creature(s) / {hazards} hazard(s)",
        previewAdd: "PREVIEW ADD", previewAddN: "(+{n} preview)", levelCreature: "Lv {level} creature",
        creature: "Creature", level: "Level", xp: "XP", template: "Template", openSheet: "Open creature sheet"
      },
      btn: {
        cancel: "Cancel", calculate: "Calculate XP", close: "Close", reset: "Reset preview",
        applyN: "Apply {n} template change(s)", noChanges: "No pending changes", selectPlan: "Select a plan",
        applying: "Applying…", previewPlan: "Preview this plan", undo: "Undo last apply", undoing: "Undoing…",
        applyPlan: "Apply plan ({templates} templates, {creatures} creatures)",
        applyCreatures: "Add {n} creature(s)", applyMixed: "Apply {templates} change(s) + {creatures} creature(s)"
      },
      notif: {
        gmOnly: "GM-only tool",
        needSelection: "Select at least one opposition or hazard token in the scene (PCs optional)",
        applied: "Applied {n} template change(s)",
        partialApplied: "Applied {applied}; failed: {names}",
        applyFailed: "Failed to apply template", undone: "Restored {n} template change(s)",
        partialUndo: "Restored {restored}; failed: {names}", undoFailed: "Failed to undo template",
        candidateLoadFailed: "Could not load creature compendium suggestions",
        candidateOpenFailed: "Could not open suggested creature", addCreatureFailed: "Could not add suggested creature",
        undoAddedFailed: "Could not remove added creature during undo",
        appliedPlan: "Applied {templates} template change(s) and added {creatures} creature(s)",
        undonePlan: "Restored {templates} template change(s) and removed {creatures} added creature(s)"
      },
      plans: {
        title: "Suggested plans", titleWithCount: "Suggested plans ({shown}/{total})", hazardTitle: "Hazard adjustments",
        theme: "Theme / Traits", themePlaceholder: "Search traits", addTrait: "Add trait", removeTrait: "Remove {trait}",
        themeMode: "Trait matching", themeModeHint: { or: "Match any selected trait", and: "Match every selected trait" },
        noThemeMatches: "No matching creatures at required levels",
        quickGroup: "Quick Adventure Group", quickGroupAuto: "Auto suggestions",
        quickGroupDesc: "{name}: Add {parts}",
        quickGroupNote: "Adds this group to selected units. Compare its XP with the target before applying.",
        quickGroupUnavailable: "No matching creatures at every required level",
        quickGroupOptions: {
          "boss-lackeys": "Boss and Lackeys", "boss-lieutenant": "Boss and Lieutenant",
          "elite-enemies": "Elite Enemies", "lieutenant-lackeys": "Lieutenant and Lackeys",
          "mated-pair": "Mated Pair", troop: "Troop", "mook-squad": "Mook Squad"
        },
        done: "Target met, nothing to adjust ✓", empty: "No plans available", emptyFiltered: "No plans in this strategy",
        selected: "Selected plan", selectionHint: "Choose a suggestion or adjust creatures manually",
        filter: { best: "Best", creatures: "Creatures", templates: "Templates", mixed: "Mixed" },
        noteFallback: "No exact plans; showing closest approximations",
        addDesc: "Add {parts}", removeDesc: "Remove {parts}",
        adjustDescOne: "{name} → {to}",
        adjustDescTwo: "{a} → {ta}, {b} → {tb}",
        adjustDescMore: "{name} → {to} +{extra} more",
        compositeDesc: "{adjust} + {add}", previewHint: "Click row to preview",
        simpleHazard: "simple hazard", complexHazard: "complex hazard",
        addHazardDesc: "Add {type}: {parts}", removeHazardDesc: "Remove {type}: {parts}",
        creatureCandidate: "{count}× {name} · Lv {level}",
        candidatesLoading: "Loading real creature matches…", openCandidateHint: "Click to open suggested creature"
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
      hpBoost: {
        short: "血+", active: "血+{percent}%",
        title: "强化至目标：+{percent}% 生命值；有效 XP 填满剩余预算",
        selectAll: "全部强化", clearAll: "清除强化", allTitle: "切换所有已选敌人的强化生命值",
        warning: "强化需要 +{percent}% 生命值。建议选择更多敌人或添加怪物。"
      },
      header: { partySize: "人数", partyLevel: "等级", target: "目标", threat: "当前威胁", previewThreat: "预览威胁" },
      difficulty: {
        baseline: "原始预算", trivial: "微不足道", low: "低", moderate: "中等",
        severe: "严重", extreme: "极端", custom: "自定义", customXP: "自定义 XP 目标"
      },
      progress: { currentTarget: "{current} / {target} XP", previewCurrentTarget: "预览：{current} / {target} XP" },
      gap: { match: "达标 ✓", under: "缺 {n}", over: "超 {n}" },
      npc: {
        selectedUnits: "已选单位", empty: "未选择任何敌对或陷阱单位。",
        hazardsLabel: "陷阱：", pendingApply: "({n} 项待应用)",
        summary: "{npcs} 怪物", summaryWithHazards: "{npcs} 怪物 / {hazards} 陷阱",
        previewAdd: "预览添加", previewAddN: "（+{n} 预览）", levelCreature: "等级 {level} 怪物",
        creature: "怪物", level: "等级", xp: "XP", template: "模板", openSheet: "打开怪物卡"
      },
      btn: {
        cancel: "取消", calculate: "计算 XP", close: "关闭", reset: "重置预览",
        applyN: "应用 {n} 项模板更改", noChanges: "无待应用更改", selectPlan: "选择方案",
        applying: "应用中…", previewPlan: "预览此方案", undo: "撤销上次应用", undoing: "撤销中…",
        applyPlan: "应用方案（{templates} 个模板，{creatures} 个怪物）",
        applyCreatures: "添加 {n} 个怪物", applyMixed: "应用 {templates} 项更改并添加 {creatures} 个怪物"
      },
      notif: {
        gmOnly: "此工具仅限 GM 使用",
        needSelection: "请至少在场景中选中一个敌对或陷阱 Token（可额外选择 PC）",
        applied: "已应用 {n} 项模板",
        partialApplied: "已应用 {applied} 项；失败：{names}",
        applyFailed: "应用模板失败", undone: "已恢复 {n} 项模板更改",
        partialUndo: "已恢复 {restored} 项；失败：{names}", undoFailed: "撤销模板失败",
        candidateLoadFailed: "无法加载怪物图鉴建议", candidateOpenFailed: "无法打开建议的怪物",
        addCreatureFailed: "无法添加建议的怪物", undoAddedFailed: "撤销时无法移除已添加的怪物",
        appliedPlan: "已应用 {templates} 项模板更改并添加 {creatures} 个怪物",
        undonePlan: "已恢复 {templates} 项模板更改并移除 {creatures} 个已添加怪物"
      },
      plans: {
        title: "推荐方案", titleWithCount: "推荐方案 ({shown}/{total})", hazardTitle: "陷阱调整",
        theme: "主题 / 特征", themePlaceholder: "搜索特征", addTrait: "添加特征", removeTrait: "移除 {trait}",
        themeMode: "特征匹配", themeModeHint: { or: "匹配任一选定特征", and: "匹配所有选定特征" },
        noThemeMatches: "所需等级没有匹配主题的生物",
        quickGroup: "快速冒险队伍", quickGroupAuto: "自动推荐",
        quickGroupDesc: "{name}：添加 {parts}",
        quickGroupNote: "将此队伍添加到已选单位。应用前请比较经验值与目标。",
        quickGroupUnavailable: "所需等级缺少匹配的生物",
        quickGroupOptions: {
          "boss-lackeys": "首领与喽啰", "boss-lieutenant": "首领与副手",
          "elite-enemies": "精锐敌人", "lieutenant-lackeys": "副手与喽啰",
          "mated-pair": "成对敌人", troop: "小队", "mook-squad": "杂兵群"
        },
        done: "已达成目标，无需调整 ✓", empty: "无可用方案", emptyFiltered: "此策略无可用方案",
        selected: "已选方案", selectionHint: "选择推荐方案或手动调整怪物",
        filter: { best: "最佳", creatures: "怪物", templates: "模板", mixed: "混合" },
        noteFallback: "无精确方案，显示最接近的近似方案",
        addDesc: "添加 {parts}", removeDesc: "移除 {parts}",
        adjustDescOne: "{name} → {to}",
        adjustDescTwo: "{a} → {ta}, {b} → {tb}",
        adjustDescMore: "{name} → {to} +{extra} 项",
        compositeDesc: "{adjust} + {add}", previewHint: "点击行预览",
        simpleHazard: "简单陷阱", complexHazard: "复杂陷阱",
        addHazardDesc: "添加{type}：{parts}", removeHazardDesc: "移除{type}：{parts}",
        creatureCandidate: "{count}× {name} · 等级 {level}",
        candidatesLoading: "正在加载实际怪物匹配…", openCandidateHint: "点击打开建议的怪物"
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
    game.i18n.translations.PF2EXPTool = foundry.utils.deepClone(I18N_FALLBACK[key] || I18N_FALLBACK.en);
  });

}

# pf2e-xp-tool 发布流程

## 仓库结构

```
pf2e-xp-tool/
├── module.json                  # FVTT 模组描述（id / version / manifest / download / compatibility 等）
├── scripts/main.js              # 主代码（Hooks 注册按钮 + XP 工具实现）
├── styles/main.css              # UI 样式（已用 .xp-tool 命名空间隔离）
├── .github/
│   ├── workflows/release.yml    # 推 tag 自动构建 release
│   └── release-body-template.md # release notes 模板
├── .gitignore
├── README.md
└── RELEASE_PROCESS.md           # 本文件
```

## 每次发布的标准流程

### 1. 修改代码

在 `scripts/main.js` / `styles/main.css` 改完后，本地放入 FVTT modules 目录测试通过。

### 2. 同步更新 `module.json`（三处必改）

把 `X.Y.Z` 替换为新版本号：

| 字段 | 新值 |
|---|---|
| `version` | `X.Y.Z` |
| `download` | `https://github.com/takaqiao/pf2e-xp-tool/releases/download/X.Y.Z/pf2e-xp-tool-vX.Y.Z.zip` |
| `changelog` | `https://github.com/takaqiao/pf2e-xp-tool/releases/tag/X.Y.Z` |

`manifest` 字段固定指向 `releases/latest/download/module.json`，不用动。

### 3. Commit & push

```bash
git add -A
git commit -m "release: vX.Y.Z - <简要变更>"
git push
```

### 4. 打 tag 并推送（触发 release workflow）

```bash
git tag X.Y.Z
git push origin X.Y.Z
```

> 注意 tag 名不带 `v` 前缀（workflow 用 `[0-9]+.[0-9]+.[0-9]+` 匹配）。

### 5. 等 GitHub Actions 跑完

`.github/workflows/release.yml` 会：
1. 校验 `module.json` 的 `version` == tag
2. 校验 `download` URL 含正确 tag 与 zip 名
3. 打包 zip（排除 `.git/` `.github/` `RELEASE_PROCESS.md` `README.md` `*.zip` 等）
4. 创建 GitHub Release，附上 `module.json` 和 `pf2e-xp-tool-vX.Y.Z.zip`
5. 如果配置了 `FOUNDRY_RELEASE_TOKEN` secret，则推送到 foundryvtt.com 包注册表

### 6. 验证 release

打开 https://github.com/takaqiao/pf2e-xp-tool/releases/latest 确认有两个文件：
- `module.json`（FVTT manifest 检查更新用）
- `pf2e-xp-tool-vX.Y.Z.zip`（FVTT 下载用）

FVTT 端粘贴 manifest URL：
`https://github.com/takaqiao/pf2e-xp-tool/releases/latest/download/module.json`

## 常见错误

- **忘记同步 `module.json` 的 `version`**：workflow 第一步会失败
- **`download` URL 与 tag 不一致**：workflow 第二步会失败
- **tag 名带了 `v` 前缀**（写成 `v1.0.1`）：workflow 不会触发（只匹配纯数字版本）
- **改了代码但没打新 tag**：FVTT 端不会获得更新

## Foundry 包注册表（可选）

要让 foundryvtt.com 的模组页自动显示新版本：

1. 去 https://foundryvtt.com/auth/profile/ 申请 packages release token
2. 在 GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret
3. Name: `FOUNDRY_RELEASE_TOKEN`，Value: 上面拿到的 token
4. 后续每次 release workflow 跑完会自动通知 foundryvtt.com

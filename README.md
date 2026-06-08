# VibePet

VibePet 是一个面向 Windows 的 Electron 桌面宠物。它监听 Codex / Claude 的 hooks，把每个 AI 会话显示成一只可拖动、置顶的透明小宠物，并根据会话状态切换不同 GIF 动画。

## 项目简介

- 一个 `provider + session_id` 对应一只宠物，当前支持 Codex 和 Claude。
- 支持 `idle`、`working`、`waiting`、`completed` 四种状态动画。
- 左键拖动宠物，右键打开菜单，可查看历史、打开设置、安装/卸载 hooks、隐藏或关闭宠物。
- Windows 托盘常驻，窗口最小化后可从托盘恢复，也可以从托盘完全退出。
- 主程序未运行时，hook 事件会先写入本地 spool，下一次启动后再补处理。
- 支持自定义 GIF 组，默认素材位于 `assets/gif-packs/default`。

## 安装方法

### 环境要求

- Windows
- Node.js 20 或更新版本
- 已安装 Codex 或 Claude，并且对应工具支持 hooks

### 本地运行

```powershell
npm install
npm test
npm run build
npm start
```

说明：

- 需要先执行 `npm run build`，再执行 `npm start` 启动 Electron。
- 项目里的 `.npmrc` 只配置了 Electron 下载镜像：`https://npmmirror.com/mirrors/electron/`。如果你不需要国内镜像，可以自行删除或修改。
- 启动后会先打开设置窗口，点击「安装 Hooks」即可把 VibePet 的 hook 命令写入当前用户配置。

### Hooks 写入位置

VibePet 会写入用户级配置，不会把这些配置放进仓库：

- Codex：`%USERPROFILE%\.codex\hooks.json`
- Claude：`%USERPROFILE%\.claude\settings.json`

首次写入前会备份原文件，备份目录为：

```text
%LOCALAPPDATA%\VibePet\backups
```

### 自定义 GIF 和宠物类型

想维护自己的宠物类型时，只需要在 `assets/gif-packs/` 下新建一个文件夹，并按固定命名规则往里面放 GIF 文件即可。文件夹名就是设置页下拉框里的 GIF 组 ID，建议使用英文、数字和连字符，例如 `pixel-cat`、`office-dog`。

每个宠物类型至少需要包含：

```text
assets/gif-packs/your-pack-name/
  idle.gif
  working.gif
  waiting.gif
```

命名规则：

- `idle.gif`：空闲状态动画。
- `working.gif`：工作中状态动画。
- `waiting.gif`：等待用户输入状态动画。
- `completed.gif`：完成状态动画，可选；缺少时会复用 `idle.gif`。

缺少 `idle.gif`、`working.gif`、`waiting.gif` 任意一个时，该宠物类型不会被加载。本地私有素材建议放到 `assets/gif-packs/local*/` 或 `assets/gif-packs/private*/`，这些路径已被 `.gitignore` 排除。

## 实现原理

1. Electron 主进程启动本地 HTTP 服务，监听 `http://127.0.0.1:44557/hook-event`。
2. 设置页点击「安装 Hooks」后，`src/main/hooks.ts` 会把 hook 命令写入 Codex / Claude 的用户级配置。
3. hook 命令会执行 `scripts/hook-dispatcher.mjs`，它从 stdin 读取 hook payload，然后 POST 到 VibePet 本地服务。
4. 如果 VibePet 没有运行，dispatcher 会把事件写入 `%LOCALAPPDATA%\VibePet\spool`，下次启动时由 `src/main/storage.ts` 补消费。
5. `src/shared/session.ts` 根据 `session_id`、`cwd`、`transcript_path` 等字段生成会话 ID。
6. `src/shared/stateMachine.ts` 根据 hook 事件名和 payload 关键词判断宠物状态。
7. `src/shared/summarizer.ts` 把事件压缩成历史摘要，设置页和历史窗口通过 preload 暴露的 IPC API 读取快照。

主要数据保存在：

```text
%LOCALAPPDATA%\VibePet\data.json
```

## 注意事项

- 当前无法稳定通过 Codex hook 判断 Codex 已经退出；如果 Codex 没有发出可识别的退出事件，宠物不会自动消失，想关闭宠物需要右键宠物选择「关闭」，或从托盘选择「完全退出」。
- 状态判断主要依赖事件名和 payload 里的关键词，可能不准确。需要调整时改 `src/shared/stateMachine.ts`，建议同步补充 `src/shared/stateMachine.test.ts`。
- `Stop`、`Complete`、`Done`、`Finished` 等事件只会把宠物标记为 `completed`，不会自动关闭宠物窗口。
- 本地服务固定监听 `127.0.0.1:44557`，如果端口被占用，需要修改 `src/main/storage.ts` 里的 `INGEST_PORT`，以及 `scripts/hook-dispatcher.mjs` 里的 `INGEST_URL`。
- 本项目优先面向 Windows；macOS / Linux 没有完整验证。
- 发布到 GitHub 前建议补充适合你的开源许可证，例如 MIT、Apache-2.0 或 GPL 系列。

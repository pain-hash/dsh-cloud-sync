# dsh-cloud-sync

Sync DeepSeek Harness conversations and selected workspace folders between
computers through one folder that a cloud drive already keeps in sync
(OneDrive, Nutstore/坚果云, Nextcloud, Dropbox, Baidu Netdisk, ...).

The plugin never talks to the network and stores no account credentials. Your
cloud client is the transport; the plugin owns conflict-safe mirroring.

## 中文说明

把 Harness 的会话和指定的工作区目录镜像到一个**已被云盘客户端同步的本地文件夹**，再在另一台电脑上指向同一个文件夹，就能双向同步。

- 会话：每个会话导出为 `conversations/<会话ID>.json`。按事件前缀比较：另一台电脑续聊会追加；两边独立分叉时，远端分支会保留成一个单独会话，不覆盖。
- 工作区文件：每个项目镜像到 `files/<项目ID>/`。单边修改直接同步；两边都改则把远端版本保留为 `名称.sync-conflict-设备名-时间.ext`，本地版本继续上传。
- 默认跳过 `node_modules`、`.git`、`dist`、`build`、`.cache`、`.venv` 等目录，以及超过单文件上限的文件。
- 自动同步：启动 15 秒后先同步一次，之后按间隔运行；也可以手动“立即同步”。

### 安装与配置

1. 在 Harness 的 设置 → 插件 中安装 `@pain-hash/dsh-cloud-sync`（插件市场索引或 npm 包）。
2. 刷新页面，打开 设置 → 同步。
3. 点“浏览…”选择云盘同步文件夹（必须已存在，且不能和工作区目录互相包含）。
4. 给每台电脑不同的设备名；两台电脑的项目 **ID 必须相同**，目录路径可以不同。
5. 保存 → 立即同步。另一台电脑做同样配置即可。

两台电脑的 Harness 版本、插件清单要各自保持一致；本插件只同步会话和工作区文件，不同步 Harness 的 profile 或插件安装目录。

## English

### What it syncs

- **Conversations**: every top-level session as one readable
  `conversations/<session-id>.json` snapshot. Append-only logs are compared by
  prefix, so a conversation continued on another computer is appended locally;
  two independent branches preserve the remote branch as a separate session
  instead of overwriting it.
- **Workspace files**: each configured project folder is mirrored to
  `files/<project-id>/`. Files changed on one side are copied to the other;
  files changed on both sides keep the remote version as
  `name.sync-conflict-<device>-<timestamp>.ext` before the local version wins.
  `node_modules`, `.git`, build output and files over the size limit are
  skipped.

### Setup

1. Install `@pain-hash/dsh-cloud-sync` from the plugin market or npm.
2. Refresh the page and open **Settings → Sync**.
3. Pick a local folder your cloud drive already syncs. It must exist and must
   be outside the project folders (a project may not contain the sync folder
   and vice versa).
4. Give each computer a different device name. Keep the project **ID** the same
   on every computer; the folder path may differ.
5. Save, then **Sync now**. Repeat on the other computer with the same sync
   folder and project IDs.

### How the transport works

The plugin writes ordinary files into the cloud folder; it does not implement
network transport, accounts, or encryption. OneDrive, Nutstore, Nextcloud,
Dropbox, Baidu Netdisk, or any client that mirrors a local folder works.

### Safety and privacy

- Conversation snapshots contain full prompts, tool output, and absolute
  paths. Only point the plugin at a cloud folder you trust with that content.
- Images and uploaded attachments referenced by a conversation are not copied
  yet; the text history syncs, but an image may be missing on the other
  computer.
- The plugin does not delete a local file because the remote copy disappeared;
  remote deletions are treated as a reason to restore the remote copy. A local
  deletion propagates to an unchanged remote file.
- Conflict copies are additive: nothing is silently discarded.
- Settings and device identity are stored under `~/.dsh/dsh-cloud-sync/` and
  are not part of the cloud folder.

### Requirements

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`
- Node.js 22+ (the Harness runtime)
- A cloud client that syncs one local folder between the computers
- Git only when the market entry installs from a Git source; the npm source and
  a manual folder/ZIP install do not need it

### Known limitations

- Attachments are not synchronized yet.
- Subagent conversations are not exported.
- The settings page uses the Web GUI's same-origin HTTP route. The Desktop
  `file://` shell may not reach it; the Web GUI is the supported surface.
- Folder mirroring is tested on Windows; macOS/Linux path handling exists but
  has not been exercised in the field.
- Error messages from the Host are currently Chinese-first.

## License

MIT. See [LICENSE](./LICENSE).

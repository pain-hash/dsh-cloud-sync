# 不用 npm，直接用 GitHub 发布

你的网络打不开 npm 网站时，可以完全不发布 npm：**插件市场索引支持 `source.type: "git"`**，直接从这个 GitHub 仓库的某个 commit 安装。

## 一、用网页上传到 GitHub（不需要装 Git）

1. 打开 <https://github.com/new>。
2. Repository name 填 `dsh-cloud-sync`，选 **Public**，不要勾选 “Add a README file”（空仓库最好上传）。
3. 点 **Create repository**。
4. 在空仓库页面点 **Add file → Upload files**。
5. 在文件资源管理器打开：
   ```text
   F:\harness workplace\dsh-cloud-sync
   ```
   按 `Ctrl+A` 选中里面的**所有文件和文件夹**（不是选中 `dsh-cloud-sync` 文件夹本身），拖到网页的上传区域。
6. 确认页面上出现这些相对路径：
   ```text
   package.json
   index.js
   engine.js
   sessions.js
   client.js
   cordis.patch.yml
   icon.svg
   index.json
   README.md
   LICENSE
   PUBLISHING.md
   locale/en.json
   locale/zh.json
   ```
   如果 `locale` 文件夹没有带上去，用 **Add file → Create new file**，文件名输入 `locale/en.json`，粘贴内容；再建 `locale/zh.json`。
7. 下方 Commit message 填 `dsh-cloud-sync 1.0.0`，点 **Commit changes**。
8. 等上传完成，确认仓库根目录能看到 `package.json`。

## 二、拿到 commit 的完整 SHA

1. 点仓库上方的 **Commits**（或刚上传后页面上的 commit 信息）。
2. 打开最新一次 commit。
3. 在 commit 标题右侧找到 **Copy full SHA**（或从地址栏 `/commit/<40位>` 里复制）。
4. 这个 40 位十六进制字符串就是 `index.json` 里要填的 `commit`。

## 三、把 SHA 填进 index.json

1. 在仓库里点 `index.json`，点右上角铅笔图标 **Edit this file**。
2. 找到：
   ```json
   "commit": "0000000000000000000000000000000000000000"
   ```
   替换成刚才复制的 40 位 SHA。
3. 点 **Commit changes**。

注意：这次修改会产生一个新的 commit，但 `index.json` 指向的是**上一次**包含插件文件的 commit，这是正常的。以后更新插件时，重复“上传新文件 → 拿新 SHA → 改 index.json”即可。

## 四、开启 GitHub Pages，得到索引地址

1. 仓库 **Settings → Pages**。
2. **Build and deployment → Source** 选 **Deploy from a branch**。
3. Branch 选 `main`，目录选 `/ (root)`，点 **Save**。
4. 等 1–2 分钟，访问：
   ```text
   https://pain-hash.github.io/dsh-cloud-sync/index.json
   ```
   应该直接看到 JSON。这个地址就是插件市场的“索引 URL”。

如果 `github.io` 打不开，索引可以改放到 Gitee Pages、阿里云 OSS、腾讯云 COS、jsDelivr 等能公网直连的地方；要求是 HTTPS、直接 200、不重定向。

## 五、在 DSH 里安装

1. 设置 → 插件 → **Experimental plugins** → 打开 **Custom plugin indexes**。
2. Discover → 添加：
   ```text
   https://pain-hash.github.io/dsh-cloud-sync/index.json
   ```
3. 搜索 `dsh-cloud-sync`，安装。

**注意**：Git 源安装时，本机需要安装 Git（pnpm 会用 `git` 去拉仓库）。如果不想装 Git，也可以直接在 GitHub 仓库点 **Code → Download ZIP**，解压后从本地文件夹安装；市场入口只是方便发现。

## 六、如果以后 npm 能用了

`index.npm.json` 是 npm 版本（`source.type: "npm"`）。发布 npm 后，把它改名为 `index.json` 提交即可，用户安装时就不需要 Git。

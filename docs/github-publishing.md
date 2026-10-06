# 发布到 GitHub

请从经检查的纯源码包建立新的空仓库，不要把当前开发目录的 `.git` 一起上传。当前本地 Git 历史保留了旧版实现；只删除工作区里的旧文件，不会删除历史提交中的文件。

## 发布步骤

1. 解压纯源码包到一个新目录，确认其中有 `README.md`、`package.json`、`app/`、`android/`、`functions/`、`migrations/`、`server/` 和 `scripts/`。
2. 确认没有 `.git/`、`private/`、`wrangler.jsonc`、`.env.local`、`.dev.vars`、`out/`、`node_modules/`、`outputs/`、真实截图或账单导出文件。
3. 在新目录运行 `npm ci` 和 `npm run check`。
4. 在 GitHub 创建空仓库，再从这个新目录初始化 Git 并提交、推送。不要直接推送原开发目录的 Git 历史。

`.gitignore` 只能阻止正常的 Git 添加操作；在网页上手动上传文件时，仍需按第 2 步检查。快捷指令的 iCloud 分享链接也要在发布前检查：安装时应填写部署者自己的网页地址和固定用户名，识别与保存请求都应发送到该部署者的网址，并带同一个 `user_key`。

Android 的 `.flo` 文件也需检查：应在首次运行时询问网页地址和固定用户名，不能保留维护者的测试站、旧服务地址或私人账单。发布后请在一台 Android 设备上完成导入和截图记账测试。

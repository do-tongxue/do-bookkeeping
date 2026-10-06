# 记一笔

一个开源的个人与家庭记账工具。你可以用 iPhone 快捷指令或 Android Automate 截取支付页面，自动识别商户、金额等信息；也可以在网页手动或语音记账。确认后，账目会保存到自己的账本，并可在网页查看流水和统计。

项目部署在你自己的 Cloudflare 账号中：Pages 提供网页和接口，Workers AI 整理截图与语音文字，D1 保存账本和记录。

## 开始使用

在电脑下载源码，安装 Node.js 22.13+，运行 `npm run install:all`，按提示授权 Cloudflare。部署完成后打开网页创建账本，再按手机系统安装对应的记账工具：

- iPhone：[安装快捷指令](docs/iphone-shortcut.md)
- Android：如选择使用第三方 Automate，请先了解[安装与权限说明](docs/android-automate.md)，再导入 flow；也可以只用网页手动记账。

完整步骤见[安装说明](docs/one-click-install-flow.md)。准备上传 GitHub 时见[发布说明](docs/github-publishing.md)。

## 本地检查

```sh
npm ci
npm run check
```

许可证：MIT。

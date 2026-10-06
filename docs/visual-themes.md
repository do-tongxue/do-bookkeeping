# 页面皮肤

| 标识 | 名称 | 样式来源 |
| --- | --- | --- |
| `dashu-green` | 大树绿 | `app/globals.css` 中保留的原版完整布局、组件与视觉样式；原版图表配色在 `app/visual-themes.css` 中单独列出 |
| `mist-paper` | 浅青色 | 在原版之上叠加 `app/visual-themes.css` 的浅青色视觉规则，使用 `public/mist-paper-texture.svg` |
| `deep-ink-blue` | 深墨蓝 | 在原版之上叠加 `app/deep-ink-blue.css` 的深蓝色视觉规则 |
| `neon-lime` | 暗黑荧光绿 | 在原版之上叠加 `app/neon-lime.css` 的白底、深炭卡片与青柠色视觉规则 |

当前默认皮肤由 `app/visual-theme.ts` 的 `ACTIVE_VISUAL_THEME` 控制，为 `"deep-ink-blue"`（深墨蓝）。用户可在「我的 → 皮肤」即时切换四套皮肤；选择保存在当前浏览器的 `localStorage` 键 `qingzhang-visual-theme`，与账本 IndexedDB 数据独立。首次打开、选项失效或浏览器存储不可用时，回退到深墨蓝。不同设备的皮肤选择不会自动同步。

大树绿的基础布局与视觉样式完整保留在当前 `app/globals.css`。后续新增的统计搜索控件样式独立放在 `app/stats-search.css`，各套皮肤共用。切换皮肤只影响页面视觉；顶部账本类型、成员标签和账单数据仍由原有状态与数据逻辑决定。

分类选项包含原有分类、云端识别规范中的分类、自定义分类，以及已有账目里的分类。图标由 `lib/category-icons.ts` 统一决定；无法匹配语义图标的新名称显示自身前两个字符，而不是共用收据图标。名称及历史交易数据均不更改。

部署请使用项目安装脚本，它会同时上传网页和 Pages Functions。仅上传 `out` 静态目录不会包含记账接口。

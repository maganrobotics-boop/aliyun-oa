# OA 实时字幕连接配置 · 2026-10-14

用户要求在 `/admin` 现有模型设置下添加另一组语音地址。新增“实时字幕”卡片，预填千问普通接口地址，支持普通 API Key、验证保存和检测已保存连接。

## 行为

- 现有聊天模型表单保持独立；语音操作通过 `saveSubtitleConfig` / `testSubtitleConfig` 转发到 Chat 签名管理桥。
- 沿用 OA 管理员权限、独立管理密码、同源校验、限流与 HttpOnly 会话。浏览器不会收到密钥原文。
- Key 验证成功后由 Chat 加密存入独立配置，空输入保留旧语音 Key，失败保留旧配置。
- 仅验证 WebSocket 认证、双向会话和正常结束；没有上传录音，未验证真实翻译。保存不启用公众字幕功能。
- Harness 语音识别额度能否抵扣 LiveTranslate 尚未确认，页面不承诺免费。

## 配套与验证

后端配套位于 `maganrobotics-boop/aliyun-chat` 草稿 PR #9。仅上线后台配置时，按现网副本增量叠加后台相关模块，不得整包部署尚未验收的字幕功能。

现网基线：`/opt/omindos-deploy/releases/oa-assistant-name-20261014-v1`。
隔离候选：`/opt/omindos-deploy/staging/subtitle-admin-20261014/oa`。
TypeScript 检查与 Next.js 国内构建通过。实际表单的浏览器验收脚本 `scripts/check-subtitle-admin-browser.mjs` 仅使用合成 API，不访问生产数据。

脚本需要 `ESBUILD_MODULE`、`UI_NODE_MODULES`（React、ReactDOM、lucide-react）、`PLAYWRIGHT_MODULE` 和 `BROWSER_REPORT_DIR`。
已通过桌面 1280px / 手机 390px 的合成 API 表单检查：默认地址、隐藏密钥输入、保存成功清空输入、空输入保留语音 Key、失败提示和聊天配置独立性。

浏览器环境若使用自带 Chromium，可设置 `CHROMIUM_MODULE` 和 `CHROMIUM_EXECUTABLE`；不需要访问生产登录或真实 Key。

## 后台配置已发布（2026-10-14）

- 用户授权添加独立语音地址，已增量发布到 `https://oa.omindos.cn/admin`，聊天配置仍独立。
- OA release：`/opt/omindos-deploy/releases/oa-subtitle-admin-20261014-v1`。
- Chat release：`/opt/omindos-deploy/releases/chat-subtitle-admin-20261014-v1`。只增量加入管理桥、语音配置和无音频连接验证模块，保留生产批改功能。
- 两服务启动与 HTTP 200 检查通过，未登录管理 API 仍返回 401。完整字幕发布暂停文件保留，尚未启用公众字幕。
- 23 项配置/桥接/字幕/传输测试、OA 类型检查和国内构建通过。实际后台组件在合成 API 下通过 1280px 与 390px 保存、空 Key、失败保留输入及无横向溢出检查；测试浏览器缺少中文字体，字形不作为该截图的验收依据。
- 首次发布因候选文件属于 root 导致服务无法读取，已自动回滚；按现有服务账户设置 release 所有者后重试成功。未更改 systemd 安全限制。
- 下一步：用户在新卡片填写普通 Key 并验证。之后继续真实中日音频、录音完整性验收，单独决定完整字幕发布。
- 全功能旧候选 `/opt/omindos-deploy/staging/live-subtitles-20261014` 未更新，后续必须基于本次后台 release 和 PR #9 最新代码重建，避免覆盖新配置入口。

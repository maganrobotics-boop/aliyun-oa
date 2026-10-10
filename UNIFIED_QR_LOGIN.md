# OA 统一扫码登录

电脑显示一个 OA 地址二维码。飞书或企业微信扫码后，在各自平台验证身份，再核对电脑验证码并在手机确认。只有发起请求的电脑浏览器能领取 OA 会话；二维码本身不包含会话凭证。二维码有效期为 5 分钟。

企业微信首次使用需要先通过已有方式登录 OA，在「右上角姓名 → 设置 → 账号绑定 → 绑定企业微信」关联本人身份。手机确认页同时显示企微身份、目标 OA 成员姓名及脱敏账号提示，确认两者均属于本人后再绑定。之后飞书和企微都进入同一成员账号，沿用原来的资料、申请、权限和 NDA 状态。不会按姓名或邮箱自动合并账号，不会为未绑定企微身份创建成员。

## 当前状态：2026-10-10 已正式上线

- 正式入口：`https://oa.omindos.cn/`，飞书和企业微信扫码均已启用。绑定入口是「右上角姓名 → 设置 → 账号绑定 → 绑定企业微信」。
- 用户本人 13:53:39 完成企微 OAuth 与绑定，13:56:24 退出后使用企微扫码登录成功；后台核对飞书、企微关联同一 OA 成员。未伪造身份或创建验收成员。已有飞书登录和原本机备用入口保留。15:31:05 用户本人完成新版飞书手机客户端扫码授权、电脑验证码确认和 OA 会话领取；页面显示原系统管理员账号，企业微信已绑定同一账号。刷新后仍保持登录；15:33 退出后恢复游客页面，并核对本次服务端会话已删除。
- PR #10 已合并，合并提交 `103625a23c5134423f9c20d39f9c80abb9f961f2` 与已验证候选 `ec59adb0031e403a0b979ad3e9901ffae38c7485` 全树相同。正式服务运行 `/opt/omindos-deploy/releases/oa-unified-ec59adb0031e`，端口 3000；两个 OA current 链接均指向该目录。
- 正式 systemd 附加配置为 `/etc/systemd/system/originmind-oa.service.d/zzzzzzzzzzz-unified-login.conf`，读取 root 0600 的 `/etc/originmind-oa/wecom-login.env`。`OA_UNIFIED_QR_LOGIN_ENABLED` 和 `WECOM_LOGIN_ENABLED` 均为 true。原有业务、飞书及会话相关环境值经逐项比较保持不变。
- 正式 Nginx 包含 `/etc/nginx/snippets/oa-unified-login-locations.conf`，扫码接口均代理端口 3000，OAuth 回调关闭 access log。旧验收链接只清理临时路由 Cookie 并跳转首页；旧路由 map 已移除，验收服务已停止。
- 公网验收通过：首页、姓名设置组件、两种扫码提供方、五分钟二维码生成/状态/取消、未登录绑定拒绝、跨域拒绝、旧验收链接跳转、企微域名验证文件与 chat 入口。停止验收服务后再次确认正式二维码接口正常。
- 发布前新增完整 SQLite 在线备份与配置备份：`/opt/omindos-deploy/checkpoints/unified-login-20261010/production-release/`；备份完整性为 ok。保留 226 个旧静态文件后，服务用户预检通过 333 个文件。当前候选依赖已有 release 中的 node_modules，因此相关旧 release 仍须保留。
- 本轮服务端只读复核：企微应用已启用、可信域名为 `oa.omindos.cn`，获取 token、读取应用及读取 4 位直接可见成员均成功；可见范围返回 4 位成员、2 个部门，4 位列出的成员均已激活。部门内总人数未展开统计。原先“1 位成员”为早期记录；其他成员需在应用可见范围内，再用原 OA 账号完成本人企微绑定。
- 回退代码/配置时可以恢复上一发布 `/opt/omindos-deploy/releases/oa-library-5ee312888763` 及发布前配置，**不要恢复旧数据库**，避免丢失真实绑定或后续业务数据。详细原始配置和完成时间以服务器受保护的 `canary-state.json` 及 production-release 检查点为准。


- 本次飞书真实会话的数据库有效期为 168 小时，未撤销时刷新可继续访问，退出后服务端会话删除。**这是期限及当前会话行为验证，不代表已经经过七天持续实测。**
- 发布后只读逐行比对生产与发布前备份：24 个成员（排除 `last_seen_at`）、42 份审批、88 条审批修订、92 条审批事件、558 份资料、4845 个知识块、1216 条资料事件、565 条资料修订、447 个修订分片、1255 个修订资产记录均一致。成员角色、权限及 NDA 状态保持不变；生产及备份 SQLite 检查均为 ok。
- 补录真实飞书验收证据；本轮只更新运维记录与本文档，未重复部署、迁移或重启服务，原发布备份和回滚路径保持有效。

以下为历史准备和验收记录，状态以上节为准。

## 管理员配置

### 飞书

在当前 OA 飞书应用的 OAuth 重定向 URL 中新增：

```
https://oa.omindos.cn/api/auth/qr/callback/feishu
```

保留现有 `/api/auth/feishu/callback`，供「在本机打开飞书登录」备用入口使用。沿用已有 `FEISHU_LOGIN_*` 配置。应用必须允许目标企业成员授权；新流程严格要求返回的 tenant_key 与已配置企业一致。

### 企业微信

使用本企业的自建 OA 应用，并配置该应用的网页授权可信域名 `oa.omindos.cn`、需要的域名校验文件、可信 API IP 和成员可见范围。以下 Secret 必须属于该 AgentID 对应的应用；不要使用通讯录同步 Secret。服务端验证需要使用同一个应用 token 调用成员身份及读取成员接口，接口拒绝或成员非激活状态都会拒绝登录。

在服务器受保护的环境文件配置，实际凭证不应写入仓库或聊天：

```dotenv
OA_PUBLIC_ORIGIN=https://oa.omindos.cn
WECOM_LOGIN_ENABLED=true
WECOM_LOGIN_CORP_ID=<本企业 CorpID>
WECOM_LOGIN_AGENT_ID=<OA 应用 AgentID>
WECOM_LOGIN_APP_SECRET=<同一 OA 应用 Secret>
OA_UNIFIED_QR_LOGIN_ENABLED=true
```

企微授权回调由服务端固定生成：

```
https://oa.omindos.cn/api/auth/qr/callback/wecom
```

企微配置缺失时，页面只提示当前可用的平台。该功能不接入审批消息或待办推送，不改变业务数据接口。

## 2026-10-10 设置入口修复

- 在右上角姓名菜单的「设置」顶部加入「账号绑定 → 企业微信」，直接展开现有企微绑定二维码。先读取当前成员真实绑定状态，仅在点击按钮后创建绑定请求；关闭二维码或设置面板会取消未完成请求。
- 已绑定显示状态；未启用或加载失败时给出明确提示，加载失败可重试。企微登录后的「登录方式」显示「企业微信」。原个人设置入口保留。
- 类型检查和改动文件 lint 通过（仅原有头像 img 的两条警告）；独立界面夹具以 1280px 与 390px 验证姓名菜单进入设置、首次绑定、取消、成功状态、已绑定、未启用和错误重试。夹具使用虚构身份与模拟响应，不代表真实 OAuth 已通过。
- 本次仅更新受控验收版本；本人手机授权与正式入口切换仍待完成。

## 2026-10-10 验收入口状态（北京时间 13:36）

- 服务器已安全录入自建应用凭据；获取 token、读取应用、读取可见成员均成功。AgentID 为 `1000002`，应用启用，可信域名确认是 `oa.omindos.cn`，当前可见范围为 1 位激活成员。可信 IP 已由用户在企微后台保存，接口不再报 60020。没有回显 Secret、token、成员身份或完整上游错误。
- 运行候选 `b64735aa453dbf030b5b14426f1ab3c6661e4923` 已在阿里云完成生产构建、服务账号文件访问预检和 HTTP 登录保护检查。候选服务 `originmind-oa-login-canary.service` 监听 `127.0.0.1:3099`，与正式服务独立运行。
- 验收入口：`https://oa.omindos.cn/login-check-b64735aa`。仅此入口设置两小时的路由 Cookie；手机 `/auth/qr` 会同步进入候选。该 Cookie 只选择版本，不授予登录身份或 OA 权限。默认访问仍进入端口 3000 的 `oa-library-5ee312888763`。
- 数据库已备份并先在副本演练，再向正式数据库应用纯新增 `0036_unified_qr_login.sql`：两张临时认证表、四个索引；既有迁移账本不变，`integrity_check=ok`。候选使用同一 OA 数据库，用户在验收中确认的身份绑定可以保留；不要把验收环境当成可随意修改业务资料的沙盒。
- 自动检查已验证：正常入口仍走旧版本；验收入口及手机路由走候选；两个平台均能生成授权地址，回调域名正确；安全 Cookie、飞书 PKCE、跨域请求拒绝、未登录禁止绑定、缺少手机 Cookie 的回调拒绝、取消挑战均符合预期。真实手机 OAuth 尚未验收，不能据此宣称双登录正式上线。
- 新 OAuth 回调关闭 Nginx access log，防止授权 code/state 进入代理访问日志。企微后台的浏览器访问仍受站点安全策略限制；上述配置已通过独立的服务端 API 核验。

下一步由用户在电脑打开验收入口，用手机飞书扫码确认，然后在「右上角姓名 → 设置 → 账号绑定 → 绑定企业微信」核对本人身份并确认绑定，退出后用企微扫码重新登录。核对既有成员资料与权限保持一致。通过后再合并 PR、挂载企微环境文件并启用统一登录，切换正式服务；切换前重新核对生产版本。

运维接续（仅服务器本地，不把环境文件或备份上传仓库）：

- 候选目录：`/opt/omindos-deploy/releases/oa-unified-b64735aa453d`。
- 安全配置：`/etc/originmind-oa/wecom-login.env`、`/etc/originmind-oa/login-canary.env`，均为 root 0600。正式服务尚未挂载前者，前者保留统一登录关闭标记；候选配置已单独启用。
- 备份与核验状态：`/opt/omindos-deploy/checkpoints/unified-login-20261010/`，root 0700；包含迁移前 SQLite、Nginx 原配置及 `canary-state.json`。状态文件中的路由 Cookie 不提交仓库。
- 临时路由：`/etc/nginx/conf.d/00-oa-login-canary-map.conf` 和 `/etc/nginx/snippets/oa-login-canary-locations.conf`，仅 OA 的 HTTPS server 引用；正式配置修改前后 hash 保存在状态文件。
- 退出候选入口：`https://oa.omindos.cn/login-check-exit`。取消验收时，在确认配置未被并行修改后恢复本次 Nginx 改动，执行 `nginx -t` 再 reload，停止候选服务；保留新增认证表。**不要为回退界面而恢复旧数据库，否则会丢失备份后的真实业务和身份绑定。**

## 2026-10-10 早期准备记录（已由上节状态更新）

- 用户已完成企微自建应用。生产 OA 已核对为 `oa-library-5ee312888763`，对应 `maganrobotics-boop/aliyun-oa`；运行进程内尚无 `WECOM_LOGIN_*` 配置。
- `omindos.cn` 与 `oa.omindos.cn` 的 `WW_verify_TrIXNK3EoirCVbIT.txt` 均返回 200、text/plain、16 字节，内容 SHA-256 相同。网页验证文件可用不等于后台可信域名已经保存。
- 原 PR #115 已与 main `b386451` 对齐；企微机器人占用 0035，统一扫码迁移改为 **0036_unified_qr_login.sql**，保留机器人三表、索引和迁移账本。
- 阿里云候选基于 main `11272f6` 局部集成登录代码，保留七天会话、资料库生成/上传、周报、审批和现有工作台。旧 `oa-8a0bffc` 页面补丁已移除，不能套用到当前生产。
- 当前云浏览器的站点安全策略禁止访问企微管理后台，不能代替用户核验应用可见范围、可信域名和可信 API IP。未请求或回显真实 Secret。

管理员在阿里云服务器终端运行：

```sh
sudo python3 scripts/configure-wecom-login.py
```

按提示输入 CorpID、AgentID 和**同一自建应用** Secret。Secret 隐藏输入；脚本只新建 root 可读的 `/etc/originmind-oa/wecom-login.env`（0600），保留 `OA_UNIFIED_QR_LOGIN_ENABLED=false`，不改已有飞书配置、不重启、不启用服务，已有文件时拒绝覆盖。

早期发布计划（迁移已经按上节改为先备份、演练，再为受控验收添加临时表）：

1. 核对企微网页授权可信域名是 `oa.omindos.cn`，应用可见范围包含待登录成员，可信 API IP 对应 OA 服务器的实际出口 IP。飞书新回调保留 `https://oa.omindos.cn/api/auth/qr/callback/feishu`，旧回调也保留。
2. 在受保护服务器内验证应用凭据，不将 Secret、access_token、真实成员信息或上游原始错误写入日志/仓库。
3. 用飞书和企微手机客户端分别验证授权跳转后 `__Host-oa_qr_phone` 保留、验证码确认、首次绑定、退出后重新登录。自动化隔离测试不代替此步骤。
4. 再按阿里云流程备份 SQLite，应用 0036，验证两张临时认证表和四个索引以及既有迁移记录，挂载配置、切换已构建候选并验收。切换前重新比较生产版本，不能覆盖并行发布的新功能。
5. 回退时恢复上一代码包并关闭 `OA_UNIFIED_QR_LOGIN_ENABLED`；新增临时表可保留。原飞书本机登录入口保持可用。

**PR 未合并，正式入口尚未切换。凭据、迁移和受控验收入口已经完成；剩余为真实手机 OAuth 验收和通过后的正式切换。**

## 验证

```sh
npm run typecheck
node --test --test-concurrency=1 tests/unified-qr-login.test.mjs tests/wecom-oauth.test.mjs tests/qr-svg.test.mjs
npm test
```

上面的命令用于当前 GitHub PR 源码的完整检查。阿里云生产源码副本保留独立的 `build:aliyun` 命令，应用核对过的生产页面补丁后另行执行 `npm run build:aliyun`。旧 Cloudflare 发布工作流和 npm 发布入口已退役；本次只更新保留代码的迁移校验，不恢复该发布入口，不以其替代阿里云发布。

安全用例涵盖电脑和手机 nonce、OAuth state、平台与企业限制、重复消费、并发扫码、事务回滚、成员停用与绑定冲突。二维码由仓库内固定版本的 MIT 编码器生成，不发送到第三方二维码服务。

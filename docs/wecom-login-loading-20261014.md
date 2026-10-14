# 企业微信 OA 页面加载恢复，2026-10-14

状态：修复已准备、服务器候选配置语法验证通过；尚未激活生产配置。

## 证据与范围

- 用户截图在企微内停留于“正在加载登录方式…”和右上“加载中”。
- 08:01:46–08:02:59（北京时间）同类企微访问记录显示 HTML、CSS、JS 返回 200；主页面 JS 后续有 206 断点续传请求；该窗口未见该企微客户端的 `/api/session` 请求。
- 匿名 `/api/session` 实测 200，约 0.051 秒，企业微信登录已启用。所有首页脚本均可成功下载。
- 主页面脚本即使请求 `Accept-Encoding: gzip`，仍返回未压缩的 561060 字节。现有 HTML 注入配置清除了上游 Accept-Encoding，而 Nginx 没有启用 JS/CSS gzip。
- 云浏览器的既有管理员会话能正常进入工作台，不能据此判定用户手机企微已修复。
- 证据定位于前端初始化未完成；尚无手机控制台错误，不能证明脚本下载中断就是唯一根因。

## 改动

1. `deploy/aliyun/oa-login-recovery.conf` 仅用于 OA HTTPS server：为公开、带内容哈希的 `/_next/static/` 资源启用 gzip 和代理缓冲；保留原身份头过滤和 HTTPS 来源头。
2. `public/oa-login-recovery.js` 独立于 React/Next 主包；12 秒后仍为禁用的登录按钮时显示恢复提示。企微提供既有 OAuth 登录入口，所有浏览器提供带新查询参数的重新加载链接。页面恢复后移除提示。
3. 不改用户绑定、OAuth 验证、会话权限、数据库或业务 API；恢复脚本不读取 Cookie、不发请求、不自动登录。

重新加载链接会刷新文档，不声称清除了浏览器全部缓存。现有 OAuth 入口继续由服务端核验身份与绑定。

## 验证

- `node --check public/oa-login-recovery.js` 通过。
- `node --test tests/oa-login-recovery.test.mjs`：6 项通过，覆盖主包未执行的恢复入口、12 秒延迟、正常与迟到的加载成功、普通浏览器、OAuth 回调不介入、DOM 未就绪。
- 候选完整 Nginx 配置 `nginx -t` 通过。
- 未实施：生产 gzip 字节数验收、真实企微回调和最终登录验收、手机恢复面板视觉验收。

## 暂存与回滚

服务器：阿里云。候选文件位于 `/opt/omindos-deploy/oa-login-recovery-20261014/`。

- `oa-login-recovery.js`、`oa-login-recovery.conf`：本次静态脚本与配置片段。
- `originmind-services.before.conf`：生产配置原样备份。
- `originmind-services.candidate.conf`：只在 OA HTTPS 服务中引入片段，并在已有 HTML head 注入中增加独立脚本。
- `nginx-test.conf`：已验证的完整候选 Nginx 入口配置。
- `manifest.json`：生产配置、候选配置和脚本 SHA-256。

原生产配置 SHA-256：`1055ffd46083b89c14703670cc10ff30edd0a40565fa7d8ea5198388386da916`。
候选配置 SHA-256：`e5446af5cc6dbbf9eb9aef25a3495716b3ad373d67784bcc382c99b0234b0bd6`。

自动审批拒绝了替换生产配置并重载 Nginx，理由是需要用户明确授权本次生产激活。拒绝后已只读核对原配置哈希未变、首页未引入恢复脚本。不得将本记录当作上线授权。

获授权后：先重新核对生产配置与 manifest；有变化时重做候选合并与预检。按候选原子切换，执行 `nginx -t` 后只 reload Nginx，不重启 OA。随后核对首页脚本注入、JS/CSS 压缩解压后哈希一致、API 状态及浏览器工作台。失败时恢复 before.conf，验证并 reload。真实手机企微成功登录仍须单独验收。

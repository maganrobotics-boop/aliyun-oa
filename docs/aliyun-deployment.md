# 阿里云独立副本

此部署目标与 Cloudflare 生产环境相互独立。Cloudflare 继续使用 Workers、D1 和 R2；阿里云副本使用标准 Next.js Node 服务器、本机 SQLite，并可选使用私有 OSS Bucket 保存知识库图片等较大对象。

## 运行时

- Node.js `>=22.13.0`
- Nginx 反向代理到 `127.0.0.1:3000`
- systemd 服务 `originmind-oa.service`
- SQLite 文件 `/var/lib/originmind-oa/oa.sqlite`
- OSS（推荐）或本机 `/var/lib/originmind-oa/assets`

`npm run build:aliyun` 使用标准 Next.js standalone 输出，并只在这个构建目标中把 `cloudflare:workers` 替换为阿里云兼容层。原有 Cloudflare 构建命令保持不变。

## OSS

在 `/etc/originmind-oa/env` 中配置：

```dotenv
OA_OSS_BUCKET=example-private-bucket
OA_OSS_REGION=oss-cn-shenzhen
OA_OSS_ENDPOINT=oss-cn-shenzhen-internal.aliyuncs.com
OSS_ACCESS_KEY_ID=由服务器保存的最小权限 RAM 凭据
OSS_ACCESS_KEY_SECRET=由服务器保存的最小权限 RAM 凭据
```

Bucket 应保持私有。应用通过服务器读取对象，不向浏览器暴露 OSS 凭据或永久公开 URL。RAM 权限只需限定到该 Bucket 前缀的读写；不要使用阿里云主账号 AccessKey。

## 发布

把源码发布包上传到服务器，然后执行：

```bash
sudo bash deploy/aliyun/deploy.sh /tmp/originmind-oa-aliyun.tar.gz omindos.cn
```

首次运行会创建 `/etc/originmind-oa/env`。将示例身份、OAuth 和 OSS 配置替换为实际值后，再次执行同一发布命令。部署脚本会执行锁定依赖安装、全部 SQLite 迁移、生产构建、systemd 切换、Nginx 校验和本机健康检查；失败时保留旧版本并尝试回退。

域名完成解析且备案允许对外访问后，再签发证书：

```bash
sudo bash /opt/originmind-oa/current/deploy/aliyun/enable-https.sh omindos.cn
```

飞书和 GitHub 登录必须分别登记 `https://omindos.cn/api/auth/feishu/callback` 与 `https://omindos.cn/api/auth/github/callback`，确认回调后才能把相应开关改为 `true`。阿里云副本不支持 Sites 的 ChatGPT 身份头，因此 `CHATGPT_LOGIN_ENABLED` 必须保持 `false`。

## 数据复制边界

本脚本创建的是空的独立 SQLite 数据库。业务数据需要通过仓库已有的受控加密导出流程获取，再经过单独的校验导入步骤写入阿里云副本；不要直接复制在线 D1 文件、会话、OAuth 临时事务、限流桶或迁移冻结标记。

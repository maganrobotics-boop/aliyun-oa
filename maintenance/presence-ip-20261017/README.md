# IP 访问统计维护补丁

同一 IP 在所选 24 小时、3 天或 7 天窗口内计为一次访问。时长按已采集可见页面心跳的覆盖区间合并后计算，同一 IP 的多账号或多标签页重叠时间不重复累加；它是已采集在线时间的估计，不代表持续的人为操作。未有心跳的已知 IP 显示“未采集”，不能用首末请求跨度补算。超过 90 秒的心跳断档不计入连续区间。

IP 历史采集采用独立起始时间。此前仅保留已经确认的最新 IP 与历史心跳证据，不能据此声明整个旧窗口记录完整。账号视图和原有管理员权限范围保持原有契约。

本补丁针对已经具有相应前置模块的应用源码树；不是缺少这些模块的旧源码树的完整同步包。`base-hashes.json` 的 `base` 列出修改前 SHA-256，`null` 表示新增文件，`result` 列出应用后的 SHA-256。逐项核对基线哈希和新增路径不存在后，从应用源码树根目录运行：

```sh
git apply --check -p1 maintenance/presence-ip-20261017/changes.patch
git apply -p1 maintenance/presence-ip-20261017/changes.patch
```

界面和管理接口使用配套后端的 `groupBy: "ip"` 契约。配套后端应用对应维护补丁后，可在其源码树使用 Node.js 24 验证统计与签名桥接契约：

```sh
node --test tests/platform-presence-ip.test.mjs tests/platform-presence-ip-bridge.test.mjs
```

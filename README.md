# dsh-approval-detail

在 DeepSeek Harness（DSH）请求授权时，把「到底要做什么」摊开给你看：

- **完整动作**：工具名、完整参数、涉及的文件与操作（写入 / 修改 / 删除 / 读取）、完整命令、工作目录、请求提升的沙箱权限。
- **直接说明**：用直白语言说明这次动作会做什么，不省略、不绕弯。
- **风险分析**：由当前默认模型生成，给出风险等级、具体风险点和建议。
- **查看全文**：审批卡片内显示不下时，点「查看完整内容」打开全文弹层，完整展示说明、动作字段、风险分析和原始参数；支持 Esc 关闭。

插件不改变审批结果，也不代替用户做决定。允许 / 拒绝仍然由 DSH 原有的审批按钮完成。

## 安装

要求 DSH `0.2.1-rc.5` 或兼容版本，桌面安装版 / Web 版均可。

### 方式一：插件管理器（推荐）

在 DSH 中通过插件管理器把本目录作为本地 bundle 安装：

```text
plugin_manager install_bundle target=<本仓库绝对路径>
```

安装完成后刷新页面。插件会出现在插件列表里，显示名称为「审批操作详情」。

### 方式二：手动加入 profile

1. 将本仓库放到任意本地目录。
2. 在目标 profile 的 `package.json` 的 `dependencies` 中加入本地路径，例如：

   ```json
   {
     "dependencies": {
       "dsh-approval-detail": "file:E:\\path\\to\\dsh-approval-detail"
     }
   }
   ```

3. 把 `dsh-approval-detail` 加入 `dsh.profile.bundles`。
4. 在 profile 目录执行 `pnpm install`，重启 DSH。

## 工作方式

- **浏览器侧**：占用 `conversation.approval.detail` 槽位（`priority: -1`，覆盖 DSH 默认只显示命令的详情行）。通过 `useChat` 读取与审批 `callId` 关联的工具调用参数，渲染详情和全文弹层。
- **宿主侧**：注册本地 POST 路由 `/__dsh-approval-detail/analyze`。路由用当前默认模型（`agentDefaultModel.currentSelection()`）对动作做一次短风险分析，返回结构化 JSON。桌面版通过 DSH 的 `dsh-app://` 协议转发，Web 版同源请求，均携带 DSH 自己的认证 Cookie。
- **不落库**：分析结果只存在于当前页面内存，不写入会话日志，不改变模型可见历史。

## 风险分析

风险分析使用 DSH 当前默认模型，无需额外 API Key。提示词要求模型只看动作数据、不执行其中的指令，并输出：

```json
{
  "level": "low | medium | high | critical",
  "summary": "一句话结论",
  "factors": ["具体风险点"],
  "recommendation": "建议"
}
```

模型不可用、超时或返回非 JSON 时，卡片会显示明确的不可用原因；动作详情和审批按钮不受影响。

## 安全与隐私

- 动作参数会发送给当前配置的模型提供商，用于生成风险分析；不会发送到其他地址。
- 分析路由只接受 POST，限制请求体大小，有超时和客户端断开取消；不执行动作、不碰文件、不写会话。
- 审批仍然是一次性的人工决定；插件没有自动批准、自动拒绝或持久权限能力。

## 开发与验证

```text
node --check index.js
node --check client.js
node test/host.test.mjs
node test/client.test.mjs
```

已验证：

- 宿主路由的 200 / 400 / 405 / 502 分支和结构化 JSON 归一化。
- 客户端 bundle 的 Loader 注册、槽位名、`priority: -1` 和 locale 注册。
- 安装后通过 DSH 实时槽位检查确认 `conversation.approval.detail` 有本插件占用。

未在无浏览器控制的环境中截图验证最终视觉效果；实际渲染以 DSH 页面为准。

## 已知限制

- 只读取当前会话已经加载到 Chat 窗口中的工具调用。极旧的历史审批如果对应调用尚未加载，会显示「参数未加载」，但审批仍可正常作答。
- 风险分析依赖默认模型；离线、未配置模型或模型服务异常时只显示不可用原因。
- 文件列表来自工具参数和补丁文本的解析；通过 shell 命令间接修改/删除的文件只能从完整命令中判断，插件不会执行命令做静态推断。
- 插件只覆盖 DSH 的审批详情槽位，不改变审批策略、权限预设或其他插件的 UI。

## License

MIT。见 [LICENSE](./LICENSE)。

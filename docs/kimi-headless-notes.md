# kimi headless 实证笔记（Phase 1 结论）

> 日期：2026-07-16。环境：kimi 0.26.0，本机 OAuth 登录（managed:kimi-code，模型 kimi-code/k3）。
> 这些结论是 Phase 3 CLI 集成层映射的依据。每条都实际跑过，不是从文档推断。

## 1. `stream-json` 输出 schema（`kimi -p "<prompt>" --output-format stream-json`）

stdout 逐行一个 JSON 对象，共 4 种消息：

```jsonl
{"role":"assistant","content":"I'll run both actions now.","tool_calls":[{"type":"function","id":"tool_Cz0ZyuMS2fbYNKSuuRUMXLzo","function":{"name":"Bash","arguments":"{\"command\":\"touch denied.txt\"}"}}]}
{"role":"tool","tool_call_id":"tool_Cz0ZyuMS2fbYNKSuuRUMXLzo","content":"Tool \"Bash\" was denied by permission rule. Reason: test deny touch"}
{"role":"assistant","content":"final answer text ..."}
{"role":"meta","type":"session.resume_hint","session_id":"session_eef13dc5-...","command":"kimi -r session_eef13dc5-...","content":"To resume this session: kimi -r ..."}
```

要点：

- **assistant 消息**：纯文本时只有 `content`；发起工具调用时有 `tool_calls`（可同时多个，arguments 是 JSON 字符串），`content` 可有可无
- **tool 消息**：`tool_call_id` 对应调用 id，`content` 是工具输出文本
- **meta 消息**：最后一行，`type: "session.resume_hint"`，带 `session_id` → action 的 `session_id` output 从这里取
- **最终结果** = meta 之前最后一条带 `content` 的 assistant 消息
- thinking 不进 JSONL；tool 进度提示走 stderr
- 成功 exit 0（含工具被 deny 的情况——deny 不算失败，agent 会绕开继续汇报）

## 2. `-p` 模式权限行为

- `auto` 权限下 **Write / Bash 都直接放行**，无审批（实测：文件创建、命令执行均生效）
- **deny 规则仍然生效**：被拒的工具调用返回 tool 消息 `Tool "<name>" was denied by permission rule. Reason: <reason>`，agent 会继续并如实汇报，不绕行
- allow 规则无需配置（auto 已放行常规调用）；action 只需写 **deny** 规则

## 3. permission pattern 语法（实测）

- `Bash(touch*)` — 命令前缀匹配，有效
- `Write(.github/workflows/**)` — 有效（deny 成功）
- `Write(.github/workflows*)` — **无效**（没拦住）：单 `*` 不跨 `/`，路径 pattern 必须用 `**`
- 规则 first-match-wins，deny 置前

action 默认生成的 deny 规则建议：

```toml
[[permission.rules]]
decision = "deny"
pattern = "Write(.github/workflows/**)"

[[permission.rules]]
decision = "deny"
pattern = "Edit(.github/workflows/**)"

[[permission.rules]]
decision = "deny"
pattern = "Bash(git push --force*)"

[[permission.rules]]
decision = "deny"
pattern = "Bash(git push*-f*)"
```

## 4. 认证注入

- **CI 场景**：`KIMI_MODEL_NAME` + `KIMI_MODEL_API_KEY`（+可选 `KIMI_MODEL_BASE_URL`）env 合成内存 provider——官方文档明确，本计划 Phase 9 用真实 key 验证
- **本机 OAuth 场景**：`KIMI_CODE_HOME` 需要同时含 `config.toml` + `credentials/` + `oauth/`（+`device_id`）才能复用登录态（实证测试 3/4 即此法）
- `KIMI_CODE_HOME` 整体重定向有效，action 在 `$RUNNER_TEMP` 生成隔离 home 可行

## 5. 对 run-kimi.ts 的设计约束

- spawn 参数：`kimi -p <prompt> --output-format stream-json`（prompt 走 argv，注意 ARG_MAX ~2MB，prompt 文件大时直接 `$(cat file)` 读入字符串即可）
- `-p` 与 `--yolo/--auto/--plan` 互斥，不要传
- stdout 逐行 JSON.parse，脏行（非 JSON）跳过并记 stderr 日志
- 结果判定：进程 exit code + 最后一条 assistant content；session_id 从 meta 行提取
- execution file = 完整 JSONL 原样落盘
- stderr 单独捕获，用于进度/诊断

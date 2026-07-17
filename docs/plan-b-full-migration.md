# Plan B：kimi-code-action —— Fork 完整移植 claude-code-action（已批准，执行中）

> 状态：2026-07-16 用户批准，作为实施主计划。

## 目标

Fork claude-code-action 全部代码，逐层替换为 kimi-code CLI 驱动，产出一个功能面接近 claude-code-action 的 `kimi-code-action`：@kimi 交互、PR 自动 review、inline 评论、自定义自动化，并继承其安全加固与高级功能。

- 位置：`~/Codebase/personal/kimi-code-action`（本地新仓库，不建远程）
- 上游：`~/Codebase/opensource/claude-code-action`（Apache-2.0；保留 LICENSE + NOTICE 注明改编出处）

## 与 Plan A（轻量自研）的产出差别

| 维度                     | Plan A 轻量自研                                                         | Plan B 完整移植（本计划）                                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent 实际能力           | 相同：同一个 kimi CLI + 同一批 GitHub MCP 工具                          | 相同                                                                                                                                                                                                                                                    |
| v1 功能面                | 核心链路：tag/agent 双模式、跟踪评论、inline 评论、基础安全             | 多出：commit 签名（GitHub API / SSH key）、sticky comment、branch_name_template、track_progress、include/exclude_comments_by_actor、评论图片下载供 agent 查看、CI 状态 MCP server、file-ops MCP server、agent-approval-check 子 action、session_id 续接 |
| 安全加固                 | 基础：写权限校验、sanitizer、git-push wrapper、deny `.github/workflows` | 全部继承：另有 TOCTOU 过滤（评论只取 trigger 时刻之前）、restore-config（从 base 分支恢复 `.kimi-code/` 等 config，防 PR 注入）、输出脱敏、OIDC env 清理                                                                                                |
| 明确不支持（两方案相同） | —                                                                       | `allowed_non_write_users`（kimi 无 subprocess env scrub）、structured output / `--json-schema`（kimi 无对应）、OIDC 换 App token（Anthropic 私有服务）                                                                                                  |
| 代码量 / 所有权          | ~2-3k 行全新，完全自有，无残留                                          | 继承 ~15k 行，改编约 30%；有删减不彻底的死代码风险                                                                                                                                                                                                      |
| 交付节奏                 | 链路短、跑通快，但高级功能都是后续追加                                  | 前期理解+删减+替换慢，跑通即功能全                                                                                                                                                                                                                      |
| 维护                     | 无上游纠缠，自由演化                                                    | 可 diff 上游吸收安全修复，但要持续对抗 Anthropic 耦合                                                                                                                                                                                                   |
| 用户接口                 | 全新精简 inputs                                                         | inputs 接近 claude-code-action，老用户迁移友好                                                                                                                                                                                                          |
| 主要风险                 | 重造已知边界情况（事件解析、TOCTOU 等）                                 | 半替换状态、残留 Anthropic 路径、理解成本高                                                                                                                                                                                                             |

一句话：两个方案里 agent 的"智力"完全一样，差别全部在 GitHub 侧脚手架的功能广度与安全成熟度。Plan B 用更高的前期成本换来起点即完整。

## 调研结论（已核实）

- claude-code-action：composite action + bun 直跑 TS 源码（无构建）；模式自动检测（`prompt` 非空 → agent；评论含 trigger → tag）；GitHub 能力 = 4 个本地 stdio MCP server（各 ~100 行，env 注入 token/repo）；不预取 diff，只给 changed-files 列表
- kimi CLI 0.26.0：`kimi -p` headless（auto 权限 + 静态 deny 生效）；`--output-format stream-json` JSONL；`KIMI_MODEL_NAME`/`KIMI_MODEL_API_KEY`/`KIMI_MODEL_BASE_URL` env 直接合成 provider；MCP 走 `$KIMI_CODE_HOME/mcp.json`；权限走 config.toml `[[permission.rules]]`（first-match-wins，支持 `Bash(git push:*)`、`mcp__github__*`）；`KIMI_CODE_HOME` 可整体重定向；npm 安装可 pin 版本；`loop_control.max_steps_per_turn` 限轮次
- 关键差异：kimi 无 `--mcp-config` / `--allowedTools` / `--append-system-prompt` / `--json-schema` flag，无 acceptEdits 模式 → 全部经生成的 KIMI_CODE_HOME 配置注入或裁剪

## 实施步骤

### Phase 0 — 导入与存档

1. 新建 `~/Codebase/personal/kimi-code-action`，`git init`；把 Plan A 存档为 `docs/plan-a-lightweight.md`，本计划存为 `docs/plan-b-full-migration.md`
2. 复制 claude-code-action 工作树（排除 .git、node_modules）入库，initial import commit；README 记录上游 SHA；保留 LICENSE，新增 NOTICE 说明改编

### Phase 1 — 实证 kimi headless 行为（先行，决定后续映射正确性）

3. 纯净 `KIMI_CODE_HOME` + `KIMI_MODEL_*` env 下跑 `kimi -p "..." --output-format stream-json`：确认消息 schema（assistant/tool 结构、session id 位置、最终结果标志、exit code 语义）
4. 验证 `-p` 模式下 auto 权限对 Write/Edit/Bash 的实际放行行为；验证 `[[permission.rules]]` first-match-wins（deny 规则置前，如 `Bash(git push --force*)`、`.github/workflows` 路径写入）

### Phase 2 — 删除 Anthropic 专有路径

5. `src/github/token.ts`：移除 OIDC→Anthropic token 交换，只留 `github.token` / `OVERRIDE_GITHUB_TOKEN`；删 action.yml 的 Revoke app token 步骤、`additional_permissions` input
6. 删除 workload-identity、Bedrock/Vertex/Foundry/WIF 全部 inputs/env/validate-env 分支（action.yml env 块瘦身过半）
7. 删除 plugins / plugin_marketplaces / install-plugins.ts / slash-commands / fix-links / `allowed_non_write_users`（含 bubblewrap 安装步骤）/ `structured_output` output
8. 删除 `sync-base-action.yml`（不维护独立 base-action 仓库；base-action/ 目录保留为内部代码层，主 action 仍直接 import 其 src）

### Phase 3 — CLI 集成层替换（核心）

9. `base-action/src/run-claude-sdk.ts` → `run-kimi.ts`：spawn `kimi -p <prompt> --output-format stream-json ...`，逐行解析 JSONL；execution file 落盘、输出脱敏、result 判定、`session_id` output
10. `base-action/src/parse-sdk-options.ts` → `parse-kimi-options.ts`：`claude_args` 改名为 `kimi_args` 并保留 shell-quote 解析；映射规则：
    - `--allowedTools/--disallowedTools` → 生成 `[[permission.rules]]`（deny 置前）
    - `--mcp-config` 合并逻辑保留 → 写 `$KIMI_CODE_HOME/mcp.json`
    - `--permission-mode acceptEdits` → `auto` + allow 规则近似；`plan`/`bypassPermissions` → 报错不支持
    - `--max-turns` → `loop_control.max_steps_per_turn`
    - `--append-system-prompt` → 拼入 prompt 文件头部
11. 新增 `src/kimi/config.ts`：`$RUNNER_TEMP/kimi-home` 生成器（config.toml + mcp.json），所有映射汇聚于此；`settings` input 改为接受 kimi config.toml 片段合并
12. `installClaudeCode()` → install kimi：action.yml 加 `actions/setup-node`（node 24）+ `npm i -g @moonshot-ai/kimi-code@${kimi_version}`；保留 `path_to_kimi_executable` 旁路
13. env 清理：保留 `ACTIONS_ID_TOKEN_REQUEST_*` 删除逻辑；`CLAUDE_CODE_ENTRYPOINT` → 设 `KIMI_DISABLE_TELEMETRY=1` 等

### Phase 4 — GitHub 层（大部分保留）

14. permissions.ts / trigger.ts / actor.ts / fetcher.ts / sanitizer.ts / restore-config.ts / branch.ts / git-push.sh 全部保留（CLI 无关）；restore-config 的恢复路径清单从 `.claude/`、`CLAUDE.md` 改为 `.kimi-code/`、`AGENTS.md` 等
15. 评论 operations 保留；`update-claude-comment.ts` 改名 kimi

### Phase 5 — MCP servers（薄改）

16. 4 个 server 保留；工具改名 `update_claude_comment` → `update_kimi_comment`，env `CLAUDE_COMMENT_ID` → `KIMI_COMMENT_ID`
17. `install-mcp-server.ts` 装配输出从 CLI `--mcp-config` flag 改为合并写 mcp.json；CI server 的 actions 权限探测逻辑保留
18. `post-buffered-inline-comments.ts` 的 Haiku 分类调用 → 改为 kimi API（moonshot chat completions HTTP 直连，用 `kimi_api_key`）；`classify_inline_comments` 默认 true 不变

### Phase 6 — prompt 与品牌化

19. constants.ts：`bot_id`/`bot_name` 默认改 `github-actions[bot]`（保留 inputs 可覆盖）；trigger 默认 `@kimi`；branch_prefix 默认 `kimi/`
20. `create-prompt/index.ts` 全文 kimi 化：身份、"You are Claude"、工具名、claude.ai 链接；`USE_SIMPLE_PROMPT` 保留
21. update-comment-link / format-turns / step summary 品牌文案

### Phase 7 — examples / tests / docs

22. examples：`claude.yml` → `kimi.yml`、`pr-review-comprehensive.yml` 等全部 kimi 化；删 `claude-wif.yml`；`agent-approval-check/` 保留（独立 python action，CLI 无关）
23. test/：mockContext 工厂保留；token / WIF / SDK 相关测试删除或重写；给 run-kimi 新增 stream-json fixture 单测
24. README + docs/ 重写（用法、inputs 参考、安全模型、与上游差异）；examples 里的 secret 名统一 `KIMI_API_KEY`

### Phase 8 — CI / release

25. ci.yml（bun test + tsc + prettier）保留；release.yml 保留调整；test-\*.yml e2e 适配 kimi（需测试仓库配 `KIMI_API_KEY` secret 后启用）

### Phase 9 — 端到端验证（需用户配合）

26. 用户提供 `KIMI_API_KEY` 和测试仓库；跑三类场景：@kimi 评论触发、PR 自动 review（track_progress + inline 评论）、workflow_dispatch 自定义自动化

## 验证

- 每 Phase 结束 `bun test` + `tsc --noEmit` 全绿
- Phase 1 实证结论写成 `docs/kimi-headless-notes.md`，作为 Phase 3 映射依据
- Phase 9 三类场景真实跑通：@kimi 回评论、review 发评论 + inline 评论、自定义自动化产出结果

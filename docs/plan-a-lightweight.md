# Plan A：kimi-code-action 轻量自研方案（存档）

> 状态：已评估，未采用（第一轮计划，用户选择 Plan B 完整移植）。存档用于对比。
> 调研日期：2026-07-16。参考源码：`~/Codebase/opensource/claude-code-action`（Apache-2.0）。

## 目标

参照 claude-code-action 的架构设计，从零写一个 GitHub Action，用 kimi-code CLI 以 agentic 方式在 GitHub 里做 code review 和自动化。

- 位置：`~/Codebase/personal/kimi-code-action`（本地新仓库）
- 范围：@kimi 交互模式、PR 自动 review、inline 行内评论、自定义自动化

## 调研结论

**claude-code-action 架构**：
- composite action + bun 直跑 TypeScript 源码，无构建产物
- 模式自动检测：`prompt` 非空 → agent 模式；评论/issue 含 trigger → tag 模式
- GitHub 操作能力 = 本地 stdio MCP server（comment / inline-comment / file-ops / ci），server 极薄（~100 行），token/repo 经 env 注入
- 不预取 diff 进 prompt，只给 changed-files 列表，教 agent 自己 `git diff`
- token 走 OIDC→Anthropic 后端换 App token（私有服务，无法复用）

**kimi-code CLI 能力**（0.26.0 + 官方文档核实）：
- headless：`kimi -p "<prompt>"`，默认 auto 权限、静态 deny 规则仍生效；`--output-format stream-json` 输出 JSONL
- 认证：`KIMI_MODEL_NAME` + `KIMI_MODEL_API_KEY`（+可选 `KIMI_MODEL_BASE_URL`）环境变量合成临时 provider，不写配置文件
- MCP：`$KIMI_CODE_HOME/mcp.json`，工具名 `mcp__<server>__<tool>`；无 `--mcp-config` CLI flag
- 权限：config.toml `[[permission.rules]]` 支持 `allow/deny/ask`，pattern 支持 `Bash(git push:*)`、`mcp__github__*`
- `KIMI_CODE_HOME` 可重定向数据目录 → 在 `$RUNNER_TEMP` 生成隔离配置注入
- 安装：`npm i -g @moonshot-ai/kimi-code@<version>` 或官方 install.sh
- `loop_control.max_steps_per_turn` 限制轮次

## 架构设计

```
kimi-code-action/
├── action.yml                    # 主 composite action
├── package.json / bunfig.toml / tsconfig.json
├── src/
│   ├── entrypoints/
│   │   ├── run.ts                # 编排器：prepare → install kimi → run → 更新跟踪评论
│   │   └── post-inline-comments.ts
│   ├── github/
│   │   ├── context.ts            # 解析 event + inputs
│   │   ├── token.ts              # github.token 或自带 token
│   │   ├── permissions.ts        # collaborator 写权限校验、bot 防护
│   │   ├── data/fetcher.ts       # GraphQL 抓 title/body/comments/reviews/changed-files
│   │   ├── operations/           # 评论、分支
│   │   └── utils/sanitizer.ts    # 内容消毒
│   ├── modes/
│   │   ├── detector.ts           # agent / tag 自动检测
│   │   ├── tag/index.ts          # @kimi：跟踪评论 + 大 prompt + 分支管理
│   │   └── agent/index.ts        # 自动化：用户 prompt 直接跑
│   ├── create-prompt/index.ts
│   ├── kimi/
│   │   ├── install.ts            # npm 安装/定位 CLI
│   │   ├── config.ts             # 生成 KIMI_CODE_HOME（config.toml + mcp.json）
│   │   ├── run.ts                # spawn + stream-json 解析
│   │   └── parse-args.ts         # kimi_args 解析（shell-quote）
│   └── mcp/
│       ├── comment-server.ts     # update_kimi_comment
│       └── inline-comment-server.ts  # create_inline_comment 缓冲 jsonl
├── scripts/git-push.sh           # 受限 push wrapper
├── test/                         # bun test
├── examples/
└── docs/ + README.md
```

## action.yml inputs（v1）

- `kimi_api_key`（必填）、`kimi_model`（默认 `kimi-for-coding`）、`kimi_base_url`
- `prompt`、`trigger_phrase`（默认 `@kimi`）、`assignee_trigger`、`label_trigger`
- `github_token`、`kimi_args`、`kimi_version`、`path_to_kimi_executable`、`max_steps`
- `use_sticky_comment`、`track_progress`、`inline_comments`、`branch_prefix`（默认 `kimi/`）
- outputs：`session_id`、`branch_name`、`execution_file`

## 关键实现决策

1. CLI 调用：`spawn("kimi", ["-p", prompt, "--output-format", "stream-json", ...])`，逐行解析 JSONL；先实证 stream-json schema
2. 配置注入：`$RUNNER_TEMP/kimi-home` 生成 config.toml（deny `.github/workflows`、危险 Bash；`max_steps_per_turn`）+ mcp.json；`KIMI_CODE_HOME` 指向它
3. 认证：`KIMI_MODEL_*` env；GitHub 用 `github.token`
4. tag 模式：跟踪评论 → GraphQL 上下文（不含 diff）→ 分支 → prompt（只有 trigger comment 是指令）→ 跑 → 更新评论
5. inline 评论：MCP server 缓冲 jsonl，post 步骤逐条发布，不做 LLM 二次分类
6. 安全（v1）：写权限校验、sanitizer、git-push wrapper、deny workflows 路径；不做 allowed_non_write_users / commit signing / OIDC / TOCTOU
7. review prompt 参照 `examples/pr-review-comprehensive.yml` 改写

## 实施步骤

1. 脚手架（package.json / tsconfig / bunfig / git init）
2. 实证：本地 `kimi -p ... --output-format stream-json` 确认 schema、session id、exit code；纯净 KIMI_CODE_HOME + `KIMI_MODEL_*` 跑通
3. github 层：context / token / permissions / fetcher / sanitizer / operations
4. kimi 层：install / config / parse-args / run
5. modes：detector + agent → tag
6. prompt 模板（tag 默认 + review）
7. MCP servers + post 步骤 + action.yml 装配
8. 单测（context / detector / prompt / config / stream-json fixture）
9. examples（kimi.yml / pr-review.yml / issue-triage.yml / ci-failure.yml / manual-automation.yml）
10. 端到端验证（需用户提供 KIMI_API_KEY + 测试仓库）
11. README + docs

## 验证

- `bun test`、`tsc --noEmit` 全绿
- 本地 stream-json 实证通过
- 端到端：@kimi 回评论、PR review 发评论 + inline 评论

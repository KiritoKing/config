# Config

复用原 dotfiles 仓库，集中管理个人配置与可移植研发资产。现阶段落地的是**全局个人规则**，不是整份 harness 配置镜像。

## Rules 单一来源

- `rules/sections/*.md`：唯一人工维护的规则正文。
- `rules/config.yaml`：profiles、稳定顺序、tokenizer 与预算。
- `rules/generated/AGENTS.md`：可复现的 default 通用快照；不手改托管内容。
- `rules/generated/codex/AGENTS.md`：通用规则加 `codex-subagents` 的 Codex 专用快照。
- `rules/generated/agy/AGENTS.md`：通用规则加 `agy-delegation`、`agy-paseo` 的 AGY 专用快照。
- `scripts/rules.mjs`：小型、确定性的生成/检查入口。没有模型调用、后台同步、自动软链接安装或账号配置操作。

通用 default 只选 `assets`、`cost`、`execution`、`security`；codex profile 额外选 `codex-subagents`；agy profile 额外选 `agy-delegation`、`agy-paseo`。AGY 沿用宿主已有 Paseo profiles 与 notes，不在规则中另设模型或 effort 默认值。`paseo-workflow` 仍仅保存，不选入任何已启用快照，也不注入 Paseo。项目、技术栈和业务专属内容不进入通用快照。

## 本机使用

需要 Node.js 22+ 与仓库指定的 pnpm。依赖仅安装在本仓库，不需要全局安装本工具。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm rules:generate
pnpm rules:check
```

通用入口可用于已有 Markdown 文件：

```sh
node scripts/rules.mjs generate --source /path/to/config --profile default -o /path/to/AGENTS.md
node scripts/rules.mjs check --source /path/to/config -o /path/to/AGENTS.md
node scripts/rules.mjs check --source /path/to/config -o /path/to/AGENTS.md --fix
```

这些路径是显式输入，不编码在资产正文中。默认 `--source` 为当前目录，默认输出 `./AGENTS.md`；source 可指向仓库根目录或 `rules` 目录。尚未集成到 `aiw rules`，也不替代 harness 原生配置工具。

Codex 专用快照单独生成与检查，不会修改通用快照：

```sh
node scripts/rules.mjs generate --source . --profile codex -o rules/generated/codex/AGENTS.md
node scripts/rules.mjs check --source . --profile codex -o rules/generated/codex/AGENTS.md
```

AGY 专用快照同样独立生成与检查：

```sh
node scripts/rules.mjs generate --source . --profile agy -o rules/generated/agy/AGENTS.md
node scripts/rules.mjs check --source . --profile agy -o rules/generated/agy/AGENTS.md
```

## Profile 与顺序

```yaml
version: 1
defaults:
  profile: default
  placement: tail
  max_tokens: 2000
  tokenizer: o200k_base
profiles:
  default:
    sections: [assets, cost, execution, security]
  codex:
    sections: [assets, cost, execution, security, codex-subagents]
  agy:
    sections: [assets, cost, execution, security, agy-delegation, agy-paseo]
  focused:
    sections: [security, execution]
```

当前 default 使用显式白名单，避免新增工具专用或仅保存的 section 自动进入通用入口。显式数组按数组顺序。缺省 `sections` 或单独的 `*` 按模块文件名的字典序。`--sections security,execution` 只筛选当前 profile 的候选，不重排 config，也不能选择 profile 之外的模块。未知 profile、未知或重复模块、空列表与不支持的字段均报错。

模块名必须匹配 `[a-z][a-z0-9-]*`。`title` 是稳定文件名，不含 `.md`；中文标题写在正文中。

## 托管边界

生成格式严格为：

```text
<managed-section-start:security>
## 全局安全硬边界
正文……
</managed-section-end:security>
```

这是一对自定义文本标记，不按 XML 解析。所有这种标记包围的内容归本工具管理：切换 profile 会移除不再选中的托管块；文件中的未标记内容不归本工具管理。

- 新块默认追加到 `tail`；`--placement head` 在开头插入。
- 已有托管槽原位更新，按当前 config 顺序重建其内容，保留块外前缀、后缀和夹在块间的自定义文本。位置参数只决定新增槽的位置，不搬动既有自定义内容。
- 添加新槽时只额外插入必要的换行；重复生成幂等，不积累空白。已有模块之外的自定义字节不被改写。
- 标记缺损、错配、嵌套或重复时拒绝写入，不猜测恢复。正文不能包含保留的管理标记；修正格式后再运行。
- 正文输入必须为真实 UTF-8 Markdown 文件，不跟随模块或模块目录的软链接。
- `check` 不写文件；检测到偏移返回 1。`check --fix` 只修托管块。格式或预算错误返回 2，不截断、不使用模型缩写规则。
- 对已有输出软链接，更新其实际目标，保留链接本身；悬空输出软链接拒绝写入。

## Token 预算

默认 `o200k_base`，上限 2000，是本仓库的初始预算，不是“社区统一标准”。计数包括**完整输出文件**的正文、标题、标记、换行及未托管自定义内容；不包括 harness 系统消息、工具 schema 或其他项目规则。

```sh
node scripts/rules.mjs check --source . -o rules/generated/AGENTS.md --tokenizer cl100k_base
node scripts/rules.mjs generate --source . --max-tokens 1800 -o /path/to/AGENTS.md
```

编码表随已锁定依赖提供，计数过程不调用模型或上传规则。实际 provider 使用的 tokenizer 可能不同，不能把文件计数当作全模型订阅账单。预算超出时失败且不写文件；未托管内容即使过大也不会被自动删改。

## 接入 harness

先在新会话或原生离线 prompt 预览中验证实际规则入口。DSH／Trae 的通用入口链接到稳定本地克隆中的 `rules/generated/AGENTS.md`；Codex 专用入口链接到 `rules/generated/codex/AGENTS.md`。不要按品牌名猜测 `$CODEX_HOME` / `$TRAE_HOME` / `$DSH_HOME`。

AGY 使用专用快照，在本机将 `~/.gemini/AGENTS.md` 软链接到稳定克隆中的 `rules/generated/agy/AGENTS.md`。[AGY 官方规则文档](https://www.antigravity.google/docs/rules/)将此入口列为 App、CLI 与 IDE 支持的全局规则；独立 `AGENTS.md` 不需要 YAML frontmatter。安装前核对已有文件、软链接及其他规则入口，不覆盖未知内容，不同时向 `GEMINI.md` 或模块目录投放重复正文；安装后读回链接和内容，并在新会话验证实际加载。

完整文件软链接意味着块外内容也共享。若工具需要私有规则，使用自己的本地文件，通过生成器维护相同托管块，并保留其未托管前后缀；不要把私有内容加进共享快照。

旧规则在切换前先备份到本机私有目录，不上传凭据、历史会话、工具私有规则或安装状态。本文不承诺既有会话热更新；新会话加载才是验收基准。

## 维护边界

生成器不负责仓库拉取、软链接维护、插件安装、MCP 同步或原生权限/模型/账号配置。原有 `zsh` 配置保持独立。不要将本机状态、旧规则备份或凭据提交到本仓库。

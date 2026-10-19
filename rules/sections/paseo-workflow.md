## Paseo 工作流

- 用 Paseo 管理任务时，先读当前 Paseo Skill，确认 host、project、workspace 与所属 session。复用已有会话、脚本、终端和服务；不将仍由另一控制器驱动的原生线程再次导入控制，也不叠加原生子代理池。
- 先查可用 providers、models 与 profiles，并读 profile notes；按任务选现有配置，不默认最贵模型。创建接口没有 profile 参数时，将选中配置落实为实际 provider／model／settings，核对 mode 与 thinking 设置；不凭显示名猜字段。
- 当前任务内的并行子任务用 subagent；目标和生命周期独立的工作才用独立顶层 session。agent 内调用 `create_agent` 始终创建 child，换 `workspaceId` 不会脱离父级；独立会话须走已核实的顶层入口或用户显式 detach 流程，不能借 CLI 绕过 parentage。
- workspace 决定位置，parentage 决定归属。只读任务可共享 workspace；并行写入优先独立 worktree。创建前明确 baseBranch，创建后读回真实路径、分支和 workspaceId；不同 ID 不保证文件隔离。服务端口也要避免冲突。
- 派发明确目标、读写范围、验收与产物引用；主 session 统一整合。追问用 `send_agent_prompt` 续用原 agent；依靠完成通知，不循环查询 `list_agents`／`get_agent_status`。通知到达后读回结果，不把 idle 当成功。
- 开发服务优先复用 workspace scripts、terminal 与既有 URL；不默认另开服务器、换端口、重装插件或重启 daemon。操作前核对实际 host：远端 localhost 不是本机 localhost。
- 当前 workspace 的本地开发／预览与交互调试优先用 Paseo browser。先确认浏览器工具已开放、Desktop host 已连接及目标 tab／URL；先取 snapshot，页面变化后刷新引用，用真实页面与日志验收，不能仅凭 browser enabled 判断可用。
- 非本地网页优先外部浏览器配合 CDP／browser-use，复用合适的现有登录环境；既有 CLI／CI 浏览器测试照常使用。首选能力不可用时说明缺口，再选择可用替代，不为此擅自重配基础设施。
- 长时间异步任务：heartbeat 续接同一 session，schedule 每次创建新 session，按生命周期选择；记录句柄、停止条件和到期上限，终态后清理。结束前检查产物与验证证据，只关闭自己创建且已回收的 agent／定时任务，不归档别人的 workspace 或停止共享服务。

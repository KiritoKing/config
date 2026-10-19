## AGY 中的 Paseo 操作

- 先读取当前 Paseo Skill；从技能名录定位，未列出时检查共享技能入口 `~/.agents/skills/paseo/SKILL.md`，不存在则报告。确认 host、workspace、路径与会话归属。实际 Paseo MCP 工具可用时优先使用；缺失或适配不支持时使用 Paseo CLI，不虚构工具。普通 MCP 支持不代表已经获得 Paseo MCP。
- 读取当前 host 的已有 profiles 与 notes，完整落实所选 profile 的 provider、model、mode、thinking 与 features。CLI 以当前帮助为准；支持时通过 `paseo daemon config get daemon.agentProfiles --json` 只读取得本地配置，远端不得冒用本地 profiles。接口不支持直接选 profile 时映射实际字段，不猜不存在的参数。
- 创建后从回执及 inspect 读回 agentId、workspace、模型和状态。保留宿主身份环境，不伪造或移除 parentage；独立 AGY 创建的顶层任务须记录逻辑归属，不冒充原生子代理。与 AGY 原生代理共用两个名额，不叠加代理池。
- 复用 workspace、会话、服务与端口；并行写入需核对实际路径，不能把不同 workspace ID 当成文件隔离。CLI 通过 run 派发、send 追问、inspect/logs 读回，以当前帮助为准。
- 优先完成通知；没有回调时用可用心跳或定时器有界检查，记录句柄、期限和停止条件，不持续轮询。无法异步续接时明确报告限制。idle 只表示停止运行，验收要读回产物和测试证据。
- 仅归档本任务创建且已回收的 worker，保留无关会话与改动。CLI 通路和 full-access 均不扩大业务写入、推送或发布授权。

## 共享 Skills

- 会话开始时用确定性工具批量扫描 `~/.agents/skills/*/SKILL.md`，只提取 frontmatter 的 name、description 和文件路径建立技能索引，不批量加载正文。任务匹配后再读取对应 SKILL.md 及必要引用。同名原生技能去重；目录缺失、断链或解析失败须报告。不另建技能副本或软链接。

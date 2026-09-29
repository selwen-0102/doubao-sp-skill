# Tuzi 豆包 Seedance Skill 验收记录

## 验收范围

- 仓库不再包含网页、HTTP 服务或 GitHub Pages 工作流；
- Skill frontmatter、目录结构和 Codex UI 元数据；
- macOS 与 Windows PowerShell 安装脚本；
- 四个 Seedance 模型名称校验；
- HTTP(S) URL、data URL、本地图片和本地视频自动处理；
- 多条图片/视频输入顺序与数量限制；
- 任务创建、终态轮询、视频 URL 提取和流式下载；
- API URL 根地址、`/v1` 与完整 `/v1/videos` 形式兼容；
- API Key 不写入日志、Skill 文件或结果 JSON。

## 验收命令

```bash
node --check skills/doubao-seedance/scripts/run.mjs
node skills/doubao-seedance/scripts/run.mjs --help
bash -n install.sh
python3 /Users/shuidiyu/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  skills/doubao-seedance
git diff --check
```

安装脚本使用仓库外的临时 `CODEX_HOME` 做实际下载安装验证，不在仓库创建测试文件。

## 验收结果

| 检查项 | 结果 |
| --- | --- |
| Skill 结构校验 | 通过：官方 `quick_validate.py` 返回 `Skill is valid!` |
| Node.js 语法与 `--help` | 通过 |
| macOS 安装脚本语法 | 通过：`bash -n install.sh` |
| macOS 仓库内实际安装 | 通过：安装到临时 `CODEX_HOME` 并成功运行 `--help` |
| macOS 浅克隆实际安装 | 通过：从标准输入运行安装器，浅克隆后安装成功 |
| 模拟 API 完整调用 | 通过：本地 PNG/MP4 转 data URL、创建、轮询和下载均成功 |
| API URL 形式兼容 | 通过：完整 `/v1/videos` 地址被正确规范化 |
| 视频流式下载 | 通过：结果文件内容和字节数与模拟服务一致 |
| Windows PowerShell 脚本 | 结构审查通过；待 Windows PowerShell 实机最终确认 |
| 网页及 Pages 文件清理 | 通过：网页、HTTP 服务和 Pages 工作流均已删除 |
| Git 差异完整性 | 通过：`git diff --check` 无错误 |

Windows 实机最终调用需要在 Windows PowerShell、Git 与 Node.js 18+ 环境中执行。尝试使用微软 PowerShell x64 容器解析时，容器在 ARM 主机模拟层崩溃，因此没有将该次运行误记为通过；当前结论仅覆盖结构审查。

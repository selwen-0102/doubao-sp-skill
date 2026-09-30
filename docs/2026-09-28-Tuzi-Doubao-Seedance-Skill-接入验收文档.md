# Tuzi 豆包 Seedance Skill 接入验收文档

## 问题描述

项目原先同时提供 Codex Skill、Node 网页服务和 GitHub Pages。网页模式增加了浏览器 CORS、临时文件、服务端代理、页面部署和 API Key 暴露面的维护成本，已不再符合当前需求。

当前目标是仅保留可分发的 Codex Skill：用户填写 API URL 与 API Key 后，可以在 Codex、macOS 终端或 Windows PowerShell 中调用四个 Seedance 模型，添加多条本地或远程参考图片/视频，并下载生成结果。

## 修复思路

1. 删除 `web/`、`server.mjs`、网页专用 `package.json` 和 GitHub Pages 工作流。
2. 保留 `skills/doubao-seedance`，继续使用 `POST /v1/videos` 创建任务，通过 `GET /v1/videos/{task_id}` 轮询。
3. 本地图片和 MP4、MOV、WebM 视频由 CLI 自动转为 data URL，用户不需要手工转换。
4. 不依赖尚未普遍提供的 `/v1/videos/uploads`；需要公网 URL 时保留 `--upload-command` 扩展点。
5. 结果默认返回视频 URL；`--download` 使用流式写入和临时文件原子替换，避免整段视频常驻内存。
6. 新增 `install.sh` 与 `install.ps1`，分别覆盖 macOS 和 Windows PowerShell 的一键安装与更新；远程安装优先下载 GitHub API 压缩包，失败时回退 Git。
7. 安装脚本只复制 Skill 目录到 `${CODEX_HOME:-~/.codex}/skills/doubao-seedance`，不保存 API Key。
8. `--configure` 将 URL 与 Key 保存到当前用户的 Codex 配置目录；交互式 Key 输入不回显，macOS/Linux 文件权限固定为 `600`。
9. 连接信息按命令行参数、环境变量、全局配置的顺序覆盖；`--config-path` 只输出路径，`--clear-config` 可移除本机配置。

## 复现路径

macOS：

```bash
export DOUBAO_SEEDANCE_URL="https://your-api.example.com/v1"
export DOUBAO_SEEDANCE_KEY="sk-..."
node "$HOME/.codex/skills/doubao-seedance/scripts/run.mjs" \
  --model doubao-seedance-2-5-260628 \
  --prompt "镜头缓慢推进" \
  --image ./reference.png \
  --video ./reference.mp4 \
  --download
```

Windows PowerShell：

```powershell
$env:DOUBAO_SEEDANCE_URL = "https://your-api.example.com/v1"
$env:DOUBAO_SEEDANCE_KEY = "sk-..."
node "$HOME\.codex\skills\doubao-seedance\scripts\run.mjs" `
  --model doubao-seedance-2-5-260628 `
  --prompt "镜头缓慢推进" `
  --video ".\reference.mp4" `
  --download
```

## 更新代码架构

```text
Codex 或终端
  -> skills/doubao-seedance/scripts/run.mjs
    -> 本地图片/视频自动转换为 data URL
    -> POST /v1/videos
    -> GET /v1/videos/{task_id}
    -> video_url
       |-- --download: 流式落盘
       `-- --base64: 显式输出 Base64
```

仓库不再运行 HTTP 服务，不监听本地端口，也不发布网页。

## 资源与安全边界

- 单个本地媒体及视频 data URL 默认限制为 20 MiB。
- 全部内联参考媒体合计限制为 45 MiB，防止请求构造造成无界内存占用。
- `--base64` 结果默认限制为 128 MiB；普通下载保持流式处理。
- 参考图片最多 9 条、参考视频最多 3 条。
- 轮询间隔不能低于 3 秒，失败后不自动重建可能产生费用的任务。
- API Key 从参数、环境变量或本机全局配置读取，不写入日志、聊天、仓库与结果 JSON；全局配置含明文 Key，不得上传、同步或分享。

## 变更记录

- 2026-09-29：移除全部可视化网页与 Pages 发布，项目收敛为纯 Codex Skill 和跨平台 CLI。
- 2026-09-29：增加 macOS、Windows 一键安装脚本及两端终端调用说明。
- 2026-09-29：取消 CLI 对 `/v1/videos/uploads` 的默认依赖，恢复本地媒体自动 data URL 提交。
- 2026-09-29：补充 Codex 调用模板，明确 API URL 与 API Key 的填写位置及缺失信息询问规则。
- 2026-09-30：增加全局连接配置，URL 与 Key 只需本机配置一次，避免每次会话发送密钥。
- 2026-09-30：配置向导先校验 URL，避免误把 API Key 当成 URL，并对 URL 错误信息脱敏。

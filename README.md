# Doubao Seedance Skill

纯 Codex Skill 和跨平台命令行工具。用户只需填写视频 API URL 与 API Key，即可调用豆包 Seedance、添加多条参考图片或视频，并下载生成结果。

仓库不包含网页、网页服务或 GitHub Pages。

## 支持模型

- `doubao-seedance-2-5-260628`
- `doubao-seedance-2-0-260128`
- `doubao-seedance-2-0-fast-260128`
- `doubao-seedance-2-0-mini-260615`

目标 API 需要兼容 `POST /v1/videos` 与 `GET /v1/videos/{task_id}`。URL 可以填写站点根地址、`/v1` 地址或完整的 `/v1/videos` 地址，不限制服务商或域名。

## 安装

需要 Node.js 18 或更高版本以及 Git。安装后请重新启动 Codex。

macOS 终端：

```bash
curl -fsSL -H 'Accept: application/vnd.github.raw+json' \
  https://api.github.com/repos/selwen-0102/doubao-sp-skill/contents/install.sh | bash
```

Windows PowerShell：

```powershell
irm -Headers @{ Accept = "application/vnd.github.raw+json" } `
  https://api.github.com/repos/selwen-0102/doubao-sp-skill/contents/install.ps1 | iex
```

安装位置默认为 `~/.codex/skills/doubao-seedance`；设置了 `CODEX_HOME` 时会安装到其 `skills` 子目录。重复执行安装命令即可更新。

## Codex 调用

### 全局保存 API URL 和 Key（推荐）

只需配置一次，之后不用在每个 Codex 会话里粘贴 Key。配置命令会隐藏 Key 输入，并将配置保存到当前用户的 Codex 配置目录：

macOS：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/doubao-seedance/scripts/run.mjs" --configure
```

Windows PowerShell：

```powershell
$SkillRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
node (Join-Path $SkillRoot "skills\doubao-seedance\scripts\run.mjs") --configure
```

按提示依次输入一次，先输入 API URL，再输入 API Key：

```text
API URL：https://你的-api-地址/v1
API Key：sk-你的令牌（输入时不显示）
```

之后直接在 Codex 中输入即可：

```text
$doubao-seedance 使用 doubao-seedance-2-5-260628 生成视频，提示词是“镜头缓慢推进”，完成后下载。
```

配置文件默认位置：`~/.codex/config/doubao-seedance.json`。可用 `--config-path` 查看路径，`--clear-config` 清除本机配置。命令行参数优先于环境变量，环境变量优先于全局配置。配置文件只保存在本机，不会写入聊天或仓库；macOS/Linux 会设置为当前用户可读写，Windows 使用用户目录默认权限。文件中包含明文 Key，请勿上传、同步或分享该文件。

### 仅在当前会话临时提供

不想保存到本机时，也可以把连接信息和生成要求一起输入。此方式会让 Key 出现在当前会话中，不建议长期使用：

```text
$doubao-seedance
API URL：https://你的-api-地址/v1
API Key：sk-你的令牌
模型：doubao-seedance-2-5-260628
提示词：一只纸飞机穿过明亮房间，镜头稳定
参考图片：/path/to/reference.png
完成后下载视频。
```

Skill 会自动处理本地图片和视频，不需要用户手动转换 Base64。没有全局配置且当前会话未提供 API URL 或 API Key 时，Codex 会先询问再执行。

如果不希望在对话中填写 API Key，也可以使用下方 macOS 或 Windows 环境变量临时配置。

## macOS 终端调用

```bash
export DOUBAO_SEEDANCE_URL="https://your-api.example.com/v1"
export DOUBAO_SEEDANCE_KEY="sk-..."

node "${CODEX_HOME:-$HOME/.codex}/skills/doubao-seedance/scripts/run.mjs" \
  --model doubao-seedance-2-5-260628 \
  --prompt "一只纸飞机穿过明亮房间，镜头稳定" \
  --image ./reference.png \
  --video ./reference.mp4 \
  --download
```

## Windows PowerShell 调用

```powershell
$env:DOUBAO_SEEDANCE_URL = "https://your-api.example.com/v1"
$env:DOUBAO_SEEDANCE_KEY = "sk-..."
$SkillRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }

node (Join-Path $SkillRoot "skills\doubao-seedance\scripts\run.mjs") `
  --model doubao-seedance-2-5-260628 `
  --prompt "一只纸飞机穿过明亮房间，镜头稳定" `
  --image ".\reference.png" `
  --video ".\reference.mp4" `
  --download
```

默认下载到当前目录的 `doubao-seedance-output`，可用 `--download-dir` 指定目录。

## 参考媒体

`--image` 与 `--video` 可以重复使用，并保持输入顺序：

- HTTP(S) URL：直接提交；
- 图片 data URL：直接提交；
- 视频 data URL：校验后提交；
- 本地图片：自动转为图片 data URL；
- 本地 MP4、MOV、WebM：自动转为视频 data URL。

默认单个本地媒体最大 20 MiB，全部内联媒体合计最大 45 MiB。若目标 API 不接收视频 data URL，可通过 `--upload-command` 接入自定义上传器，让上传器返回一个 HTTP(S) URL。

完整参数：

```bash
node skills/doubao-seedance/scripts/run.mjs --help
```

API Key 不会写入仓库。避免把真实密钥提交到日志、截图或 Git。

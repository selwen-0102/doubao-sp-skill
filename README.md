# Doubao Seedance Skill

这是一个可分发的 Codex Skill，并附带独立可视化网页应用，通过 Tuzi API 网关调用豆包 Seedance 视频模型。

## 可视化应用

在线使用：<https://selwen-0102.github.io/doubao-sp-skill/>

需要 Node.js 18 或更高版本，不需要额外安装 npm 依赖：

```bash
npm start
```

浏览器打开 <http://localhost:8787>，在页面填写 Tuzi API 网关 URL、API Key，选择模型并输入提示词。页面支持：

- 多条本地参考图片和视频，以及图片/视频 URL、data URL；
- 选择本地图片后自动转成 Base64 `data:` URL，用户无需手动转换；
- 选择本地 MP4、MOV、WebM 视频后，在生成时自动转成 Base64 `data:` URL，并直接提交到 `POST /v1/videos`；
- 模型切换后，从 Tuzi API 站同步该模型的时长、比例和分辨率/尺寸选项；
- 任务状态等待、视频预览和下载；
- 视频 URL 复制和 Base64 复制。

本地 Node 版通过同源代理读取模型参数并调用网关；GitHub Pages 版直接从浏览器调用你填写的网关，模型参数使用部署时从 Tuzi API 站生成的同源快照。若 API 站暂时没有对应参数，页面会显示最小兜底配置。分辨率字段是否实际转发仍以网关渠道能力为准，目前标准版 `doubao-seedance-2-0-260128` 明确支持 `resolution`。

API Key 只在当前浏览器请求和服务端内存中的短期视频代理中使用，不会写入仓库或浏览器本地存储。部署公网服务时请使用 HTTPS，并在反向代理层增加登录、访问控制和限流。

参考图片最多 9 条，参考视频最多 3 条。图片和视频 data URL 均作为 `content[]` 直接提交到 `POST /v1/videos`，不会再请求额外上传接口。网页单个本地视频限制 20 MiB、本地视频合计限制 30 MiB，全部内联参考媒体合计限制 45 MiB。

服务端可通过 `PORT` 修改端口：

```bash
PORT=8787 npm start
```

本地服务默认只监听 `127.0.0.1`；自托管到公网时请显式配置反向代理、认证、限流和 HTTPS，不要把无认证的 `/api/generate` 直接暴露到公网。

## 安装

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo selwen-0102/doubao-sp-skill \
  --path skills/doubao-seedance
```

安装后重新开始一个 Codex 对话，即可使用 `$doubao-seedance`。

## 配置

```bash
export DOUBAO_SEEDANCE_URL="https://your-tuzi-api.example.com"
export DOUBAO_SEEDANCE_KEY="sk-..."
```

网关需要提前配置豆包 Seedance 渠道和模型。Skill 支持以下模型：

- `doubao-seedance-2-5-260628`
- `doubao-seedance-2-0-260128`
- `doubao-seedance-2-0-fast-260128`
- `doubao-seedance-2-0-mini-260615`

## 直接调用

```bash
node skills/doubao-seedance/scripts/run.mjs \
  --model doubao-seedance-2-5-260628 \
  --prompt "一只纸飞机穿过明亮房间，镜头稳定" \
  --image ./reference.png \
  --video ./reference.mp4 \
  --download
```

脚本默认轮询任务并输出 JSON，其中包含 `task_id`、`status` 和 `video_url`。`--image`、`--video` 可以重复使用；输入支持 HTTP(S) URL、`data:` URL 和本地文件。本地图片和视频默认转为 Base64 `data:` URL，并直接提交到 `POST /v1/videos`；仍可通过 `--upload-command` 把本地文件转换为公网 URL。

更多参数见 [Skill 使用说明](skills/doubao-seedance/SKILL.md)。

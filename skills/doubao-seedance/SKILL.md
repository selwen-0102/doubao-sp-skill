---
name: doubao-seedance
description: "通过 Tuzi API 网关调用豆包 Seedance 视频模型，支持多条参考图片/视频、URL、data URL 和本地文件自动处理。"
---

# 豆包 Seedance 视频生成

用于通过 Tuzi API 网关的 OpenAI 兼容视频接口调用以下模型：

- `doubao-seedance-2-5-260628`
- `doubao-seedance-2-0-260128`
- `doubao-seedance-2-0-fast-260128`
- `doubao-seedance-2-0-mini-260615`

## 使用方式

只需要网关地址和令牌。推荐通过环境变量传入，避免把令牌写入命令历史：

```bash
export DOUBAO_SEEDANCE_URL="https://your-tuzi-api.example.com"
export DOUBAO_SEEDANCE_KEY="sk-..."
```

调用脚本：

```bash
node skills/doubao-seedance/scripts/run.mjs \
  --model doubao-seedance-2-5-260628 \
  --prompt "一只纸飞机穿过阳光明亮的房间，镜头平稳，电影感"
```

也可以用 `--url` 和 `--key` 覆盖环境变量。脚本会创建任务并轮询到终态，默认在标准输出返回 JSON，包含 `task_id`、`status` 和 `video_url`。

## 参考媒体

`--image` 和 `--video` 可重复传入多条，顺序会保留：

```bash
node skills/doubao-seedance/scripts/run.mjs \
  --model doubao-seedance-2-0-260128 \
  --prompt "保持主体一致，缓慢推进镜头" \
  --image ./refs/first.png \
  --image https://example.com/style.jpg \
  --video ./refs/reference.mp4
```

参考图片最多 9 条，参考视频最多 3 条，混合输入保持命令行中的传入顺序。每条参考媒体都支持：

- `http(s)://` URL：原样提交；
- 图片 `data:<mime>;base64,...`：原样提交；
- 视频 `data:video/...;base64,...`：校验大小和格式后直接作为 `video_url.url` 提交；
- 本地图片：读取后转成 `data:` URL；
- 本地 MP4、MOV、WebM 视频：读取后转成 `data:video/...;base64,...`，随 `POST /v1/videos` 一次提交。

本地文件和视频 data URL 默认限制为 20 MiB，可用 `--max-media-bytes` 调整；全部内联参考媒体合计限制为 45 MiB，避免 Base64 请求造成过高内存占用。网关必须允许 `video_url.url` 使用 `data:video/...;base64,...`。

如需覆盖网关内置上传，可通过 `--upload-command` 注入自定义上传器。上传器按以下约定接收参数，并且只向标准输出打印最终 `http(s)` URL：

```text
uploader <local-file> <mime-type> <image|video>
```

未配置自定义上传器时，本地视频直接转为 data URL；配置自定义上传器后，本地文件将改用上传器返回的 HTTP(S) URL。

## 输出选项

- `--download`：把完成的视频流式下载到 `./doubao-seedance-output`；用 `--download-dir` 指定目录。
- `--base64`：在结果 JSON 中附加 `video_base64`。这是显式的大输出操作，只对确实需要 Base64 的场景使用。
- `--poll-interval`、`--timeout`：调整轮询间隔和超时时间；轮询间隔不能小于 3 秒。
- `--request-json`：补充或覆盖网关支持的其他请求字段，例如 `duration`、`ratio`、`generate_audio`、`watermark`。

完整参数和请求构造逻辑见 [scripts/run.mjs](scripts/run.mjs)。不要在日志或 Skill 文件中写入真实令牌。

## 分发

将整个 `doubao-seedance` 目录安装或复制到使用者的 Codex Skills 目录，保留 `SKILL.md`、`agents/openai.yaml` 和 `scripts/run.mjs` 三个部分即可。每位使用者只需配置自己的 `DOUBAO_SEEDANCE_URL` 与 `DOUBAO_SEEDANCE_KEY`。

---
name: doubao-seedance
description: "通过用户提供的视频 API 调用豆包 Seedance 模型，自动处理多条参考图片或视频，并可下载生成结果。"
---

# 豆包 Seedance 视频生成

使用 `scripts/run.mjs` 创建视频任务、轮询终态并按需下载结果。不要要求用户手动转换本地图片或视频。

## 执行流程

1. 从用户输入或环境变量读取 API URL 与 API Key：
   - `DOUBAO_SEEDANCE_URL`
   - `DOUBAO_SEEDANCE_KEY`
2. 若缺少其中一项，再向用户询问；不要输出、记录或写入真实 API Key。
3. 根据用户要求选择模型、提示词、参考媒体和输出选项。
4. 调用当前 Skill 目录中的 `scripts/run.mjs`。使用绝对路径，避免依赖当前工作目录下存在 `skills/`。
5. 报告任务状态、视频 URL 和实际下载路径；失败时返回 API 错误，不静默重复创建收费任务。

## 支持模型

- `doubao-seedance-2-5-260628`
- `doubao-seedance-2-0-260128`
- `doubao-seedance-2-0-fast-260128`
- `doubao-seedance-2-0-mini-260615`

API URL 可以是站点根地址、`/v1` 地址或完整的 `/v1/videos` 地址。目标 API 需要兼容 `POST /v1/videos` 与 `GET /v1/videos/{task_id}`，不限制服务商或域名。

## 调用示例

```bash
node /absolute/path/to/doubao-seedance/scripts/run.mjs \
  --model doubao-seedance-2-5-260628 \
  --prompt "保持主体一致，镜头缓慢推进" \
  --image /absolute/path/to/reference.png \
  --video /absolute/path/to/reference.mp4 \
  --download
```

`--image` 和 `--video` 可重复传入，混合输入顺序会保留。参考图片最多 9 条，参考视频最多 3 条。

每条参考媒体支持：

- HTTP(S) URL：原样提交；
- 图片 data URL：原样提交；
- 视频 data URL：校验 Base64、MIME 与大小后提交；
- 本地图片：自动读取并转成图片 data URL；
- 本地 MP4、MOV、WebM：自动读取并转成视频 data URL。

单个本地媒体与视频 data URL 默认限制为 20 MiB，全部内联媒体合计限制为 45 MiB。若 API 不接受视频 data URL，优先让用户提供视频 URL；也可以使用 `--upload-command` 接入返回 HTTP(S) URL 的自定义上传器。

## 输出

- 默认输出 JSON，包含 `task_id`、`status` 和 `video_url`。
- `--download`：流式下载到 `./doubao-seedance-output`。
- `--download-dir <dir>`：指定下载目录并自动启用下载。
- `--base64`：在结果 JSON 中附加视频 Base64，仅在用户明确需要时使用。
- `--request-json`：补充 API 支持的字段，例如 `duration`、`ratio`、`generate_audio`、`watermark`。
- `--poll-interval` 和 `--timeout`：调整轮询间隔与总等待时间；轮询间隔不能低于 3 秒。

完整参数使用 `node scripts/run.mjs --help` 查看。

# Tuzi 豆包 Seedance Skill 接入验收文档

## 问题描述

需要为团队提供一个可复用的 Codex Skill，用最少配置调用 Tuzi API 网关中的豆包 Seedance 视频模型，并支持多条参考图片、参考视频、URL、Base64 和本地文件输入。

## 修复思路

1. Skill 只依赖 Tuzi API 网关的 `url + key`，通过统一的 `POST /v1/videos` 创建任务。
2. 脚本固定允许四个 Seedance 模型，避免误传不受支持的模型。
3. 参考媒体使用统一的 `content[]`：图片使用 `image_url`/`reference_image`，视频使用 `video_url`/`reference_video`，参数可重复传入。
4. HTTP(S) URL 和 `data:` URL 原样提交；本地文件根据扩展名识别 MIME 后转为 Base64 `data:` URL。
5. 任务通过 `GET /v1/videos/{task_id}` 轮询，结果默认返回视频 URL，下载使用流式写入并通过临时文件原子替换。
6. 公网 URL 上传不绑定具体 OSS，使用 `--upload-command` 注入可替换上传器。

## 复现路径

```bash
export DOUBAO_SEEDANCE_URL="http://127.0.0.1:3100"
export DOUBAO_SEEDANCE_KEY="sk-test"

node skills/doubao-seedance/scripts/run.mjs \
  --model doubao-seedance-2-5-260628 \
  --prompt "镜头缓慢推进" \
  --image ./reference.png \
  --video ./reference.mp4 \
  --download
```

## 更新代码架构

```text
Codex Skill
  -> scripts/run.mjs
    -> Tuzi API POST /v1/videos
    -> Tuzi API GET /v1/videos/{task_id}
    -> video_url
       ├─ --download: 流式落盘
       └─ --base64: 显式输出 Base64
```

Skill 本身不保存 API Key，也不修改 Tuzi API 网关的 Go 渠道实现。

## 已知边界

- 当前网关或豆包上游可能要求参考视频为公网 HTTP(S) URL；未配置上传器时，本地视频会按用户要求转为 `data:` URL，但是否被上游接受取决于渠道能力。
- 单个本地媒体默认限制为 64 MiB；`--base64` 结果默认限制为 128 MiB，避免无界内存占用。
- 任务轮询间隔不能低于 3 秒。

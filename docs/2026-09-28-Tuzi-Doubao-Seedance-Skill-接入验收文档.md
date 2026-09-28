# Tuzi 豆包 Seedance Skill 接入验收文档

## 问题描述

需要为团队提供一个可复用的 Codex Skill，用最少配置调用 Tuzi API 网关中的豆包 Seedance 视频模型，并支持多条参考图片、参考视频、URL、Base64 和本地文件输入。

本次新增独立 Web 应用，保留原有 CLI Skill。用户在页面填写自己的网关 URL 和 API Key，不要求使用终端命令。

## 修复思路

1. Skill 只依赖 Tuzi API 网关的 `url + key`，通过统一的 `POST /v1/videos` 创建任务。
2. 脚本固定允许四个 Seedance 模型，避免误传不受支持的模型。
3. 参考媒体使用统一的 `content[]`：图片使用 `image_url`/`reference_image`，视频使用 `video_url`/`reference_video`，参数可重复传入。
4. 图片 HTTP(S) URL 和 `data:` URL 原样提交；本地图片根据扩展名识别 MIME 后转为 Base64 `data:` URL。
5. 任务通过 `GET /v1/videos/{task_id}` 轮询，结果默认返回视频 URL，下载使用流式写入并通过临时文件原子替换。
6. 本地视频自动转换为 `data:video/...;base64,...`，与视频 data URL 一样直接放入 `content[].video_url.url`，统一通过 `POST /v1/videos` 创建任务；CLI 仍可用 `--upload-command` 改为公网 URL。
7. Web 表单不再固定时长、比例和尺寸：本地 Node 模式通过 `/api/model-metadata` 代理读取 Tuzi API 站模型数据，GitHub Pages 使用部署时生成的 `model-metadata.json` 同源快照；缺失字段才使用最小兜底。
8. Web 请求单独发送 `duration`、`ratio`、`resolution`，不把 `size` 当作分辨率控制。当前网关适配器明确转发 `resolution` 的是标准版 `doubao-seedance-2-0-260128`，其他模型的尺寸选项用于展示/计费参考，实际能力以渠道为准。
9. Web 本地图片由浏览器自动读取并转换成 Base64 `data:` URL，用户只需选择文件；支持 JPEG、PNG、WebP、BMP、TIFF、GIF，单图 30 MiB、全部本地图 45 MiB。
10. Web 支持直接多选 MP4、MOV、WebM 本地视频，也支持视频 HTTP(S) URL 和 Base64 data URL；单个内联视频限制 20 MiB、内联视频合计 30 MiB、全部内联参考媒体合计 45 MiB。
11. 参考图片最多 9 条、参考视频最多 3 条；Web、Node 代理和 CLI 均提前校验，并保留混合媒体输入顺序。

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
    -> 本地图片/视频转换为 data URL
    -> Tuzi API POST /v1/videos（唯一生成接口）
    -> Tuzi API GET /v1/videos/{task_id}
    -> video_url
       ├─ --download: 流式落盘
       └─ --base64: 显式输出 Base64
```

Skill 本身不保存 API Key，也不修改 Tuzi API 网关的 Go 渠道实现。

Web 应用由 `server.mjs` 提供同源页面和 API 代理。本地视频在浏览器内按需转换为 data URL，并直接请求网关的 `/v1/videos`；不再调用额外上传接口。普通 URL 请求在 Node 模式下仍可走 `/api/generate`，GitHub Pages 始终直连网关。完成后的上游视频在 Node 模式下通过带短期随机令牌的 `/api/video/{token}` 流式代理给浏览器。

GitHub Pages 部署工作流会在发布前逐模型请求 `https://api.tu-zi.com/api/pricing/models`，生成同源模型元数据快照，避免价格接口在浏览器环境下的跨域差异。

启动方式：

```bash
npm start
# 浏览器访问 http://localhost:8787
```

## 已知边界

- Web 端本地视频会直接请求网关 `/v1/videos`，部署网关需允许页面来源的 CORS 请求、`Authorization` 请求头和视频 data URL。
- CLI 单个本地媒体及视频 data URL 默认限制为 20 MiB，全部内联媒体合计限制为 45 MiB；`--base64` 结果默认限制为 128 MiB，避免无界内存占用。
- 任务轮询间隔不能低于 3 秒。
- 公网部署必须自行增加 HTTPS、用户认证、限流和日志脱敏；本项目的页面 Key 输入不写入 localStorage。
- API 站模型参数随服务端配置变化，Pages 快照在下一次部署时更新；本地 Node 模式每次切换模型实时查询。

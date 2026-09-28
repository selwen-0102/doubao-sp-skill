# Tuzi 豆包 Seedance Skill 验收记录

## 验收范围

- 四个目标模型名称校验；
- 多条参考图片和参考视频；
- HTTP(S) URL、`data:` URL、本地图片和视频自动 Base64；
- 创建任务、轮询终态、视频 URL 提取；
- 流式下载和可选 Base64 输出；
- API Key 不写入日志或 Skill 文件。
- Web 页面加载、生成接口代理、短期视频代理。
- 模型元数据驱动的时长、比例、分辨率选项。
- 本地图片和视频自动转换为 Base64 `data:` URL，并统一提交到 `/v1/videos`。
- 图片最多 9 条、视频最多 3 条，混合输入保持顺序。

## 验收结果

| 检查项 | 结果 |
| --- | --- |
| Skill frontmatter 与目录结构 | 通过 |
| `agents/openai.yaml` 解析 | 通过 |
| Node.js 脚本语法检查 | 通过 |
| `--help` 参数说明 | 通过 |
| 模拟网关完整调用 | 通过 |
| 多媒体输入数量与顺序 | 通过 |
| 本地图片转 `data:` URL | 通过 |
| 任务轮询与结果 URL | 通过 |
| 流式下载 | 通过 |
| Base64 输出 | 通过 |
| 非法模型拒绝 | 通过 |
| Web 页面静态资源加载 | 通过：本机浏览器桌面视口已验证 |
| Web `/api/generate` 代理与视频流 | 通过：模拟网关提交/轮询及 `206 Range` 视频流已验证 |
| API 站模型参数实时同步 | 通过：本地页面切换标准版显示 `16:9` 与 `480p/720p/1080p/4k` |
| GitHub Pages 参数快照工作流 | 通过：四模型快照与 Pages 发布成功 |
| 线上动态参数显示 | 通过：Pages 切换标准版后显示部署快照、默认 `1080p` 和四档分辨率 |
| 本地图片自动转换 | 通过：浏览器选择 PNG 后生成 `data:image/png;base64,...` 并显示缩略图 |
| 本地视频自动 Base64 | 通过：CLI 将本地 MP4 转成 `data:video/mp4;base64,...` 并提交到 `/v1/videos` |
| 视频 data URL 直接提交 | 通过：模拟网关收到 `content[].video_url.url`，没有 `/v1/videos/uploads` 请求 |
| 图片/视频数量上限 | 通过：第 4 条视频在 CLI 和 Node 代理均被拒绝 |
| Web 本地视频入口 | 通过：页面显示本地多选 `Video` 按钮，视频 data URL 显示 `READY` |
| 图片 data URL 网关请求 | 通过：模拟网关收到 `reference_image` 并完成任务轮询 |

## 验收命令

```bash
node --check skills/doubao-seedance/scripts/run.mjs
python3 /Users/shuidiyu/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  skills/doubao-seedance
```

另外使用临时 HTTP 模拟网关验证了本地视频和视频 data URL 上传、混合媒体顺序、POST、轮询、下载和 Base64 流程，临时文件未写入仓库。

可视化应用验收命令：

```bash
node --check server.mjs
node --check web/app.js
npm start
```

然后访问 `http://localhost:8787/health`，应返回 `{"ok":true}`；浏览器访问 `/` 应显示 Doubao Seedance Studio 页面。

动态参数检查：填写 `https://api.tu-zi.com`，切换四个模型，确认 `Duration`、`Ratio`、`Resolution / size` 随模型变化，状态显示“参数已从 API 站同步”。

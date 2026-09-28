# Tuzi 豆包 Seedance Skill 验收记录

## 验收范围

- 四个目标模型名称校验；
- 多条参考图片和参考视频；
- HTTP(S) URL、`data:` URL、本地文件 Base64；
- 创建任务、轮询终态、视频 URL 提取；
- 流式下载和可选 Base64 输出；
- API Key 不写入日志或 Skill 文件。

## 验收结果

| 检查项 | 结果 |
| --- | --- |
| Skill frontmatter 与目录结构 | 通过 |
| `agents/openai.yaml` 解析 | 通过 |
| Node.js 脚本语法检查 | 通过 |
| `--help` 参数说明 | 通过 |
| 模拟网关完整调用 | 通过 |
| 多媒体输入数量与顺序 | 通过 |
| 本地图片/视频转 `data:` URL | 通过 |
| 任务轮询与结果 URL | 通过 |
| 流式下载 | 通过 |
| Base64 输出 | 通过 |
| 非法模型拒绝 | 通过 |

## 验收命令

```bash
node --check skills/doubao-seedance/scripts/run.mjs
python3 /Users/shuidiyu/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  skills/doubao-seedance
```

另外使用临时 HTTP 模拟网关验证了 POST、轮询、下载和 Base64 流程，临时文件未写入仓库。

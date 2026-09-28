# Doubao Seedance Skill

这是一个可分发的 Codex Skill，通过 Tuzi API 网关调用豆包 Seedance 视频模型。

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

脚本默认轮询任务并输出 JSON，其中包含 `task_id`、`status` 和 `video_url`。`--image`、`--video` 可以重复使用；输入支持 HTTP(S) URL、`data:` URL 和本地文件。本地文件默认转为 Base64 `data:` URL。若上游要求视频公网 URL，可通过 `--upload-command` 接入上传器。

更多参数见 [Skill 使用说明](skills/doubao-seedance/SKILL.md)。

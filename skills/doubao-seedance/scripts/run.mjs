#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, extname, join, resolve } from "node:path";

const MODELS = new Set([
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
]);
const DEFAULT_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BASE64_BYTES = 128 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_SECONDS = 15;
const MIN_POLL_INTERVAL_SECONDS = 3;
const DEFAULT_TIMEOUT_SECONDS = 600;

const MIME_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".m4v", "video/x-m4v"],
  [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"],
]);

function printHelp() {
  console.log(`Usage:
  node skills/doubao-seedance/scripts/run.mjs --model <model> --prompt <text> [options]

Connection:
  --url <url>                 Tuzi API base URL; default DOUBAO_SEEDANCE_URL
  --key <key>                 API key; default DOUBAO_SEEDANCE_KEY

Request:
  --model <model>             One of the four supported Seedance models
  --prompt <text>             Text prompt (required unless request JSON has text)
  --image <source>            Reference image; repeatable
  --video <source>            Reference video; repeatable
  --request-json <json>       Extra request fields, merged before CLI fields
  --duration <seconds>        Override duration
  --ratio <ratio>             Override aspect ratio, for example 16:9
  --size <size>               Override size, for example 720p

Media:
  --upload-command <path>     Executable: <file> <mime> <image|video> -> URL
  --max-media-bytes <bytes>   Local media limit, default 67108864

Polling/output:
  --poll-interval <seconds>   Default 15, minimum 3
  --timeout <seconds>         Default 600
  --download                  Stream completed video to disk
  --download-dir <dir>        Download directory (implies --download)
  --base64                    Add completed video Base64 to result JSON
  --preflight                 Check /v1/models before creating a task
  -h, --help                  Show this help
`);
}

function parseArgs(argv) {
  const args = {
    model: DEFAULT_MODEL,
    images: [],
    videos: [],
    download: false,
    base64: false,
    preflight: false,
    pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    maxMediaBytes: DEFAULT_MAX_MEDIA_BYTES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[i];
    };

    switch (arg) {
      case "--url":
        args.url = next();
        break;
      case "--key":
        args.key = next();
        break;
      case "--model":
        args.model = next();
        break;
      case "--prompt":
        args.prompt = next();
        break;
      case "--image":
        args.images.push(next());
        break;
      case "--video":
        args.videos.push(next());
        break;
      case "--request-json":
        args.requestJson = next();
        break;
      case "--duration":
        args.duration = parsePositiveNumber(next(), arg);
        break;
      case "--ratio":
        args.ratio = next();
        break;
      case "--size":
        args.size = next();
        break;
      case "--upload-command":
        args.uploadCommand = next();
        break;
      case "--max-media-bytes":
        args.maxMediaBytes = parsePositiveNumber(next(), arg);
        break;
      case "--poll-interval":
        args.pollIntervalSeconds = parsePositiveNumber(next(), arg);
        break;
      case "--timeout":
        args.timeoutSeconds = parsePositiveNumber(next(), arg);
        break;
      case "--download":
        args.download = true;
        break;
      case "--download-dir":
        args.download = true;
        args.downloadDir = next();
        break;
      case "--base64":
        args.base64 = true;
        break;
      case "--preflight":
        args.preflight = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function log(event, fields = {}) {
  const suffix = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatLogValue(value)}`)
    .join(" ");
  process.stderr.write(`[${new Date().toISOString()}] [${event}]${suffix ? ` ${suffix}` : ""}\n`);
}

function formatLogValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error("Missing API URL. Provide --url or DOUBAO_SEEDANCE_URL.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid API URL: ${value}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("API URL must use http or https");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (parsed.pathname.endsWith("/v1")) {
    parsed.pathname = parsed.pathname.slice(0, -3).replace(/\/+$/, "");
  }
  return parsed.toString().replace(/\/$/, "");
}

function resolveConnection(args) {
  const url = normalizeBaseUrl(args.url || process.env.DOUBAO_SEEDANCE_URL);
  const key = args.key || process.env.DOUBAO_SEEDANCE_KEY;
  if (!key) {
    throw new Error("Missing API key. Provide --key or DOUBAO_SEEDANCE_KEY.");
  }
  return { url, key };
}

function authHeader(key) {
  return /^Bearer\s+/i.test(key) ? key : `Bearer ${key}`;
}

async function requestJson(url, { key, method = "GET", body, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(key),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const message = data?.error?.message || data?.message || response.statusText;
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertSupportedModel(model) {
  if (!MODELS.has(model)) {
    throw new Error(`Unsupported model: ${model}. Supported models: ${[...MODELS].join(", ")}`);
  }
}

async function buildRequest(args) {
  let request = {};
  if (args.requestJson) {
    try {
      request = JSON.parse(args.requestJson);
    } catch (error) {
      throw new Error(`Invalid --request-json: ${error.message}`);
    }
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("--request-json must contain a JSON object");
    }
  }

  const content = Array.isArray(request.content) ? [...request.content] : [];
  if (args.prompt !== undefined) {
    const textItem = content.find((item) => item?.type === "text");
    if (textItem) {
      textItem.text = args.prompt;
    } else {
      content.unshift({ type: "text", text: args.prompt });
    }
  }
  if (!content.some((item) => item?.type === "text" && String(item.text || "").trim())) {
    throw new Error("Missing prompt. Provide --prompt or a text item in --request-json.");
  }

  for (const source of args.images) {
    content.push({
      type: "image_url",
      image_url: { url: await resolveMediaSource(source, "image", args) },
      role: "reference_image",
    });
  }
  for (const source of args.videos) {
    content.push({
      type: "video_url",
      video_url: { url: await resolveMediaSource(source, "video", args) },
      role: "reference_video",
    });
  }

  request = { ...request, model: args.model, content };
  if (args.duration !== undefined) request.duration = args.duration;
  if (args.ratio !== undefined) request.ratio = args.ratio;
  if (args.size !== undefined) request.size = args.size;
  return request;
}

async function resolveMediaSource(source, kind, args) {
  if (/^(?:https?:|asset:|data:)/i.test(source)) {
    return source;
  }

  const filePath = resolve(process.cwd(), source);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`Media file does not exist: ${source}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`Media source is not a file: ${source}`);
  }

  const mime = mimeForFile(filePath, kind);
  if (args.uploadCommand) {
    return runUploader(args.uploadCommand, filePath, mime, kind);
  }
  if (fileStat.size > args.maxMediaBytes) {
    throw new Error(
      `Local ${kind} is ${fileStat.size} bytes, above --max-media-bytes ${args.maxMediaBytes}. Configure --upload-command for a public URL.`,
    );
  }

  const bytes = await readFile(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function mimeForFile(filePath, kind) {
  return MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ||
    (kind === "image" ? "image/png" : "video/mp4");
}

async function runUploader(command, filePath, mime, kind) {
  const child = spawn(command, [filePath, mime, kind], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const output = [];
  let outputBytes = 0;
  child.stdout.on("data", (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes <= 1024 * 1024) output.push(chunk);
  });
  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(`Uploader exited with code ${code}: ${command}`);
  }
  const url = Buffer.concat(output).toString("utf8").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Uploader must print one http(s) URL to stdout");
  }
  return url;
}

async function pollVideo({ baseUrl, key, taskId, pollIntervalSeconds, timeoutSeconds }) {
  const started = Date.now();
  let latest = null;
  let attempt = 0;
  while (Date.now() - started < timeoutSeconds * 1000) {
    attempt += 1;
    latest = await requestJson(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, { key });
    const status = String(latest?.status || latest?.data?.status || "").toLowerCase();
    log("poll", { task_id: taskId, attempt, status: status || "unknown" });
    if (["completed", "succeeded", "success", "failed", "cancelled", "canceled"].includes(status)) {
      return latest;
    }
    await sleep(pollIntervalSeconds * 1000);
  }
  throw new Error(`Timed out waiting for video task: ${taskId}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function taskIdFromResponse(response) {
  return response?.id || response?.task_id || response?.data?.id || response?.data?.task_id;
}

function videoUrlFromResponse(response) {
  const candidates = [
    response?.metadata?.url,
    response?.metadata?.video_url,
    response?.video_url,
    response?.url,
    response?.output?.video_url,
    response?.output?.url,
    response?.data?.video_url,
    response?.data?.url,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

function resolveVideoUrl(videoUrl, baseUrl) {
  return new URL(videoUrl, `${baseUrl}/`).toString();
}

function shouldSendDownloadAuth(videoUrl, baseUrl) {
  try {
    const target = new URL(videoUrl);
    const base = new URL(baseUrl);
    return target.origin === base.origin && target.pathname.startsWith("/v1/videos/");
  } catch {
    return false;
  }
}

async function fetchVideoResponse(videoUrl, baseUrl, key) {
  const resolvedUrl = resolveVideoUrl(videoUrl, baseUrl);
  const headers = { Accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.1" };
  if (shouldSendDownloadAuth(resolvedUrl, baseUrl)) headers.Authorization = authHeader(key);
  const response = await fetch(resolvedUrl, { headers });
  if (!response.ok) {
    throw new Error(`Video fetch failed with HTTP ${response.status}: ${resolvedUrl}`);
  }
  if (!response.body) throw new Error(`Video response body is empty: ${resolvedUrl}`);
  return { response, resolvedUrl };
}

async function downloadVideo(videoUrl, baseUrl, key, taskId, directory) {
  const { response, resolvedUrl } = await fetchVideoResponse(videoUrl, baseUrl, key);
  await mkdir(directory, { recursive: true });
  const extension = extensionForVideo(resolvedUrl, response.headers.get("content-type"));
  const finalPath = join(directory, `${safeName(taskId)}${extension}`);
  const tempPath = `${finalPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath, { flags: "wx" }));
    await rename(tempPath, finalPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  const fileStat = await stat(finalPath);
  return { path: finalPath, bytes: fileStat.size };
}

async function videoBase64(videoUrl, baseUrl, key) {
  const { response, resolvedUrl } = await fetchVideoResponse(videoUrl, baseUrl, key);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_BASE64_BYTES) {
    throw new Error(`Video is larger than ${DEFAULT_MAX_BASE64_BYTES} bytes; refuse --base64 output`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > DEFAULT_MAX_BASE64_BYTES) {
    throw new Error(`Video is larger than ${DEFAULT_MAX_BASE64_BYTES} bytes; refuse --base64 output`);
  }
  log("base64", { url: resolvedUrl, bytes: buffer.length });
  return buffer.toString("base64");
}

function extensionForVideo(videoUrl, contentType) {
  const type = String(contentType || "").split(";", 1)[0].toLowerCase();
  const byType = new Map([
    ["video/webm", ".webm"],
    ["video/quicktime", ".mov"],
    ["video/x-m4v", ".m4v"],
  ]);
  if (byType.has(type)) return byType.get(type);
  try {
    const extension = extname(new URL(videoUrl).pathname).toLowerCase();
    if (/^\.(mp4|webm|mov|m4v|avi|mkv)$/.test(extension)) return extension;
  } catch {
    // Fall through to the safe default.
  }
  return ".mp4";
}

function safeName(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9._-]+/g, "_") || "video";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  assertSupportedModel(args.model);
  if (args.pollIntervalSeconds < MIN_POLL_INTERVAL_SECONDS) {
    throw new Error(`--poll-interval must be at least ${MIN_POLL_INTERVAL_SECONDS} seconds`);
  }
  const { url: baseUrl, key } = resolveConnection(args);
  const request = await buildRequest(args);
  log("create.start", { url: `${baseUrl}/v1/videos`, model: args.model });

  if (args.preflight) {
    await requestJson(`${baseUrl}/v1/models`, { key });
  }
  const created = await requestJson(`${baseUrl}/v1/videos`, {
    method: "POST",
    key,
    body: request,
    timeoutMs: Math.min(args.timeoutSeconds * 1000, 120000),
  });
  const taskId = taskIdFromResponse(created);
  if (!taskId) throw new Error("Video create response did not contain a task id");
  log("create.done", { task_id: taskId, model: args.model });

  const finalResponse = await pollVideo({
    baseUrl,
    key,
    taskId,
    pollIntervalSeconds: args.pollIntervalSeconds,
    timeoutSeconds: args.timeoutSeconds,
  });
  const status = String(finalResponse?.status || finalResponse?.data?.status || "unknown").toLowerCase();
  const videoUrl = videoUrlFromResponse(finalResponse);
  const result = { task_id: taskId, model: args.model, status, video_url: videoUrl };

  if (["failed", "cancelled", "canceled"].includes(status)) {
    result.error = finalResponse?.error || finalResponse?.message || null;
  }
  if (videoUrl && args.download) {
    const directory = resolve(args.downloadDir || "./doubao-seedance-output");
    result.download = await downloadVideo(videoUrl, baseUrl, key, taskId, directory);
  }
  if (videoUrl && args.base64) {
    result.video_base64 = await videoBase64(videoUrl, baseUrl, key);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!videoUrl && status === "completed") {
    throw new Error("Video task completed but no video URL was found in the response");
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(ROOT, "web");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 128 * 1024 * 1024;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_REFERENCE_COUNT = 8;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 15 * 1000;
const VIDEO_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_VIDEO_TOKENS = 1000;

const MODELS = new Set([
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const videoTokens = new Map();
const cleanupTimer = setInterval(cleanExpiredVideoTokens, 60 * 1000);
cleanupTimer.unref();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanExpiredVideoTokens() {
  const now = Date.now();
  for (const [token, item] of videoTokens) {
    if (item.expiresAt <= now) videoTokens.delete(token);
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : "Server error";
  sendJson(response, status, { error: message });
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Request is too large");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large");
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Gateway URL is required");
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new HttpError(400, "Gateway URL is invalid");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new HttpError(400, "Gateway URL must use http or https");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (parsed.pathname.endsWith("/v1")) {
    parsed.pathname = parsed.pathname.slice(0, -3).replace(/\/+$/, "");
  }
  return parsed.toString().replace(/\/$/, "");
}

function authHeader(key) {
  return /^Bearer\s+/i.test(key) ? key : `Bearer ${key}`;
}

function validateContent(content) {
  if (!Array.isArray(content) || content.length === 0) {
    throw new HttpError(400, "At least one text prompt is required");
  }
  if (content.length > MAX_REFERENCE_COUNT + 1) {
    throw new HttpError(400, `At most ${MAX_REFERENCE_COUNT} reference files are allowed`);
  }

  let hasText = false;
  for (const item of content) {
    if (!item || typeof item !== "object") throw new HttpError(400, "Invalid content item");
    if (item.type === "text") {
      if (typeof item.text !== "string" || !item.text.trim()) {
        throw new HttpError(400, "Prompt cannot be empty");
      }
      hasText = true;
      continue;
    }
    if (item.type !== "image_url" && item.type !== "video_url") {
      throw new HttpError(400, "Only text, image_url and video_url are supported");
    }
    const media = item.type === "image_url" ? item.image_url : item.video_url;
    if (!media || typeof media.url !== "string" || !media.url.trim()) {
      throw new HttpError(400, "Reference media URL is required");
    }
    if (media.url.length > MAX_MEDIA_BYTES * 2) {
      throw new HttpError(413, "A reference media item is too large");
    }
  }
  if (!hasText) throw new HttpError(400, "A text prompt is required");
}

function buildUpstreamRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Request body must be an object");
  }
  const key = typeof input.api_key === "string" ? input.api_key.trim() : "";
  if (!key) throw new HttpError(400, "API key is required");
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!MODELS.has(model)) throw new HttpError(400, "Unsupported Seedance model");
  validateContent(input.content);

  const request = { model, content: input.content };
  for (const field of ["duration", "ratio", "resolution", "size", "generate_audio", "watermark"]) {
    if (input[field] !== undefined) request[field] = input[field];
  }
  return { baseUrl: normalizeBaseUrl(input.base_url), key, request };
}

async function requestJson(url, { key, method = "GET", body, timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(key ? { Authorization: authHeader(key) } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { raw };
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText;
      throw new HttpError(response.status >= 500 ? 502 : response.status, message || "Gateway request failed");
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new HttpError(504, "Gateway request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function taskIdFrom(payload) {
  return payload?.id || payload?.task_id || payload?.data?.id || payload?.data?.task_id;
}

function statusFrom(payload) {
  return String(payload?.status || payload?.data?.status || "").toLowerCase();
}

function videoUrlFrom(payload) {
  const candidates = [
    payload?.metadata?.url,
    payload?.metadata?.video_url,
    payload?.result_url,
    payload?.video_url,
    payload?.url,
    payload?.output?.video_url,
    payload?.output?.url,
    payload?.data?.content?.video_url,
    payload?.data?.video_url,
    payload?.data?.url,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function pollTask(baseUrl, key, taskId) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < TASK_TIMEOUT_MS) {
    latest = await requestJson(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, { key });
    const status = statusFrom(latest);
    if (["completed", "succeeded", "success", "failed", "cancelled", "canceled"].includes(status)) {
      return latest;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new HttpError(504, "Video task timed out");
}

function registerVideo(baseUrl, key, videoUrl) {
  cleanExpiredVideoTokens();
  if (videoTokens.size >= MAX_VIDEO_TOKENS) {
    const oldest = videoTokens.keys().next().value;
    if (oldest) videoTokens.delete(oldest);
  }
  const token = randomBytes(24).toString("base64url");
  videoTokens.set(token, {
    baseUrl,
    key,
    videoUrl: new URL(videoUrl, `${baseUrl}/`).toString(),
    expiresAt: Date.now() + VIDEO_TOKEN_TTL_MS,
  });
  return token;
}

function shouldSendAuth(targetUrl, baseUrl) {
  try {
    const target = new URL(targetUrl);
    const base = new URL(baseUrl);
    return target.origin === base.origin && target.pathname.startsWith("/v1/videos/");
  } catch {
    return false;
  }
}

async function proxyVideo(request, response, token) {
  const item = videoTokens.get(token);
  if (!item || item.expiresAt <= Date.now()) {
    videoTokens.delete(token);
    sendJson(response, 404, { error: "Video link expired" });
    return;
  }

  const headers = { Accept: "video/*,application/octet-stream;q=0.9,*/*;q=0.1" };
  if (request.headers.range) headers.Range = request.headers.range;
  if (shouldSendAuth(item.videoUrl, item.baseUrl)) headers.Authorization = authHeader(item.key);
  try {
    const upstream = await fetch(item.videoUrl, { headers, signal: request.signal });
    if (!upstream.ok || !upstream.body) {
      sendJson(response, upstream.status >= 400 ? upstream.status : 502, { error: "Video download failed" });
      return;
    }
    response.writeHead(upstream.status, {
      "Cache-Control": "private, no-store",
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length") } : {}),
      ...(upstream.headers.get("content-range") ? { "Content-Range": upstream.headers.get("content-range") } : {}),
      ...(upstream.headers.get("accept-ranges") ? { "Accept-Ranges": upstream.headers.get("accept-ranges") } : {}),
    });
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    if (!response.headersSent) sendJson(response, 502, { error: "Video proxy failed" });
  }
}

async function handleGenerate(request, response) {
  const input = await readJson(request);
  const { baseUrl, key, request: upstreamRequest } = buildUpstreamRequest(input);
  const created = await requestJson(`${baseUrl}/v1/videos`, {
    method: "POST",
    key,
    body: upstreamRequest,
  });
  const taskId = taskIdFrom(created);
  if (!taskId) throw new HttpError(502, "Gateway did not return a task id");

  const completed = await pollTask(baseUrl, key, taskId);
  const status = statusFrom(completed);
  if (["failed", "cancelled", "canceled"].includes(status)) {
    throw new HttpError(502, completed?.error?.message || completed?.message || "Video task failed");
  }
  const videoUrl = videoUrlFrom(completed);
  if (!videoUrl) throw new HttpError(502, "Gateway completed without a video URL");
  const token = registerVideo(baseUrl, key, videoUrl);
  sendJson(response, 200, {
    task_id: taskId,
    status,
    video_url: videoUrl,
    proxy_url: `/api/video/${token}`,
  });
}

async function handleModelMetadata(response, parsedUrl) {
  const baseUrl = normalizeBaseUrl(parsedUrl.searchParams.get("base_url") || "");
  const model = parsedUrl.searchParams.get("model") || "";
  if (!MODELS.has(model)) throw new HttpError(400, "Unsupported Seedance model");
  const payload = await requestJson(`${baseUrl}/api/pricing/models?models=${encodeURIComponent(model)}`, { timeoutMs: 15000 });
  sendJson(response, 200, payload);
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(WEB_ROOT, requested);
  const webRootPrefix = `${WEB_ROOT}${sep}`;
  if (filePath !== WEB_ROOT && !filePath.startsWith(webRootPrefix)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  try {
    const parsedUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && parsedUrl.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && parsedUrl.pathname === "/api/generate") {
      await handleGenerate(request, response);
      return;
    }
    if (request.method === "GET" && parsedUrl.pathname === "/api/model-metadata") {
      await handleModelMetadata(response, parsedUrl);
      return;
    }
    if (request.method === "GET" && parsedUrl.pathname.startsWith("/api/video/")) {
      await proxyVideo(request, response, parsedUrl.pathname.slice("/api/video/".length));
      return;
    }
    if (request.method === "GET") {
      await serveStatic(request, response, parsedUrl.pathname);
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Doubao Seedance Studio running at http://${HOST}:${PORT}`);
});

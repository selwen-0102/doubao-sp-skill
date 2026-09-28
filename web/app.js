const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 45 * 1024 * 1024;
const MAX_BASE64_BYTES = 128 * 1024 * 1024;
const MAX_REFERENCE_COUNT = 8;
const POLL_INTERVAL_MS = 15 * 1000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif"]);

const MODEL_NAMES = [
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
];

const state = {
  references: [],
  busy: false,
  result: null,
  metadata: null,
  metadataRequest: 0,
  proxyAvailable: false,
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $("#generationForm"),
  baseUrl: $("#baseUrl"),
  apiKey: $("#apiKey"),
  model: $("#model"),
  modelMetaStatus: $("#modelMetaStatus"),
  prompt: $("#prompt"),
  promptCount: $("#promptCount"),
  imageFile: $("#imageFile"),
  mediaList: $("#mediaList"),
  urlKind: $("#urlKind"),
  urlInput: $("#urlInput"),
  duration: $("#duration"),
  durationRange: $("#durationRange"),
  ratio: $("#ratio"),
  resolution: $("#resolution"),
  generateAudio: $("#generateAudio"),
  watermark: $("#watermark"),
  generateButton: $("#generateButton"),
  generateLabel: $("#generateLabel"),
  requestStatus: $("#requestStatus"),
  resultBadge: $("#resultBadge"),
  resultEmpty: $("#resultEmpty"),
  resultContent: $("#resultContent"),
  resultVideo: $("#resultVideo"),
  resultUrl: $("#resultUrl"),
  taskId: $("#taskId"),
  downloadButton: $("#downloadButton"),
  copyUrlButton: $("#copyUrlButton"),
  copyBase64Button: $("#copyBase64Button"),
  base64Status: $("#base64Status"),
  toast: $("#toast"),
};

const FALLBACK_METADATA = {
  "doubao-seedance-2-5-260628": { ratios: ["9:16", "16:9", "1:1"], ratio: "16:9", resolutions: ["480p", "720p"], resolution: "720p", duration: { min: 1, max: 30, step: 1, value: 8 } },
  "doubao-seedance-2-0-260128": { ratios: ["16:9"], ratio: "16:9", resolutions: ["480p", "720p", "1080p", "4k"], resolution: "1080p", duration: { min: 1, max: 30, step: 1, value: 5 } },
  "doubao-seedance-2-0-fast-260128": { ratios: ["16:9"], ratio: "16:9", resolutions: ["480p", "720p"], resolution: "720p", duration: { min: 1, max: 30, step: 1, value: 5 } },
  "doubao-seedance-2-0-mini-260615": { ratios: ["16:9"], ratio: "16:9", resolutions: ["480p", "720p"], resolution: "720p", duration: { min: 1, max: 30, step: 1, value: 5 } },
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function setRequestStatus(message, kind = "") {
  elements.requestStatus.textContent = message;
  elements.requestStatus.className = `request-status ${kind}`.trim();
}

function setBusy(busy) {
  state.busy = busy;
  elements.generateButton.disabled = busy;
  elements.generateLabel.textContent = busy ? "Rendering..." : "Generate video";
  elements.resultBadge.textContent = busy ? "RENDERING" : state.result ? "READY" : "WAITING";
  elements.resultBadge.className = `result-badge ${busy ? "busy" : state.result ? "ready" : ""}`.trim();
}

function updatePromptCount() {
  elements.promptCount.textContent = `${elements.prompt.value.length} / 2000`;
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Gateway URL is invalid");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Gateway URL must use http or https");
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (parsed.pathname.endsWith("/v1")) parsed.pathname = parsed.pathname.slice(0, -3).replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function authHeaders(key) {
  return key ? { Authorization: /^Bearer\s+/i.test(key) ? key : `Bearer ${key}` } : {};
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionValues(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (typeof option === "string" || typeof option === "number") return { value: String(option), label: String(option) };
    if (!option || typeof option !== "object") return null;
    const value = option.value ?? option.name ?? option.resolution ?? option.ratio;
    return value === undefined ? null : { value: String(value), label: String(option.label ?? value) };
  }).filter(Boolean);
}

function fallbackMetadata(model) {
  const fallback = FALLBACK_METADATA[model] || FALLBACK_METADATA[MODEL_NAMES[0]];
  return {
    ratios: [...fallback.ratios],
    ratio: fallback.ratio,
    resolutions: [...fallback.resolutions],
    resolution: fallback.resolution,
    duration: { ...fallback.duration },
    generateAudio: false,
    watermark: false,
    source: "fallback",
  };
}

function extractMetadata(payload, model) {
  const metadata = fallbackMetadata(model);
  const entry = Array.isArray(payload?.data)
    ? payload.data.find((item) => item?.model_name === model)
    : null;
  const endpoints = entry?.endpoints && typeof entry.endpoints === "object" ? Object.values(entry.endpoints) : [];
  const endpoint = endpoints.find((item) => item?.path === "/v1/videos") || endpoints[0];
  const parameters = Array.isArray(endpoint?.parameters) ? endpoint.parameters : [];
  const parameter = (name) => parameters.find((item) => item?.name === name || item?.path === name);

  const ratioParameter = parameter("ratio");
  const ratioOptions = optionValues(ratioParameter?.options);
  if (ratioOptions.length) metadata.ratios = ratioOptions.map((item) => item.value);
  if (ratioParameter?.default_value !== undefined) metadata.ratio = String(ratioParameter.default_value);

  const durationParameter = parameter("duration");
  if (durationParameter) {
    const min = readNumber(durationParameter.min, metadata.duration.min);
    const max = readNumber(durationParameter.max, metadata.duration.max);
    const step = Math.max(readNumber(durationParameter.step, metadata.duration.step), 0.1);
    const value = readNumber(durationParameter.default_value ?? durationParameter.initial_value, metadata.duration.value);
    metadata.duration = { min, max: Math.max(min, max), step, value };
  }

  const resolutionParameter = parameter("resolution");
  const resolutionOptions = optionValues(resolutionParameter?.options);
  if (resolutionOptions.length) metadata.resolutions = resolutionOptions.map((item) => item.value);
  if (resolutionParameter?.default_value !== undefined) metadata.resolution = String(resolutionParameter.default_value);
  const variants = entry?.conditional_task_pricing_details?.variants;
  if (!resolutionOptions.length && Array.isArray(variants)) {
    const resolutions = variants.map((variant) => variant?.resolution).filter(Boolean).map(String);
    const ratios = variants.map((variant) => variant?.ratio).filter(Boolean).map(String);
    if (resolutions.length) metadata.resolutions = [...new Set(resolutions)];
    if (!ratioOptions.length && ratios.length) metadata.ratios = [...new Set(ratios)];
  }

  const audioParameter = parameter("generate_audio");
  const watermarkParameter = parameter("watermark");
  if (audioParameter?.default_value !== undefined) metadata.generateAudio = Boolean(audioParameter.default_value);
  if (watermarkParameter?.default_value !== undefined) metadata.watermark = Boolean(watermarkParameter.default_value);
  metadata.source = parameters.length || Array.isArray(variants) ? "api" : "fallback";
  return metadata;
}

function setOptions(select, values, selectedValue) {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  if (values.includes(selectedValue)) select.value = selectedValue;
  else if (values.length) select.value = values[0];
}

function applyMetadata(metadata) {
  state.metadata = metadata;
  setOptions(elements.ratio, metadata.ratios, metadata.ratio);
  setOptions(elements.resolution, metadata.resolutions, metadata.resolution);
  elements.resolution.disabled = metadata.resolutions.length === 0;

  const duration = metadata.duration;
  elements.duration.min = String(duration.min);
  elements.duration.max = String(duration.max);
  elements.duration.step = String(duration.step);
  elements.duration.value = String(Math.min(duration.max, Math.max(duration.min, duration.value)));
  elements.durationRange.textContent = `(${duration.min}-${duration.max}s)`;
  elements.generateAudio.checked = metadata.generateAudio;
  elements.watermark.checked = metadata.watermark;
}

async function loadMetadata() {
  const model = elements.model.value;
  const requestId = ++state.metadataRequest;
  applyMetadata(fallbackMetadata(model));
  const rawBaseUrl = elements.baseUrl.value.trim();
  if (!rawBaseUrl) {
    elements.modelMetaStatus.textContent = "填写网关地址后同步模型参数";
    return;
  }

  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(rawBaseUrl);
  } catch (error) {
    elements.modelMetaStatus.textContent = error.message;
    return;
  }

  elements.modelMetaStatus.textContent = "正在同步 API 站模型参数...";
  try {
    const isTuzi = new URL(baseUrl).origin === "https://api.tu-zi.com";
    const metadataUrl = state.proxyAvailable
      ? `/api/model-metadata?base_url=${encodeURIComponent(baseUrl)}&model=${encodeURIComponent(model)}`
      : isTuzi ? "./model-metadata.json" : `${baseUrl}/api/pricing/models?models=${encodeURIComponent(model)}`;
    const response = await fetch(metadataUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`参数接口返回 ${response.status}`);
    const payload = await response.json();
    if (requestId !== state.metadataRequest) return;
    const modelPayload = isTuzi && !state.proxyAvailable ? { data: payload?.models?.[model] ? [payload.models[model]] : [] } : payload;
    const metadata = extractMetadata(modelPayload, model);
    applyMetadata(metadata);
    elements.modelMetaStatus.textContent = metadata.source === "api"
      ? isTuzi && !state.proxyAvailable ? "参数来自 API 站部署快照" : "参数已从 API 站同步"
      : "API 站缺少此模型参数，使用兜底配置";
  } catch (error) {
    if (requestId !== state.metadataRequest) return;
    elements.modelMetaStatus.textContent = `API 参数暂不可用，使用兜底配置（${error.message}）`;
  }
}

async function detectProxy() {
  try {
    const response = await fetch("./health", { cache: "no-store" });
    if (response.ok) state.proxyAvailable = Boolean((await response.json()).ok);
  } catch {
    state.proxyAvailable = false;
  }
  if (elements.baseUrl.value.trim()) void loadMetadata();
}

function readFileAsDataUrl(file) {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addImages(files) {
  if (state.references.length + files.length > MAX_REFERENCE_COUNT) throw new Error(`At most ${MAX_REFERENCE_COUNT} reference files are allowed`);
  const existingBytes = state.references.reduce((total, reference) => total + (reference.fileSize || 0), 0);
  const addedBytes = files.reduce((total, file) => total + file.size, 0);
  if (existingBytes + addedBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error("Local images exceed the 45 MiB total limit");
  for (const file of files) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error(`${file.name} is not a supported image`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} exceeds the 30 MiB limit`);
  }
  const references = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    references.push({ kind: "image", label: file.name, value: dataUrl, preview: dataUrl, fileSize: file.size });
  }
  state.references.push(...references);
  renderReferences();
  showToast(files.length === 1 ? "Image ready" : `${files.length} images ready`);
}

function addUrl() {
  if (state.references.length >= MAX_REFERENCE_COUNT) throw new Error(`At most ${MAX_REFERENCE_COUNT} reference files are allowed`);
  const value = elements.urlInput.value.trim();
  if (!/^(?:https?:|data:)/i.test(value)) throw new Error("Reference URL must start with http(s): or data:");
  const kind = elements.urlKind.value;
  if (kind === "video" && /^data:/i.test(value)) throw new Error("Reference videos require an HTTP(S) URL");
  if (kind === "image" && /^data:/i.test(value) && !/^data:image\/(?:jpeg|png|webp|bmp|tiff|gif);base64,/i.test(value)) {
    throw new Error("Reference image data URL is invalid or unsupported");
  }
  state.references.push({ kind, label: value, value, preview: kind === "image" && /^data:image\//i.test(value) ? value : null });
  elements.urlInput.value = "";
  renderReferences();
}

function renderReferences() {
  elements.mediaList.replaceChildren();
  if (state.references.length === 0) {
    const empty = document.createElement("div");
    empty.className = "media-empty";
    empty.textContent = "No reference media added";
    elements.mediaList.append(empty);
    return;
  }
  state.references.forEach((reference, index) => {
    const row = document.createElement("div");
    row.className = "media-item";
    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    if (reference.preview) {
      const image = document.createElement("img");
      image.src = reference.preview;
      image.alt = "";
      thumb.append(image);
    } else thumb.textContent = reference.kind === "image" ? "▧" : "▶";
    const info = document.createElement("div");
    info.className = "media-info";
    const kind = document.createElement("span");
    kind.className = "media-kind";
    kind.textContent = reference.kind;
    const name = document.createElement("span");
    name.className = "media-name";
    name.title = reference.label;
    name.textContent = reference.label;
    info.append(kind, name);
    const remove = document.createElement("button");
    remove.className = "remove-media";
    remove.type = "button";
    remove.dataset.index = String(index);
    remove.setAttribute("aria-label", `Remove ${reference.label}`);
    remove.textContent = "×";
    row.append(thumb, info, remove);
    elements.mediaList.append(row);
  });
}

function setResult(result) {
  state.result = result;
  elements.resultEmpty.hidden = true;
  elements.resultContent.hidden = false;
  elements.resultVideo.src = result.proxy_url;
  elements.resultUrl.value = result.video_url;
  elements.downloadButton.href = result.proxy_url;
  elements.taskId.textContent = result.task_id;
  elements.resultBadge.textContent = "READY";
  elements.resultBadge.className = "result-badge ready";
  elements.base64Status.textContent = "";
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || payload.message || `Request failed (${response.status})`);
  return payload;
}

function taskIdFrom(payload) {
  return payload?.id || payload?.task_id || payload?.data?.id || payload?.data?.task_id;
}

function statusFrom(payload) {
  return String(payload?.status || payload?.data?.status || "").toLowerCase();
}

function videoUrlFrom(payload) {
  const candidates = [payload?.metadata?.url, payload?.metadata?.video_url, payload?.result_url, payload?.video_url, payload?.url, payload?.output?.video_url, payload?.output?.url, payload?.data?.content?.video_url, payload?.data?.video_url, payload?.data?.url];
  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

async function pollDirect(baseUrl, key, taskId) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    const response = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, { headers: { Accept: "application/json", ...authHeaders(key) } });
    const payload = await responseJson(response);
    const status = statusFrom(payload);
    if (["completed", "succeeded", "success", "failed", "cancelled", "canceled"].includes(status)) return payload;
    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Video task timed out");
}

async function generateDirect(baseUrl, key, body) {
  const created = await responseJson(await fetch(`${baseUrl}/v1/videos`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders(key) },
    body: JSON.stringify(body),
  }));
  const taskId = taskIdFrom(created);
  if (!taskId) throw new Error("Gateway did not return a task id");
  const completed = await pollDirect(baseUrl, key, taskId);
  const status = statusFrom(completed);
  if (["failed", "cancelled", "canceled"].includes(status)) throw new Error(completed?.error?.message || completed?.message || "Video task failed");
  const videoUrl = videoUrlFrom(completed);
  if (!videoUrl) throw new Error("Gateway completed without a video URL");
  const absoluteVideoUrl = new URL(videoUrl, `${baseUrl}/`).toString();
  return { task_id: taskId, status, video_url: absoluteVideoUrl, proxy_url: absoluteVideoUrl, direct: true, base_url: baseUrl, api_key: key };
}

async function submitGeneration(event) {
  event.preventDefault();
  if (state.busy) return;
  const prompt = elements.prompt.value.trim();
  const apiKey = elements.apiKey.value.trim();
  const rawBaseUrl = elements.baseUrl.value.trim();
  if (!rawBaseUrl || !apiKey || !prompt) {
    setRequestStatus("Gateway URL, API key, and prompt are required.", "error");
    return;
  }
  let baseUrl;
  try { baseUrl = normalizeBaseUrl(rawBaseUrl); } catch (error) { setRequestStatus(error.message, "error"); return; }

  const content = [{ type: "text", text: prompt }];
  for (const reference of state.references) {
    content.push(reference.kind === "image"
      ? { type: "image_url", image_url: { url: reference.value }, role: "reference_image" }
      : { type: "video_url", video_url: { url: reference.value }, role: "reference_video" });
  }
  const body = {
    model: elements.model.value,
    content,
    duration: Number(elements.duration.value),
    ratio: elements.ratio.value,
    resolution: !elements.resolution.disabled && elements.resolution.value ? elements.resolution.value : undefined,
    generate_audio: elements.generateAudio.checked,
    watermark: elements.watermark.checked,
  };

  setBusy(true);
  setRequestStatus(state.proxyAvailable ? "Submitting render through local proxy..." : "Submitting render and waiting for completion...");
  try {
    const result = state.proxyAvailable
      ? await responseJson(await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, ...body }) }))
      : await generateDirect(baseUrl, apiKey, body);
    setResult(result);
    setRequestStatus("Render completed.", "success");
    showToast("Video is ready");
  } catch (error) {
    setRequestStatus(error.message, "error");
    elements.resultBadge.textContent = "ERROR";
    elements.resultBadge.className = "result-badge";
  } finally {
    setBusy(false);
  }
}

async function copyText(value, successMessage) {
  await navigator.clipboard.writeText(value);
  showToast(successMessage);
}

async function copyBase64() {
  if (!state.result?.proxy_url) return;
  elements.base64Status.textContent = "Preparing Base64...";
  elements.copyBase64Button.disabled = true;
  try {
    let headers = {};
    if (state.result.direct) {
      const videoUrl = new URL(state.result.proxy_url);
      const baseUrl = new URL(state.result.base_url);
      if (videoUrl.origin === baseUrl.origin && videoUrl.pathname.startsWith("/v1/videos/")) headers = authHeaders(state.result.api_key);
    }
    const response = await fetch(state.result.proxy_url, { headers });
    if (!response.ok) throw new Error("Unable to fetch rendered video");
    const blob = await response.blob();
    if (blob.size > MAX_BASE64_BYTES) throw new Error("Video exceeds the 128 MiB Base64 limit");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    await copyText(`data:${blob.type || "video/mp4"};base64,${btoa(binary)}`, "Base64 copied");
    elements.base64Status.textContent = "Base64 copied to clipboard.";
  } catch (error) {
    elements.base64Status.textContent = error.message;
  } finally {
    elements.copyBase64Button.disabled = false;
  }
}

elements.form.addEventListener("submit", submitGeneration);
elements.prompt.addEventListener("input", updatePromptCount);
$("#addImage").addEventListener("click", () => elements.imageFile.click());
$("#addVideoUrl").addEventListener("click", () => {
  elements.urlKind.value = "video";
  elements.urlInput.focus();
});
elements.imageFile.addEventListener("change", async (event) => { try { await addImages([...event.target.files]); } catch (error) { showToast(error.message); } event.target.value = ""; });
$("#addUrl").addEventListener("click", () => { try { addUrl(); } catch (error) { showToast(error.message); } });
elements.urlInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); try { addUrl(); } catch (error) { showToast(error.message); } } });
elements.mediaList.addEventListener("click", (event) => { const button = event.target.closest(".remove-media"); if (!button) return; state.references.splice(Number(button.dataset.index), 1); renderReferences(); });
$("#toggleKey").addEventListener("click", (event) => { const visible = elements.apiKey.type === "text"; elements.apiKey.type = visible ? "password" : "text"; event.currentTarget.textContent = visible ? "SHOW" : "HIDE"; event.currentTarget.setAttribute("aria-label", visible ? "Show API key" : "Hide API key"); });
elements.copyUrlButton.addEventListener("click", () => copyText(elements.resultUrl.value, "URL copied"));
elements.copyBase64Button.addEventListener("click", copyBase64);
elements.model.addEventListener("change", loadMetadata);
elements.baseUrl.addEventListener("change", () => { window.localStorage.setItem("doubao-seedance.url", elements.baseUrl.value.trim()); loadMetadata(); });
elements.apiKey.addEventListener("change", loadMetadata);

const savedUrl = window.localStorage.getItem("doubao-seedance.url");
if (savedUrl) elements.baseUrl.value = savedUrl;
applyMetadata(fallbackMetadata(elements.model.value));
updatePromptCount();
renderReferences();
void detectProxy();
void loadMetadata();

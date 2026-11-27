/**
 * Pure-Client, Zero-Dependency Canvas Portrait Matcher ("头像识别 / Avatar OCR") for Set 19 Collab.
 *
 * Works 100% offline using our bundled icons/units/*.webp + UNIT_FOCUS face anchors:
 *   1. Extracts compact multi-cue visual descriptors from 16x16 inner crops (ignoring cost borders):
 *      - Zero-mean L2-normalized 12x12 RGB spatial layout (brightness/contrast invariant)
 *      - 4x4x4 RGB color histogram (shift/zoom invariant)
 *      - 8x8 Sobel luminance gradient magnitudes (tint/dimming invariant)
 *   2. Automatically segments pasted screenshots (Ctrl+V / drop / upload):
 *      - Single square portrait
 *      - Horizontal strip of 2..6 portraits (gap-based + uniform fallback)
 *      - Full in-game trait tooltip containing text + a horizontal portrait row (chroma band isolation)
 *   3. Jointly matches all detected tiles against the 40 valid Collab groups via exact bitmask DP.
 */
import { scoreGroupsFromDetections } from "./collab-matcher.js";

const PATCH_SIZE = 16;
const GRID_SIZE = 12;
const GRAD_SIZE = 8;

function l2Normalize(arr) {
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) sumSq += arr[i] * arr[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] /= norm;
  return arr;
}

/**
 * Pure-JS image patch sampler: bilinear/area downsamples a sub-rectangle of an RGBA buffer
 * into a 16x16 RGBA array, trimming outer 12% border on each side to ignore TFT cost frames.
 */
export function sampleInnerPatch(rgba, width, height, rect, trimRatio = 0.12) {
  const rx = rect ? rect.x : 0;
  const ry = rect ? rect.y : 0;
  const rw = rect ? rect.w : width;
  const rh = rect ? rect.h : height;
  const padX = rw * trimRatio;
  const padY = rh * trimRatio;
  const sx0 = Math.max(0, rx + padX);
  const sy0 = Math.max(0, ry + padY);
  const sw = Math.max(1, rw - padX * 2);
  const sh = Math.max(1, rh - padY * 2);

  const out = new Uint8ClampedArray(PATCH_SIZE * PATCH_SIZE * 4);
  for (let py = 0; py < PATCH_SIZE; py++) {
    const y0 = Math.floor(sy0 + (py / PATCH_SIZE) * sh);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(sy0 + ((py + 1) / PATCH_SIZE) * sh)));
    for (let px = 0; px < PATCH_SIZE; px++) {
      const x0 = Math.floor(sx0 + (px / PATCH_SIZE) * sw);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(sx0 + ((px + 1) / PATCH_SIZE) * sw)));
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let y = y0; y < y1; y++) {
        let off = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++) {
          r += rgba[off];
          g += rgba[off + 1];
          b += rgba[off + 2];
          cnt++;
          off += 4;
        }
      }
      const d = (py * PATCH_SIZE + px) * 4;
      if (cnt > 0) {
        out[d] = Math.round(r / cnt);
        out[d + 1] = Math.round(g / cnt);
        out[d + 2] = Math.round(b / cnt);
        out[d + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * Computes multi-cue visual descriptor from a 16x16 RGBA patch (pure JS, Node & browser compatible).
 */
export function extractPatchDescriptor(patchRgba) {
  // 1. 12x12 center-aligned zero-mean L2-normalized RGB spatial grid
  const rgb = new Float32Array(GRID_SIZE * GRID_SIZE * 3);
  let meanR = 0, meanG = 0, meanB = 0;
  let k = 0;
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    const py = Math.min(PATCH_SIZE - 1, Math.floor(((gy + 0.5) * PATCH_SIZE) / GRID_SIZE));
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const px = Math.min(PATCH_SIZE - 1, Math.floor(((gx + 0.5) * PATCH_SIZE) / GRID_SIZE));
      const o = (py * PATCH_SIZE + px) * 4;
      const r = patchRgba[o] / 255;
      const g = patchRgba[o + 1] / 255;
      const b = patchRgba[o + 2] / 255;
      rgb[k++] = r;
      rgb[k++] = g;
      rgb[k++] = b;
      meanR += r;
      meanG += g;
      meanB += b;
    }
  }
  const nPix = GRID_SIZE * GRID_SIZE;
  meanR /= nPix; meanG /= nPix; meanB /= nPix;
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] -= meanR;
    rgb[i + 1] -= meanG;
    rgb[i + 2] -= meanB;
  }
  l2Normalize(rgb);

  // 2. 4x4x4 RGB color histogram (64 bins)
  const hist = new Float32Array(64);
  for (let i = 0; i < PATCH_SIZE * PATCH_SIZE; i++) {
    const o = i * 4;
    const rb = Math.min(3, patchRgba[o] >> 6);
    const gb = Math.min(3, patchRgba[o + 1] >> 6);
    const bb = Math.min(3, patchRgba[o + 2] >> 6);
    hist[(rb << 4) | (gb << 2) | bb] += 1;
  }
  l2Normalize(hist);

  // 3. 8x8 luminance Sobel gradient magnitudes (64 dims)
  const lum = new Float32Array(PATCH_SIZE * PATCH_SIZE);
  for (let i = 0; i < PATCH_SIZE * PATCH_SIZE; i++) {
    const o = i * 4;
    lum[i] = (0.299 * patchRgba[o] + 0.587 * patchRgba[o + 1] + 0.114 * patchRgba[o + 2]) / 255;
  }
  const grad = new Float32Array(GRAD_SIZE * GRAD_SIZE);
  for (let gy = 0; gy < GRAD_SIZE; gy++) {
    const y = Math.max(1, Math.min(PATCH_SIZE - 2, gy * 2 + 1));
    for (let gx = 0; gx < GRAD_SIZE; gx++) {
      const x = Math.max(1, Math.min(PATCH_SIZE - 2, gx * 2 + 1));
      const gxVal =
        -lum[(y - 1) * PATCH_SIZE + (x - 1)] + lum[(y - 1) * PATCH_SIZE + (x + 1)]
        - 2 * lum[y * PATCH_SIZE + (x - 1)] + 2 * lum[y * PATCH_SIZE + (x + 1)]
        - lum[(y + 1) * PATCH_SIZE + (x - 1)] + lum[(y + 1) * PATCH_SIZE + (x + 1)];
      const gyVal =
        -lum[(y - 1) * PATCH_SIZE + (x - 1)] - 2 * lum[(y - 1) * PATCH_SIZE + x] - lum[(y - 1) * PATCH_SIZE + (x + 1)]
        + lum[(y + 1) * PATCH_SIZE + (x - 1)] + 2 * lum[(y + 1) * PATCH_SIZE + x] + lum[(y + 1) * PATCH_SIZE + (x + 1)];
      grad[gy * GRAD_SIZE + gx] = Math.hypot(gxVal, gyVal);
    }
  }
  l2Normalize(grad);

  return { rgb, hist, grad };
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function compareDescriptors(a, b) {
  return 0.55 * dot(a.rgb, b.rgb) + 0.25 * dot(a.hist, b.hist) + 0.20 * dot(a.grad, b.grad);
}

/**
 * Pure-JS segmentation of a pasted screenshot RGBA buffer into 1..6 square portrait boxes.
 * Handles:
 *   - Single square icon
 *   - Horizontal strip of 2..6 icons (with or without dark gutters)
 *   - Full in-game trait tooltip (isolates the highest-chroma horizontal portrait band first)
 */
export function segmentScreenshotBoxes(rgba, width, height) {
  if (!rgba || width < 12 || height < 12) return [];
  const aspect = width / height;

  // Compute per-row chroma + non-dark energy to find the portrait band
  const rowScore = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let chromaSum = 0;
    let brightCnt = 0;
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = rowOff + x * 4;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      chromaSum += (mx - mn);
      if (mx > 46) brightCnt++;
    }
    rowScore[y] = (chromaSum / width) * (0.4 + 0.6 * (brightCnt / width));
  }

  let maxRow = 0;
  for (let y = 0; y < height; y++) if (rowScore[y] > maxRow) maxRow = rowScore[y];

  // Isolate contiguous vertical band with highest total chroma energy
  let bandY0 = 0;
  let bandY1 = height;
  if (maxRow > 6) {
    const thresh = Math.max(4, maxRow * 0.32);
    let bestEnergy = -1;
    let curStart = -1;
    let curEnergy = 0;
    for (let y = 0; y <= height; y++) {
      const active = y < height && rowScore[y] >= thresh;
      if (active) {
        if (curStart < 0) { curStart = y; curEnergy = 0; }
        curEnergy += rowScore[y];
      } else if (curStart >= 0) {
        const h = y - curStart;
        if (h >= Math.min(18, Math.floor(height * 0.25)) && curEnergy > bestEnergy) {
          bestEnergy = curEnergy;
          bandY0 = curStart;
          bandY1 = y;
        }
        curStart = -1;
      }
    }
  }

  const bandH = Math.max(12, bandY1 - bandY0);

  // Compute per-column chroma+brightness inside the vertical band
  const colScore = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = bandY0; y < bandY1; y++) {
      const o = (y * width + x) * 4;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      s += (mx - mn) * 0.7 + (mx > 42 ? mx * 0.3 : 0);
    }
    colScore[x] = s / bandH;
  }

  let maxCol = 0;
  for (let x = 0; x < width; x++) if (colScore[x] > maxCol) maxCol = colScore[x];

  // Trim outer dark left/right padding
  const colEdgeThresh = Math.max(5, maxCol * 0.18);
  let bandX0 = 0;
  let bandX1 = width;
  while (bandX0 < width - 1 && colScore[bandX0] < colEdgeThresh) bandX0++;
  while (bandX1 > bandX0 + 1 && colScore[bandX1 - 1] < colEdgeThresh) bandX1--;
  const bandW = Math.max(12, bandX1 - bandX0);
  const bandAspect = bandW / bandH;

  // Single square portrait case
  if (bandAspect <= 1.55 && aspect <= 1.65) {
    const side = Math.min(bandW, bandH);
    return [{
      x: Math.round(bandX0 + (bandW - side) / 2),
      y: Math.round(bandY0 + (bandH - side) / 2),
      w: side,
      h: side
    }];
  }

  // Try gutter-based horizontal segmentation inside [bandX0, bandX1)
  const gutterThresh = Math.max(5, maxCol * 0.24);
  const rawSegs = [];
  let segStart = -1;
  for (let x = bandX0; x <= bandX1; x++) {
    const on = x < bandX1 && colScore[x] >= gutterThresh;
    if (on && segStart < 0) segStart = x;
    else if (!on && segStart >= 0) {
      const w = x - segStart;
      if (w >= bandH * 0.45) rawSegs.push({ x: segStart, y: bandY0, w, h: bandH });
      segStart = -1;
    }
  }

  // Split any wide merged segment (e.g. two icons touching without a dark gap)
  const refined = [];
  for (const seg of rawSegs) {
    const ratio = seg.w / seg.h;
    if (ratio >= 1.72) {
      const count = Math.max(2, Math.min(6, Math.round(ratio)));
      const step = seg.w / count;
      for (let i = 0; i < count; i++) {
        refined.push({
          x: Math.round(seg.x + i * step),
          y: seg.y,
          w: Math.round(step),
          h: seg.h
        });
      }
    } else {
      refined.push(seg);
    }
  }

  if (refined.length >= 2 && refined.length <= 6) {
    return refined;
  }

  // Fallback: clean uniform split estimated from band aspect ratio (clamped to 2..6)
  const estCount = Math.max(2, Math.min(6, Math.round(bandAspect / 1.08)));
  const tileW = bandW / estCount;
  const boxes = [];
  for (let i = 0; i < estCount; i++) {
    boxes.push({
      x: Math.round(bandX0 + i * tileW),
      y: bandY0,
      w: Math.round(tileW),
      h: bandH
    });
  }
  return boxes;
}

/**
 * Matches an array of query descriptors against a reference descriptor map:
 *   refMap: Map<unitId, Array<Descriptor>>
 * Returns per-tile score maps + top-1/top-3 unit predictions.
 */
export function matchDescriptorsToUnits(queryDescriptors, refMap) {
  const tileScores = [];
  const tileTop = [];
  for (let t = 0; t < queryDescriptors.length; t++) {
    const q = queryDescriptors[t];
    const scoreMap = new Map();
    const ranked = [];
    for (const [uid, refs] of refMap.entries()) {
      let best = -1;
      for (let r = 0; r < refs.length; r++) {
        const s = compareDescriptors(q, refs[r]);
        if (s > best) best = s;
      }
      scoreMap.set(uid, best);
      ranked.push({ id: uid, score: best });
    }
    ranked.sort((a, b) => b.score - a.score);
    tileScores.push(scoreMap);
    tileTop.push({
      best: ranked[0] || null,
      top3: ranked.slice(0, 3)
    });
  }
  return { tileScores, tileTop };
}

// Browser-only lazy reference cache keyed by pool signature
let cachedRefKey = "";
let cachedRefMap = null;
let cachedRefPromise = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load " + src));
    img.src = src;
  });
}

function buildReferenceCropsFromImage(img, focusPct) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return [];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  const pct = typeof focusPct === "number" ? Math.max(0, Math.min(100, focusPct)) : 50;
  const side = Math.min(w, h);
  const maxLeft = Math.max(0, w - side);
  const focusX = Math.round((pct / 100) * maxLeft);

  const crops = [];
  // Crop 1: face-focused full-height square (matches standard TFT UI framing)
  crops.push(extractPatchDescriptor(sampleInnerPatch(rgba, w, h, { x: focusX, y: 0, w: side, h: side }, 0.08)));

  // Crop 2: tighter zoomed face crop (matches in-game square tooltip icons)
  const zoomSide = Math.round(side * 0.82);
  const zoomX = Math.max(0, Math.min(w - zoomSide, Math.round(focusX + (side - zoomSide) * 0.5)));
  const zoomY = Math.max(0, Math.round((h - zoomSide) * 0.25));
  crops.push(extractPatchDescriptor(sampleInnerPatch(rgba, w, h, { x: zoomX, y: zoomY, w: zoomSide, h: zoomSide }, 0.06)));

  // Crop 3: center square fallback when focus differs significantly from center
  const centerX = Math.round(maxLeft / 2);
  if (Math.abs(centerX - focusX) > side * 0.14) {
    crops.push(extractPatchDescriptor(sampleInnerPatch(rgba, w, h, { x: centerX, y: 0, w: side, h: side }, 0.08)));
  }
  return crops;
}

export async function ensureReferenceDescriptors(poolIds, store) {
  const key = poolIds.join(",");
  if (cachedRefMap && cachedRefKey === key) return cachedRefMap;
  if (cachedRefPromise && cachedRefKey === key) return cachedRefPromise;

  cachedRefKey = key;
  cachedRefPromise = (async () => {
    const game = store.getGame();
    const map = new Map();
    const tasks = poolIds.map(async (uid) => {
      const u = game && game.byId && game.byId[uid];
      if (!u) return;
      const srcs = store.srcList(u);
      for (const src of srcs) {
        try {
          const img = await loadImage(src);
          const focus = store.focusPos(uid);
          const descs = buildReferenceCropsFromImage(img, focus);
          if (descs.length) {
            map.set(uid, descs);
            return;
          }
        } catch {
          /* try next fallback src */
        }
      }
    });
    await Promise.all(tasks);
    cachedRefMap = map;
    cachedRefPromise = null;
    return map;
  })();

  return cachedRefPromise;
}

/**
 * Full browser pipeline: takes a pasted/uploaded Image Blob/File or HTMLImageElement,
 * segments portrait tiles, matches against all 55 Collab pool units, and ranks all 40 Collab groups.
 */
export async function recognizeCollabScreenshot(blobOrImage, groups, poolIds, store) {
  const refMap = await ensureReferenceDescriptors(poolIds, store);
  if (!refMap.size) {
    return { error: "参考头像加载失败，请手动勾选棋子", tiles: [], rankedGroups: [], suggestedIds: [] };
  }

  let img;
  let objectUrl = "";
  try {
    if (blobOrImage instanceof HTMLImageElement) {
      img = blobOrImage;
    } else {
      objectUrl = URL.createObjectURL(blobOrImage);
      img = await loadImage(objectUrl);
    }
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return { error: "无法读取截图图片，请重新截图后 Ctrl+V 粘贴", tiles: [], rankedGroups: [], suggestedIds: [] };
  }

  try {
    // Limit huge full-screen captures safely while keeping icon resolution crisp
    const maxDim = 960;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.max(16, Math.round(w * scale));
      h = Math.max(16, Math.round(h * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);

    const boxes = segmentScreenshotBoxes(imgData.data, w, h);
    if (!boxes.length) {
      return { error: "未在截图中检测到棋子头像，请尽量只截取合奏头像条", tiles: [], rankedGroups: [], suggestedIds: [] };
    }

    const queryDescs = [];
    const thumbs = [];
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 40;
    thumbCanvas.height = 40;
    const tCtx = thumbCanvas.getContext("2d");

    for (const box of boxes) {
      const patch = sampleInnerPatch(imgData.data, w, h, box, 0.12);
      queryDescs.push(extractPatchDescriptor(patch));
      tCtx.clearRect(0, 0, 40, 40);
      tCtx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, 40, 40);
      thumbs.push(thumbCanvas.toDataURL("image/png"));
    }

    const { tileScores, tileTop } = matchDescriptorsToUnits(queryDescs, refMap);
    const rankedGroups = scoreGroupsFromDetections(groups, tileScores);

    // When >= 3 tiles detected and top group has clear lead, assign per-tile units from top group;
    // otherwise pick confident individual top-1 unit predictions
    const topG = rankedGroups[0];
    const secondG = rankedGroups[1];
    const strongGroupLock = boxes.length >= 3 && topG && topG.meanSim >= 0.34 && (!secondG || topG.totalScore - secondG.totalScore >= 0.02);

    const tiles = boxes.map((box, idx) => {
      const groupPair = strongGroupLock ? topG.pairs.find((p) => p.tileIndex === idx) : null;
      const bestUnit = groupPair
        ? { id: groupPair.unitId, score: groupPair.score }
        : tileTop[idx].best;
      return {
        index: idx,
        box,
        thumbUrl: thumbs[idx],
        unitId: bestUnit ? bestUnit.id : null,
        confidence: bestUnit ? Math.max(0, Math.min(99, Math.round(((bestUnit.score + 0.15) / 1.15) * 100))) : 0,
        top3: tileTop[idx].top3
      };
    });

    const suggestedIds = [];
    if (strongGroupLock) {
      // Pre-select the top 3 highest-confidence units from the locked group so exact filter locks cleanly while remaining editable
      tiles
        .filter((t) => t.unitId)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, Math.min(3, tiles.length))
        .forEach((t) => { if (!suggestedIds.includes(t.unitId)) suggestedIds.push(t.unitId); });
    } else {
      tiles
        .filter((t) => t.unitId && t.confidence >= 45)
        .forEach((t) => { if (!suggestedIds.includes(t.unitId)) suggestedIds.push(t.unitId); });
    }

    return {
      error: null,
      strongGroupLock,
      tiles,
      rankedGroups: rankedGroups.slice(0, 6),
      suggestedIds
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

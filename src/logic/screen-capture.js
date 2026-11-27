/**
 * Zero-dependency browser screen capture + drag-to-crop helper.
 * Uses W3C getDisplayMedia() to grab a single still frame (stopping the stream immediately),
 * then lets the user drag a selection rectangle over the Collab portraits right inside the modal.
 */

export function isScreenCaptureSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
  );
}

/**
 * Grabs one still frame via browser screen/window picker, stops the stream immediately,
 * and opens a lightweight full-modal drag-to-crop overlay.
 * Resolves to a cropped PNG Blob, or null if cancelled.
 */
export async function captureAndCropRegion(hostEl) {
  if (!isScreenCaptureSupported()) {
    throw new Error("当前浏览器环境不支持网页截屏（需 HTTPS 或本地服务），请截图后直接粘贴");
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never" },
      audio: false
    });
  } catch (err) {
    // User clicked Cancel in the browser picker -> treat as silent cancel
    if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) {
      return null;
    }
    throw new Error("未能获取屏幕画面，请改用截图后粘贴");
  }

  const frameCanvas = document.createElement("canvas");
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("画面捕获超时")), 5000);
      video.onloadedmetadata = () => {
        video.play().then(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        }).catch((e) => { clearTimeout(timer); reject(e); });
      };
      video.onerror = () => { clearTimeout(timer); reject(new Error("视频帧读取失败")); };
    });

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error("捕获到的画面为空");
    frameCanvas.width = vw;
    frameCanvas.height = vh;
    frameCanvas.getContext("2d").drawImage(video, 0, 0, vw, vh);
  } finally {
    // Stop screen sharing immediately after grabbing the single frame
    stream.getTracks().forEach((t) => {
      try { t.stop(); } catch { /* ignore */ }
    });
  }

  return await openCropOverlay(hostEl || document.body, frameCanvas);
}

function openCropOverlay(hostEl, sourceCanvas) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "cl-crop-overlay";
    overlay.innerHTML =
      `<div class="cl-crop-bar">` +
      `<span>拖拽框选合奏头像区域，松手立即识别</span>` +
      `<button type="button" class="btn xs" data-crop-cancel="1">取消 (Esc)</button>` +
      `</div>` +
      `<div class="cl-crop-stage">` +
      `<canvas class="cl-crop-canvas"></canvas>` +
      `<div class="cl-crop-box" hidden></div>` +
      `</div>`;

    hostEl.appendChild(overlay);
    const stage = overlay.querySelector(".cl-crop-stage");
    const displayCanvas = overlay.querySelector(".cl-crop-canvas");
    const boxEl = overlay.querySelector(".cl-crop-box");
    const cancelBtn = overlay.querySelector("[data-crop-cancel]");

    displayCanvas.width = sourceCanvas.width;
    displayCanvas.height = sourceCanvas.height;
    displayCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0);

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let curX = 0;
    let curY = 0;
    let rectCache = null;

    function cleanup(result) {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup(null);
      }
    }
    window.addEventListener("keydown", onKey, true);
    cancelBtn.addEventListener("click", () => cleanup(null));

    function updateBox() {
      if (!rectCache) return;
      const x0 = Math.min(startX, curX);
      const y0 = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      boxEl.hidden = w < 4 || h < 4;
      boxEl.style.left = `${x0}px`;
      boxEl.style.top = `${y0}px`;
      boxEl.style.width = `${w}px`;
      boxEl.style.height = `${h}px`;
    }

    function clampToCanvas(clientX, clientY) {
      const r = displayCanvas.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      const x = Math.max(r.left, Math.min(r.right, clientX)) - s.left;
      const y = Math.max(r.top, Math.min(r.bottom, clientY)) - s.top;
      return { x, y, canvasRect: r, stageRect: s };
    }

    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const p = clampToCanvas(e.clientX, e.clientY);
      dragging = true;
      rectCache = p;
      startX = curX = p.x;
      startY = curY = p.y;
      stage.setPointerCapture(e.pointerId);
      updateBox();
    });

    stage.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const p = clampToCanvas(e.clientX, e.clientY);
      curX = p.x;
      curY = p.y;
      updateBox();
    });

    stage.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      const p = clampToCanvas(e.clientX, e.clientY);
      curX = p.x;
      curY = p.y;
      const r = p.canvasRect;
      const s = p.stageRect;
      const leftInCanvas = Math.min(startX, curX) - (r.left - s.left);
      const topInCanvas = Math.min(startY, curY) - (r.top - s.top);
      const selW = Math.abs(curX - startX);
      const selH = Math.abs(curY - startY);
      if (selW < 18 || selH < 18 || !r.width || !r.height) {
        boxEl.hidden = true;
        return;
      }

      const scaleX = sourceCanvas.width / r.width;
      const scaleY = sourceCanvas.height / r.height;
      const sx = Math.max(0, Math.round(leftInCanvas * scaleX));
      const sy = Math.max(0, Math.round(topInCanvas * scaleY));
      const sw = Math.min(sourceCanvas.width - sx, Math.max(16, Math.round(selW * scaleX)));
      const sh = Math.min(sourceCanvas.height - sy, Math.max(16, Math.round(selH * scaleY)));

      const out = document.createElement("canvas");
      out.width = sw;
      out.height = sh;
      out.getContext("2d").drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      out.toBlob((blob) => cleanup(blob || null), "image/png");
    });
  });
}

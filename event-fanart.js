import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const fanartContent = document.getElementById("fanartContent");

const params = new URLSearchParams(location.search);
const eventId = params.get("event");
const characterId = params.get("character");

let currentUser = null;
let currentEvent = null;
let currentCharacter = null;
let currentEntry = null;
let currentClaim = null;

let canvas = null;
let ctx = null;

let penColor = null;
let penSize = null;
let penOpacity = null;
let eraserSize = null;

let clearBtn = null;
let undoBtn = null;
let saveFanartBtn = null;
let cancelClaimBtn = null;

let penModeBtn = null;
let eraserModeBtn = null;
let eyedropperModeBtn = null;
let fillModeBtn = null;

let fanartMessage = null;
let opacityValue = null;

let layerBtn0 = null;
let layerBtn1 = null;
let toggleLayerBtn = null;
let clearLayerBtn = null;
let layerStatusText = null;
let pressureToggle = null;

let drawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawn = false;

let history = [];
let currentTool = "pen";

let activeLayerIndex = 0;
let layerCanvases = [];
let layerContexts = [];
let layerVisible = [true, true];

const CANVAS_SIZE = 768;
const FANART_LIMIT = 3;
const MAX_HISTORY = 30;
const LAYER_COUNT = 2;

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

function getClaimId() {
  return `${eventId}_${characterId}_${currentUser.uid}`;
}

function getFanartId() {
  return `${eventId}_${characterId}_${currentUser.uid}`;
}

function getEntryId() {
  return `${eventId}_${currentCharacter.data.userId}`;
}

function createLayerCanvas() {
  const layerCanvas = document.createElement("canvas");

  layerCanvas.width = canvas.width;
  layerCanvas.height = canvas.height;

  const layerCtx = layerCanvas.getContext("2d", {
    willReadFrequently: true
  });

  return {
    canvas: layerCanvas,
    ctx: layerCtx
  };
}

function initLayers() {
  layerCanvases = [];
  layerContexts = [];
  layerVisible = [true, true];
  activeLayerIndex = 0;

  for (let i = 0; i < LAYER_COUNT; i++) {
    const layer = createLayerCanvas();

    layerCanvases.push(layer.canvas);
    layerContexts.push(layer.ctx);
  }
}

function getActiveLayerCtx() {
  return layerContexts[activeLayerIndex] || null;
}

function redrawCanvas() {
  if (!ctx || !canvas) return;

  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layerCanvases.forEach((layerCanvas, index) => {
    if (!layerVisible[index]) return;

    ctx.drawImage(layerCanvas, 0, 0);
  });
}

function getLayerSnapshot() {
  return {
    layers: layerCanvases.map((layerCanvas) => {
      return layerCanvas.toDataURL("image/png");
    }),
    visible: [...layerVisible],
    active: activeLayerIndex
  };
}

function saveHistory() {
  history.push(getLayerSnapshot());

  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function restoreLayerSnapshot(snapshot) {
  if (!snapshot) return;

  const layerImages = snapshot.layers || [];
  let loadedCount = 0;

  layerVisible = Array.isArray(snapshot.visible)
    ? [...snapshot.visible]
    : [true, true];

  activeLayerIndex = typeof snapshot.active === "number"
    ? snapshot.active
    : 0;

  if (!layerImages.length) {
    redrawCanvas();
    updateLayerUi();
    return;
  }

  layerCanvases.forEach((layerCanvas, index) => {
    const layerCtx = layerContexts[index];

    layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);

    const dataUrl = layerImages[index];

    if (!dataUrl) {
      loadedCount++;

      if (loadedCount >= layerImages.length) {
        redrawCanvas();
        updateLayerUi();
      }

      return;
    }

    const img = new Image();

    img.onload = () => {
      layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
      layerCtx.drawImage(img, 0, 0, layerCanvas.width, layerCanvas.height);

      loadedCount++;

      if (loadedCount >= layerImages.length) {
        redrawCanvas();
        updateLayerUi();
      }
    };

    img.src = dataUrl;
  });
}

function initCanvas() {
  initLayers();
  redrawCanvas();

  drawing = false;
  hasDrawn = false;
  history = [];

  saveHistory();
  updateLayerUi();
}

function getPressure(e) {
  if (!pressureToggle?.checked) return 1;

  if (e.pointerType && e.pointerType !== "pen") {
    return 0;
  }

  if (typeof e.pressure === "number" && e.pressure > 0) {
    return Math.max(0.25, Math.min(1.8, e.pressure * 1.6));
  }

  return 1;
}

function shouldIgnoreCanvasInput(e) {
  if (!pressureToggle?.checked) return false;
  if (!e.pointerType) return false;

  return e.pointerType !== "pen";
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const source = e.touches ? e.touches[0] : e;

  return {
    x: ((source.clientX - rect.left) / rect.width) * canvas.width,
    y: ((source.clientY - rect.top) / rect.height) * canvas.height,
    pressure: getPressure(e)
  };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  );
}

function pickColor(e) {
  e.preventDefault();

  redrawCanvas();

  const point = getPoint(e);

  const pixel = ctx.getImageData(
    Math.floor(point.x),
    Math.floor(point.y),
    1,
    1
  ).data;

  const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

  if (penColor) {
    penColor.value = hex;
  }

  if (fanartMessage) {
    fanartMessage.textContent = `色を拾いました：${hex}`;
  }

  setTool("pen");
}

function setTool(tool) {
  currentTool = tool;

  if (penModeBtn) {
    penModeBtn.classList.toggle("tool-active", tool === "pen");
  }

  if (eraserModeBtn) {
    eraserModeBtn.classList.toggle("tool-active", tool === "eraser");
  }

  if (eyedropperModeBtn) {
    eyedropperModeBtn.classList.toggle("tool-active", tool === "eyedropper");
  }

  if (fillModeBtn) {
    fillModeBtn.classList.toggle("tool-active", tool === "fill");
  }

  if (!fanartMessage) return;

  if (tool === "pen") {
    fanartMessage.textContent = "ペンで描けます。";
  }

  if (tool === "eraser") {
    fanartMessage.textContent = "消しゴムで消せます。";
  }

  if (tool === "eyedropper") {
    fanartMessage.textContent = "キャンバスから色を拾えます。拾いたい場所をタップしてください。";
  }

  if (tool === "fill") {
    fanartMessage.textContent = "塗りつぶしたい場所をタップしてください。";
  }
}

function updateLayerUi() {
  if (layerBtn0) {
    layerBtn0.classList.toggle("is-active", activeLayerIndex === 0);
    layerBtn0.classList.toggle("is-hidden-layer", layerVisible[0] === false);
  }

  if (layerBtn1) {
    layerBtn1.classList.toggle("is-active", activeLayerIndex === 1);
    layerBtn1.classList.toggle("is-hidden-layer", layerVisible[1] === false);
  }

  if (layerStatusText) {
    const layerName = activeLayerIndex === 0
      ? "レイヤー1（下）"
      : "レイヤー2（上）";

    const visibleText = layerVisible[activeLayerIndex]
      ? "表示中"
      : "非表示";

    layerStatusText.textContent = `現在：${layerName} / ${visibleText}`;
  }
}

function startDraw(e) {
  if (shouldIgnoreCanvasInput(e)) {
    drawing = false;

    if (fanartMessage) {
      fanartMessage.textContent = "筆圧ON中は、キャンバスではペン入力のみ描画できます。";
    }

    return;
  }

  e.preventDefault();

  const point = getPoint(e);

  if (currentTool === "eyedropper") {
    pickColor(e);
    return;
  }

  if (!layerVisible[activeLayerIndex]) {
    if (fanartMessage) {
      fanartMessage.textContent = "非表示中のレイヤーには描けません。";
    }

    return;
  }

  if (currentTool === "fill") {
    fillActiveLayer(point.x, point.y);
    return;
  }

  drawing = true;
  lastX = point.x;
  lastY = point.y;

  saveHistory();

  if (canvas.setPointerCapture && e.pointerId !== undefined) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (error) {
      console.error(error);
    }
  }
}

function draw(e) {
  if (!drawing) return;

  if (shouldIgnoreCanvasInput(e)) {
    drawing = false;
    return;
  }

  e.preventDefault();

  const point = getPoint(e);
  const targetCtx = getActiveLayerCtx();

  if (!targetCtx) return;

  const pressure = point.pressure;

  if (pressure <= 0) {
    return;
  }

  targetCtx.save();

  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";

  if (currentTool === "eraser") {
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = "destination-out";
    targetCtx.strokeStyle = "rgba(0, 0, 0, 1)";
    targetCtx.lineWidth = Math.max(1, Number(eraserSize?.value || 24) * pressure);
  } else {
    const opacity = Number(penOpacity?.value || 100) / 100;

    targetCtx.globalAlpha = opacity;
    targetCtx.globalCompositeOperation = "source-over";
    targetCtx.strokeStyle = penColor?.value || "#3c342e";
    targetCtx.lineWidth = Math.max(1, Number(penSize?.value || 6) * pressure);
  }

  targetCtx.beginPath();
  targetCtx.moveTo(lastX, lastY);
  targetCtx.lineTo(point.x, point.y);
  targetCtx.stroke();

  targetCtx.restore();

  lastX = point.x;
  lastY = point.y;
  hasDrawn = true;

  redrawCanvas();
}

function hexToRgba(hex) {
  const cleanHex = hex.replace("#", "");

  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);

  return [r, g, b, 255];
}

function colorsClose(data, index, targetColor, tolerance = 24) {
  return Math.abs(data[index] - targetColor[0]) <= tolerance
    && Math.abs(data[index + 1] - targetColor[1]) <= tolerance
    && Math.abs(data[index + 2] - targetColor[2]) <= tolerance
    && Math.abs(data[index + 3] - targetColor[3]) <= tolerance;
}

function fillActiveLayer(startX, startY) {
  const targetCtx = getActiveLayerCtx();

  if (!targetCtx || !canvas || !ctx) return;

  if (!layerVisible[activeLayerIndex]) {
    if (fanartMessage) {
      fanartMessage.textContent = "非表示中のレイヤーには塗りつぶしできません。";
    }

    return;
  }

  saveHistory();

  redrawCanvas();

  const width = canvas.width;
  const height = canvas.height;

  const x = Math.floor(startX);
  const y = Math.floor(startY);

  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const baseImage = ctx.getImageData(0, 0, width, height);
  const baseData = baseImage.data;

  const layerImage = targetCtx.getImageData(0, 0, width, height);
  const layerData = layerImage.data;

  const fillColor = hexToRgba(penColor?.value || "#3c342e");

  const startIndex = (y * width + x) * 4;
  const targetColor = [
    baseData[startIndex],
    baseData[startIndex + 1],
    baseData[startIndex + 2],
    baseData[startIndex + 3]
  ];

  if (
    Math.abs(targetColor[0] - fillColor[0]) < 3
    && Math.abs(targetColor[1] - fillColor[1]) < 3
    && Math.abs(targetColor[2] - fillColor[2]) < 3
  ) {
    return;
  }

  const stack = [[x, y]];
  const visited = new Uint8Array(width * height);

  while (stack.length > 0) {
    const [currentX, currentY] = stack.pop();

    if (
      currentX < 0 ||
      currentY < 0 ||
      currentX >= width ||
      currentY >= height
    ) {
      continue;
    }

    const pixelIndex = currentY * width + currentX;

    if (visited[pixelIndex]) continue;

    visited[pixelIndex] = 1;

    const dataIndex = pixelIndex * 4;

    if (!colorsClose(baseData, dataIndex, targetColor)) {
      continue;
    }

    layerData[dataIndex] = fillColor[0];
    layerData[dataIndex + 1] = fillColor[1];
    layerData[dataIndex + 2] = fillColor[2];
    layerData[dataIndex + 3] = fillColor[3];

    stack.push([currentX + 1, currentY]);
    stack.push([currentX - 1, currentY]);
    stack.push([currentX, currentY + 1]);
    stack.push([currentX, currentY - 1]);
  }

  targetCtx.putImageData(layerImage, 0, 0);

  hasDrawn = true;

  redrawCanvas();

  if (fanartMessage) {
    fanartMessage.textContent = "塗りつぶしました。";
  }
}

function stopDraw(e) {
  if (!drawing) return;

  drawing = false;
  redrawCanvas();

  if (canvas?.releasePointerCapture && e?.pointerId !== undefined) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (error) {
      console.error(error);
    }
  }
}

function getCanvasImageData() {
  redrawCanvas();

  return canvas.toDataURL("image/png");
}

function setupCanvasEvents() {
  if (window.PointerEvent) {
    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", stopDraw);
    canvas.addEventListener("pointercancel", stopDraw);
    canvas.addEventListener("pointerleave", stopDraw);
    return;
  }

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDraw);
  canvas.addEventListener("mouseleave", stopDraw);

  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDraw);
  canvas.addEventListener("touchcancel", stopDraw);
}

function setupLayerEvents() {
  if (layerBtn0) {
    layerBtn0.addEventListener("click", () => {
      activeLayerIndex = 0;
      updateLayerUi();
    });
  }

  if (layerBtn1) {
    layerBtn1.addEventListener("click", () => {
      activeLayerIndex = 1;
      updateLayerUi();
    });
  }

  if (toggleLayerBtn) {
    toggleLayerBtn.addEventListener("click", () => {
      layerVisible[activeLayerIndex] = !layerVisible[activeLayerIndex];

      redrawCanvas();
      updateLayerUi();

      if (fanartMessage) {
        fanartMessage.textContent = layerVisible[activeLayerIndex]
          ? "選択中のレイヤーを表示しました。"
          : "選択中のレイヤーを非表示にしました。";
      }
    });
  }

  if (clearLayerBtn) {
    clearLayerBtn.addEventListener("click", () => {
      const layerName = activeLayerIndex === 0
        ? "レイヤー1"
        : "レイヤー2";

      if (!confirm(`${layerName}を消しますか？`)) return;

      const targetCtx = getActiveLayerCtx();

      if (!targetCtx) return;

      saveHistory();

      targetCtx.clearRect(0, 0, canvas.width, canvas.height);
      redrawCanvas();

      hasDrawn = true;

      if (fanartMessage) {
        fanartMessage.textContent = `${layerName}を消しました。`;
      }
    });
  }
}

function setupToolEvents() {
  if (penModeBtn) {
    penModeBtn.addEventListener("click", () => {
      setTool("pen");
    });
  }

  if (eraserModeBtn) {
    eraserModeBtn.addEventListener("click", () => {
      setTool("eraser");
    });
  }

  if (eyedropperModeBtn) {
    eyedropperModeBtn.addEventListener("click", () => {
      setTool("eyedropper");
    });
  }

  if (fillModeBtn) {
    fillModeBtn.addEventListener("click", () => {
      setTool("fill");
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!confirm("キャンバスをまっさらにしますか？")) return;

      initCanvas();
      hasDrawn = false;

      if (fanartMessage) {
        fanartMessage.textContent = "キャンバスをまっさらにしました。";
      }
    });
  }

  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      if (history.length <= 1) {
        if (fanartMessage) {
          fanartMessage.textContent = "これ以上戻れません。";
        }

        return;
      }

      history.pop();

      const previous = history[history.length - 1];

      restoreLayerSnapshot(previous);
      hasDrawn = true;

      if (fanartMessage) {
        fanartMessage.textContent = "1つ戻しました。";
      }
    });
  }

  if (opacityValue && penOpacity) {
    opacityValue.textContent = `${penOpacity.value}%`;

    penOpacity.addEventListener("input", () => {
      opacityValue.textContent = `${penOpacity.value}%`;
    });
  }
}

function setupCanvas() {
  canvas = document.getElementById("fanartCanvas");

  if (!canvas) return;

  ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  penColor = document.getElementById("penColor");
  penSize = document.getElementById("penSize");
  penOpacity = document.getElementById("penOpacity");
  eraserSize = document.getElementById("eraserSize");

  clearBtn = document.getElementById("clearBtn");
  undoBtn = document.getElementById("undoBtn");
  saveFanartBtn = document.getElementById("saveFanartBtn");
  cancelClaimBtn = document.getElementById("cancelClaimBtn");

  penModeBtn = document.getElementById("penModeBtn");
  eraserModeBtn = document.getElementById("eraserModeBtn");
  eyedropperModeBtn = document.getElementById("eyedropperModeBtn");
  fillModeBtn = document.getElementById("fillModeBtn");

  fanartMessage = document.getElementById("fanartMessage");
  opacityValue = document.getElementById("opacityValue");

  layerBtn0 = document.getElementById("layerBtn0");
  layerBtn1 = document.getElementById("layerBtn1");
  toggleLayerBtn = document.getElementById("toggleLayerBtn");
  clearLayerBtn = document.getElementById("clearLayerBtn");
  layerStatusText = document.getElementById("layerStatusText");
  pressureToggle = document.getElementById("pressureToggle");

  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  initCanvas();

  setupCanvasEvents();
  setupLayerEvents();
  setupToolEvents();

  setTool("pen");
}










async function getEvent() {
  const eventRef = doc(db, "v2Events", eventId);
  const snap = await getDoc(eventRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getCharacter() {
  const characterRef = doc(db, "v2Characters", characterId);
  const snap = await getDoc(characterRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getEventEntryForCharacter() {
  const q = query(
    collection(db, "v2EventEntries"),
    where("eventId", "==", eventId),
    where("characterId", "==", characterId),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  let result = null;

  snap.forEach((docSnap) => {
    result = {
      id: docSnap.id,
      data: docSnap.data()
    };
  });

  return result;
}

async function getMyClaims() {
  if (!currentUser) return [];

  const q = query(
    collection(db, "v2EventFanartClaims"),
    where("eventId", "==", eventId),
    where("userId", "==", currentUser.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  const claims = [];

  snap.forEach((docSnap) => {
    claims.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  return claims;
}

async function getExistingClaim() {
  if (!currentUser) return null;

  const q = query(
    collection(db, "v2EventFanartClaims"),
    where("eventId", "==", eventId),
    where("targetCharacterId", "==", characterId),
    where("userId", "==", currentUser.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  let result = null;

  snap.forEach((docSnap) => {
    result = {
      id: docSnap.id,
      data: docSnap.data()
    };
  });

  return result;
}

async function getExistingFanartForCharacter() {
  if (!currentUser) return null;

  const q = query(
    collection(db, "v2EventFanarts"),
    where("eventId", "==", eventId),
    where("targetCharacterId", "==", characterId),
    where("userId", "==", currentUser.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  let result = null;

  snap.forEach((docSnap) => {
    result = {
      id: docSnap.id,
      data: docSnap.data()
    };
  });

  return result;
}

async function ensureClaim(myClaims) {
  const existingFanart = await getExistingFanartForCharacter();

  if (existingFanart) {
    renderError(
      "すでに投稿済みです",
      "このキャラへのファンアートはすでに保存されています。"
    );
    return false;
  }

  const existingClaim = await getExistingClaim();

  if (existingClaim && existingClaim.data.isDeleted !== true) {
    currentClaim = existingClaim;
    return true;
  }

  const activeClaims = myClaims.filter((claim) => {
    return claim.data.isDeleted !== true;
  });

  if (activeClaims.length >= FANART_LIMIT) {
    renderError(
      "上限に達しています",
      `このイベントで描けるファンアートは${FANART_LIMIT}キャラまでです。`
    );
    return false;
  }

  const claimId = getClaimId();
  const entryId = getEntryId();

  try {
    await setDoc(doc(db, "v2EventFanartClaims", claimId), {
      eventId,
      targetCharacterId: characterId,
      targetCharacterOwnerId: currentCharacter.data.userId || "",
      userId: currentUser.uid,
      status: "drawing",
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("claim作成で失敗", error);

    renderError(
      "描く宣言の作成に失敗しました",
      error.message
    );

    return false;
  }

  try {
    await updateDoc(doc(db, "v2EventEntries", entryId), {
      progressCount: increment(1),
      fanartCount: currentEntry.data.fanartCount || 0,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("参加データ更新で失敗", error);

    await updateDoc(doc(db, "v2EventFanartClaims", claimId), {
      status: "cancelled",
      isDeleted: true,
      updatedAt: serverTimestamp()
    }).catch(() => {});

    renderError(
      "参加データの更新に失敗しました",
      error.message
    );

    return false;
  }

  currentClaim = {
    id: claimId,
    data: {
      eventId,
      targetCharacterId: characterId,
      targetCharacterOwnerId: currentCharacter.data.userId || "",
      userId: currentUser.uid,
      status: "drawing",
      isDeleted: false
    }
  };

  return true;
}

function renderError(title, text) {
  fanartContent.innerHTML = `
    <section class="panel">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(text)}</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/file/?id=${encodeURIComponent(eventId || "")}">
          イベントへ戻る
        </a>
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderFanartPage(myClaims) {
  const eventData = currentEvent.data;
  const charData = currentCharacter.data;

  const activeClaimCount = myClaims.filter((claim) => {
    return claim.data.isDeleted !== true;
  }).length;

  fanartContent.innerHTML = `
    <section class="fanart-layout">
      <div class="panel fanart-draw-panel">
        <div class="fanart-draw-head">
          <div>
            <p class="eyebrow">Draw Fan Art</p>
            <h2>${escapeHtml(charData.name || "名前未設定")}を描く</h2>
          </div>

          <p class="mini-info">
            このイベントで描く予定：${activeClaimCount} / ${FANART_LIMIT}
          </p>
        </div>

        <div class="panel-soft">
          <p>
            このページを開いた時点で「描く予定」として保存されています。
            やめる場合は「描くのを取り下げる」を押してください。
          </p>
        </div>

        <div class="fanart-save-area">
          <button id="saveFanartBtn" class="primary-btn" type="button">
            ファンアートを保存
          </button>

          <button id="cancelClaimBtn" class="ghost-btn" type="button">
            描くのを取り下げる
          </button>

          <p id="fanartMessage" class="message"></p>
        </div>

        <div class="canvas-wrap">
          <canvas id="fanartCanvas" width="768" height="768"></canvas>
        </div>

        <div class="draw-tool-stack">
          <details class="draw-tool-panel" open>
            <summary>描く</summary>

            <div class="tool-mode">
              <button id="penModeBtn" class="tool-active" type="button">
                ペン
              </button>

              <button id="eraserModeBtn" type="button">
                消しゴム
              </button>

              <button id="eyedropperModeBtn" type="button">
                スポイト
              </button>

              <button id="fillModeBtn" type="button">
                塗りつぶし
              </button>
            </div>
          </details>

          <details class="draw-tool-panel">
            <summary>ペン設定</summary>

            <div class="canvas-tools">
              <label class="draw-control">
                <span>色</span>
                <input id="penColor" type="color" value="#3c342e">
              </label>

              <label class="draw-control">
                <span>ペン太さ</span>
                <input id="penSize" type="range" min="1" max="30" value="6">
              </label>

              <label class="draw-control">
                <span>透明度 <b id="opacityValue">100%</b></span>
                <input id="penOpacity" type="range" min="10" max="100" value="100">
              </label>

              <label class="draw-control">
                <span>消しゴム太さ</span>
                <input id="eraserSize" type="range" min="4" max="80" value="24">
              </label>

              <label class="pressure-toggle pressure-switch">
                <input id="pressureToggle" type="checkbox">
                <span class="pressure-switch-text">
                  筆圧ON
                  <small>対応ペンのみ</small>
                </span>
              </label>

              <p class="mini-info">
                筆圧は対応端末のみ有効です。ON中はキャンバスではペン入力のみ描画します。
              </p>
            </div>
          </details>

          <details class="draw-tool-panel draw-layer-panel">
            <summary>レイヤー</summary>

            <div class="draw-layer-buttons">
              <button id="layerBtn1" class="layer-btn" type="button">
                レイヤー2（上）
              </button>

              <button id="layerBtn0" class="layer-btn is-active" type="button">
                レイヤー1（下）
              </button>
            </div>

            <div class="draw-layer-actions">
              <button id="toggleLayerBtn" class="ghost-btn" type="button">
                表示/非表示
              </button>

              <button id="clearLayerBtn" class="danger-btn" type="button">
                選択中を消す
              </button>
            </div>

            <p id="layerStatusText" class="mini-info">
              現在：レイヤー1（下） / 表示中
            </p>
          </details>

          <details class="draw-tool-panel">
            <summary>操作</summary>

            <div class="draw-sub-actions">
              <button id="undoBtn" class="ghost-btn" type="button">
                戻す
              </button>
            </div>
          </details>

          <details class="draw-tool-panel draw-danger-panel">
            <summary>危険な操作</summary>

            <p class="mini-info">
              全消しはキャンバス全体を消します。誤タップ防止のため折りたたんでいます。
            </p>

            <div class="draw-danger-actions">
              <button id="clearBtn" class="danger-btn" type="button">
                全消し
              </button>
            </div>
          </details>
        </div>
      </div>

      <aside class="panel fanart-reference-panel">
        <p class="eyebrow">Reference</p>
        <h2>参考キャラ</h2>

        <img
          class="fanart-reference-image"
          src="${charData.imageData}"
          alt="${escapeHtml(charData.name || "キャラ")}"
        >

        <h3>${escapeHtml(charData.name || "名前未設定")}</h3>

        ${
          charData.kana
            ? `<p class="mini-info">${escapeHtml(charData.kana)}</p>`
            : ""
        }

        <p class="status-pill">
          ファンアート歓迎
        </p>

        <section class="reference-mini-section">
          <h4>プロフィール</h4>
          ${
            charData.profile
              ? `<p>${nl2br(charData.profile)}</p>`
              : `<p>プロフィールはまだありません。</p>`
          }
        </section>

        <section class="reference-mini-section">
          <h4>NG・注意事項</h4>
          ${
            charData.ngText
              ? `<p>${nl2br(charData.ngText)}</p>`
              : `<p>特に記載はありません。</p>`
          }
        </section>

        <section class="reference-mini-section">
          <h4>イベント</h4>
          <p>${escapeHtml(eventData.title || "無題のイベント")}</p>
        </section>

        <div class="actions">
          <a class="ghost-btn" href="/events/file/?id=${encodeURIComponent(eventId)}">
            イベントへ戻る
          </a>

          <a class="ghost-btn" href="/characters/file/?id=${encodeURIComponent(characterId)}">
            キャラ詳細
          </a>
        </div>
      </aside>
    </section>
  `;

  setupCanvas();
  setupSaveFanart();
  setupCancelClaim();
}









function setupSaveFanart() {
  const saveBtn = document.getElementById("saveFanartBtn");
  const cancelBtn = document.getElementById("cancelClaimBtn");
  const message = document.getElementById("fanartMessage");

  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    if (!currentUser) {
      if (message) {
        message.textContent = "保存するにはログインが必要です。";
      }

      return;
    }

    if (!hasDrawn) {
      if (message) {
        message.textContent = "保存する前にファンアートを描いてください。";
      }

      return;
    }

    const existing = await getExistingFanartForCharacter();

    if (existing) {
      if (message) {
        message.textContent = "このキャラのファンアートはすでに保存済みです。";
      }

      return;
    }

    try {
      if (message) {
        message.textContent = "ファンアートを保存しています...";
      }

      saveBtn.disabled = true;

      if (cancelBtn) {
        cancelBtn.disabled = true;
      }

      const imageData = getCanvasImageData();

      const fanartId = getFanartId();
      const claimId = getClaimId();
      const entryId = getEntryId();

      const batch = writeBatch(db);

      batch.set(doc(db, "v2EventFanarts", fanartId), {
        eventId,
        targetCharacterId: characterId,
        targetCharacterOwnerId: currentCharacter.data.userId || "",
        userId: currentUser.uid,
        imageData,
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.update(doc(db, "v2EventFanartClaims", claimId), {
        status: "posted",
        updatedAt: serverTimestamp()
      });

      batch.update(doc(db, "v2EventEntries", entryId), {
        progressCount: increment(-1),
        fanartCount: increment(1),
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      if (message) {
        message.textContent = "ファンアートを保存しました。";
      }

      setTimeout(() => {
        location.href = `/events/file/?id=${encodeURIComponent(eventId)}`;
      }, 700);
    } catch (error) {
      console.error(error);

      saveBtn.disabled = false;

      if (cancelBtn) {
        cancelBtn.disabled = false;
      }

      if (message) {
        message.textContent =
          "ファンアートの保存に失敗しました。少し時間を置いて、もう一度お試しください。";
      }
    }
  });
}

function setupCancelClaim() {
  const cancelBtn = document.getElementById("cancelClaimBtn");
  const saveBtn = document.getElementById("saveFanartBtn");
  const message = document.getElementById("fanartMessage");

  if (!cancelBtn) return;

  cancelBtn.addEventListener("click", async () => {
    const ok = confirm("このキャラを描くのを取り下げますか？");

    if (!ok) return;

    try {
      cancelBtn.disabled = true;

      if (saveBtn) {
        saveBtn.disabled = true;
      }

      if (message) {
        message.textContent = "取り下げています...";
      }

      const claimId = getClaimId();
      const entryId = getEntryId();

      const batch = writeBatch(db);

      batch.update(doc(db, "v2EventFanartClaims", claimId), {
        status: "cancelled",
        isDeleted: true,
        updatedAt: serverTimestamp()
      });

      batch.update(doc(db, "v2EventEntries", entryId), {
        progressCount: increment(-1),
        fanartCount: currentEntry.data.fanartCount || 0,
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      if (message) {
        message.textContent = "描く予定を取り下げました。";
      }

      setTimeout(() => {
        location.href = `/events/file/?id=${encodeURIComponent(eventId)}`;
      }, 700);
    } catch (error) {
      console.error(error);

      cancelBtn.disabled = false;

      if (saveBtn) {
        saveBtn.disabled = false;
      }

      if (message) {
        message.textContent =
          "取り下げに失敗しました。少し時間を置いて、もう一度お試しください。";
      }
    }
  });
}

async function init() {
  if (!eventId || !characterId) {
    renderError("情報が足りません", "イベントまたはキャラクターが選ばれていません。");
    return;
  }

  if (!currentUser) {
    renderError("ログインが必要です", "ファンアートを描くにはログインしてください。");
    return;
  }

  const [event, character] = await Promise.all([
    getEvent(),
    getCharacter()
  ]);

  if (!event) {
    renderError(
      "イベントが見つかりません",
      "イベントが削除されたか、URLが変わっている可能性があります。"
    );
    return;
  }

  if (!character) {
    renderError(
      "キャラが見つかりません",
      "キャラクターが削除されたか、URLが変わっている可能性があります。"
    );
    return;
  }

  currentEvent = event;
  currentCharacter = character;

  if (event.data.isDeleted === true || event.data.isPublic !== true) {
    renderError("イベントに参加できません", "このイベントは現在利用できません。");
    return;
  }

  if (event.data.status !== "open") {
    renderError(
      "受付中ではありません",
      "このイベントは現在ファンアートを受け付けていません。"
    );
    return;
  }

  if (character.data.isDeleted === true || character.data.isPublic !== true) {
    renderError("このキャラは描けません", "公開されていないキャラクターです。");
    return;
  }

  if (character.data.faOk !== true) {
    renderError(
      "このキャラは描けません",
      "このキャラクターは現在、ファンアートを受け付けていません。"
    );
    return;
  }

  const entry = await getEventEntryForCharacter();

  if (!entry) {
    renderError(
      "参加キャラではありません",
      "このキャラはイベントに参加していません。"
    );
    return;
  }

  currentEntry = entry;

  if (typeof currentEntry.data.progressCount !== "number") {
    currentEntry.data.progressCount = 0;
  }

  if (typeof currentEntry.data.fanartCount !== "number") {
    currentEntry.data.fanartCount = 0;
  }

  const myClaims = await getMyClaims();

  const claimOk = await ensureClaim(myClaims);

  if (!claimOk) return;

  const updatedClaims = await getMyClaims();

  renderFanartPage(updatedClaims);
}

if (fanartContent) {
  fanartContent.innerHTML = `
    <div class="panel">
      <p>ファンアートページを準備しています...</p>
    </div>
  `;
}

let authChecked = false;

async function startFanartPage(user) {
  currentUser = user;

  if (!fanartContent) return;

  fanartContent.innerHTML = `
    <div class="panel">
      <p>ログイン状態を確認しました。データを読み込んでいます...</p>
    </div>
  `;

  try {
    await init();
  } catch (error) {
    console.error(error);

    fanartContent.innerHTML = `
      <section class="panel">
        <h1>読み込みに失敗しました</h1>
        <p>${escapeHtml(error.message)}</p>

        <div class="actions">
          <a class="ghost-btn" href="/events/file/?id=${encodeURIComponent(eventId || "")}">
            イベントへ戻る
          </a>
        </div>
      </section>
    `;
  }
}

try {
  onAuthStateChanged(auth, async (user) => {
    authChecked = true;
    await startFanartPage(user);
  });
} catch (error) {
  console.error(error);

  if (fanartContent) {
    fanartContent.innerHTML = `
      <section class="panel">
        <h1>ログイン確認で失敗しました</h1>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `;
  }
}

setTimeout(async () => {
  if (authChecked) return;

  authChecked = true;

  await startFanartPage(auth.currentUser);
}, 1500);

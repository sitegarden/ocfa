import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");

const penColor = document.getElementById("penColor");
const penSize = document.getElementById("penSize");
const penOpacity = document.getElementById("penOpacity");
const eraserSize = document.getElementById("eraserSize");

const clearBtn = document.getElementById("clearBtn");
const undoBtn = document.getElementById("undoBtn");
const saveDrawingBtn = document.getElementById("saveDrawingBtn");
const overwriteDrawingBtn = document.getElementById("overwriteDrawingBtn");

const penModeBtn = document.getElementById("penModeBtn");
const eraserModeBtn = document.getElementById("eraserModeBtn");
const eyedropperModeBtn = document.getElementById("eyedropperModeBtn");

const message = document.getElementById("message");
const drawingList = document.getElementById("drawingList");
const opacityValue = document.getElementById("opacityValue");

const layerBtn0 = document.getElementById("layerBtn0");
const layerBtn1 = document.getElementById("layerBtn1");
const toggleLayerBtn = document.getElementById("toggleLayerBtn");
const clearLayerBtn = document.getElementById("clearLayerBtn");
const layerStatusText = document.getElementById("layerStatusText");
const pressureToggle = document.getElementById("pressureToggle");

const MAX_DRAWINGS_PER_USER = 100;
const MAX_HISTORY = 30;
const LAYER_COUNT = 2;

let drawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawn = false;

let history = [];
let currentTool = "pen";
let currentDrawingId = null;

let activeLayerIndex = 0;
let layerCanvases = [];
let layerContexts = [];
let layerVisible = [true, true];

function createLayerCanvas() {
  const layerCanvas = document.createElement("canvas");

  layerCanvas.width = canvas.width;
  layerCanvas.height = canvas.height;

  const layerCtx = layerCanvas.getContext("2d");

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

function restoreImage(dataUrl) {
  const img = new Image();

  img.onload = () => {
    initLayers();

    const baseCtx = layerContexts[0];

    baseCtx.clearRect(0, 0, canvas.width, canvas.height);
    baseCtx.drawImage(img, 0, 0, canvas.width, canvas.height);

    activeLayerIndex = 0;
    layerVisible = [true, true];

    redrawCanvas();
    updateLayerUi();

    history = [];
    saveHistory();
  };

  img.src = dataUrl;
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

  penColor.value = hex;
  message.textContent = `色を拾いました：${hex}`;

  setTool("pen");
}

function setTool(tool) {
  currentTool = tool;

  penModeBtn.classList.toggle("tool-active", tool === "pen");
  eraserModeBtn.classList.toggle("tool-active", tool === "eraser");
  eyedropperModeBtn.classList.toggle("tool-active", tool === "eyedropper");

  if (tool === "pen") {
    message.textContent = "ペンで描けます。";
  }

  if (tool === "eraser") {
    message.textContent = "消しゴムで消せます。";
  }

  if (tool === "eyedropper") {
    message.textContent = "キャンバスから色を拾えます。拾いたい場所をタップしてください。";
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
    message.textContent = "筆圧ON中は、キャンバスではペン入力のみ描画できます。";
    return;
  }

  e.preventDefault();

  if (currentTool === "eyedropper") {
    pickColor(e);
    return;
  }

  if (!layerVisible[activeLayerIndex]) {
    message.textContent = "非表示中のレイヤーには描けません。";
    return;
  }

  const point = getPoint(e);

  drawing = true;
  lastX = point.x;
  lastY = point.y;

  saveHistory();

  if (canvas.setPointerCapture && e.pointerId !== undefined) {
    canvas.setPointerCapture(e.pointerId);
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
    targetCtx.lineWidth = Math.max(1, Number(eraserSize.value) * pressure);
  } else {
    const opacity = Number(penOpacity.value) / 100;

    targetCtx.globalAlpha = opacity;
    targetCtx.globalCompositeOperation = "source-over";
    targetCtx.strokeStyle = penColor.value;
    targetCtx.lineWidth = Math.max(1, Number(penSize.value) * pressure);
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

function stopDraw(e) {
  if (!drawing) return;

  drawing = false;
  redrawCanvas();

  if (canvas.releasePointerCapture && e?.pointerId !== undefined) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (error) {
      console.error(error);
    }
  }
}

function getCanvasImageData() {
  redrawCanvas();

  return canvas.toDataURL("image/jpeg", 0.82);
}

function setEditingDraft(drawingId) {
  currentDrawingId = drawingId;

  if (overwriteDrawingBtn) {
    overwriteDrawingBtn.hidden = false;
  }
}

function clearEditingDraft() {
  currentDrawingId = null;

  if (overwriteDrawingBtn) {
    overwriteDrawingBtn.hidden = true;
  }
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

      message.textContent = layerVisible[activeLayerIndex]
        ? "選択中のレイヤーを表示しました。"
        : "選択中のレイヤーを非表示にしました。";
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
      message.textContent = `${layerName}を消しました。`;
    });
  }
}

penModeBtn.addEventListener("click", () => {
  setTool("pen");
});

eraserModeBtn.addEventListener("click", () => {
  setTool("eraser");
});

eyedropperModeBtn.addEventListener("click", () => {
  setTool("eyedropper");
});

clearBtn.addEventListener("click", () => {
  if (!confirm("キャンバスをまっさらにしますか？")) return;

  initCanvas();
  hasDrawn = false;
  clearEditingDraft();

  message.textContent = "キャンバスをまっさらにしました。";
});

undoBtn.addEventListener("click", () => {
  if (history.length <= 1) {
    message.textContent = "これ以上戻れません。";
    return;
  }

  history.pop();

  const previous = history[history.length - 1];

  restoreLayerSnapshot(previous);
  hasDrawn = true;

  message.textContent = "1つ戻しました。";
});

saveDrawingBtn.addEventListener("click", async () => {
  const user = auth.currentUser;

  if (!user) {
    message.textContent = "保存するにはログインが必要です。";
    return;
  }

  if (!hasDrawn) {
    message.textContent = "保存する前に、キャンバスに絵を描いてください。";
    return;
  }

  try {
    message.textContent = "保存できる下書き数を確認しています...";

    const ok = await canSaveDrawing(user);

    if (!ok) {
      message.textContent =
        `保存できるイラストは${MAX_DRAWINGS_PER_USER}件までです。不要な下書きを削除してください。`;

      return;
    }

    message.textContent = "下書きを保存しています...";

    const imageData = getCanvasImageData();

    const docRef = await addDoc(collection(db, "v2Drawings"), {
      userId: user.uid,
      imageData,
      status: "draft",
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    setEditingDraft(docRef.id);

    message.textContent = "新しい下書きとして保存しました。このまま続きから描けます。";

    await loadDrawings();
  } catch (error) {
    console.error(error);

    message.textContent =
      "下書きの保存に失敗しました。少し時間を置いて、もう一度お試しください。";
  }
});

overwriteDrawingBtn.addEventListener("click", async () => {
  const user = auth.currentUser;

  if (!user) {
    message.textContent = "上書き保存するにはログインが必要です。";
    return;
  }

  if (!currentDrawingId) {
    message.textContent = "上書きする下書きが選ばれていません。";
    return;
  }

  if (!hasDrawn) {
    message.textContent = "上書き保存する前に、キャンバスに絵を描いてください。";
    return;
  }

  try {
    message.textContent = "下書きを上書き保存しています...";

    const imageData = getCanvasImageData();

    await updateDoc(doc(db, "v2Drawings", currentDrawingId), {
      imageData,
      status: "draft",
      isDeleted: false,
      updatedAt: serverTimestamp()
    });

    message.textContent = "下書きを上書き保存しました。";

    await loadDrawings();
  } catch (error) {
    console.error(error);

    message.textContent =
      "上書き保存に失敗しました。少し時間を置いて、もう一度お試しください。";
  }
});

async function deleteDraft(drawingId) {
  if (!confirm("この下書きを削除しますか？")) return;

  try {
    message.textContent = "下書きを削除しています...";

    await updateDoc(doc(db, "v2Drawings", drawingId), {
      isDeleted: true,
      updatedAt: serverTimestamp()
    });

    if (currentDrawingId === drawingId) {
      clearEditingDraft();
    }

    message.textContent = "下書きを削除しました。";

    await loadDrawings();
  } catch (error) {
    console.error(error);

    message.textContent =
      "下書きの削除に失敗しました。少し時間を置いて、もう一度お試しください。";
  }
}

async function loadDrawings() {
  const user = auth.currentUser;

  if (!user) {
    drawingList.innerHTML = `
      <p class="mini-info">
        ログインすると、保存した下書きをここで確認できます。
      </p>
    `;

    return;
  }

  const q = query(
    collection(db, "v2Drawings"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    drawingList.innerHTML = `
      <p class="mini-info">
        まだ保存した下書きはありません。
      </p>
    `;

    return;
  }

  drawingList.innerHTML = "";

  const drawings = [];

  snap.forEach((docSnap) => {
    drawings.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  drawings.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;

    return bTime - aTime;
  });

  drawings.forEach((item) => {
    const drawingData = item.data;
    const drawingId = item.id;

    const card = document.createElement("article");

    card.className = "drawing-card";

    const canEdit = drawingData.status === "draft";
    const isEditing = currentDrawingId === drawingId;

    card.innerHTML = `
      <img src="${drawingData.imageData}" alt="保存した絵">

      <p class="mini-info">
        ${
          drawingData.status === "adopted"
            ? "キャラ登録済み"
            : isEditing
              ? "編集中の下書き"
              : "下書き"
        }
      </p>

      <div class="drawing-actions">
        ${
          canEdit
            ? `
              <a class="ghost-btn" href="/characters/new/?drawing=${drawingId}">
                この絵をキャラにする
              </a>
            `
            : `
              <span class="mini-info">登録済み</span>
            `
        }

        ${
          canEdit
            ? `
              <button class="ghost-btn" type="button" data-load="${drawingId}">
                続きを描く
              </button>
            `
            : ""
        }

        ${
          canEdit
            ? `
              <button class="danger-btn" type="button" data-delete="${drawingId}">
                削除
              </button>
            `
            : ""
        }
      </div>
    `;

    drawingList.appendChild(card);

    const loadBtn = card.querySelector("[data-load]");
    const deleteBtn = card.querySelector("[data-delete]");

    if (loadBtn) {
      loadBtn.addEventListener("click", () => {
        restoreImage(drawingData.imageData);
        setEditingDraft(drawingId);

        hasDrawn = true;

        message.textContent = "下書きをキャンバスに戻しました。続きから描けます。";
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        deleteDraft(drawingId);
      });
    }
  });
}

async function getMyDrawingCount(user) {
  const q = query(
    collection(db, "v2Drawings"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  return snap.size;
}

async function canSaveDrawing(user) {
  const count = await getMyDrawingCount(user);

  if (count >= MAX_DRAWINGS_PER_USER) {
    alert(
      `保存できるイラストは${MAX_DRAWINGS_PER_USER}件までです。\n不要な下書きを削除してから、もう一度保存してください。`
    );

    return false;
  }

  return true;
}

if (opacityValue) {
  opacityValue.textContent = `${penOpacity.value}%`;

  penOpacity.addEventListener("input", () => {
    opacityValue.textContent = `${penOpacity.value}%`;
  });
}

setupCanvasEvents();
setupLayerEvents();

onAuthStateChanged(auth, () => {
  loadDrawings().catch((error) => {
    console.error(error);

    drawingList.innerHTML = `
      <p class="mini-info">
        下書きの読み込みに失敗しました。ページを再読み込みしてみてください。
      </p>
    `;
  });
});

initCanvas();
setTool("pen");

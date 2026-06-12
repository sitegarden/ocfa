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

let drawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawn = false;
let history = [];
let currentTool = "pen";
let currentDrawingId = null;

function initCanvas() {
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  history = [];
  saveHistory();
}

function saveHistory() {
  history.push(canvas.toDataURL("image/jpeg", 0.82));

  if (history.length > 20) {
    history.shift();
  }
}

function restoreImage(dataUrl) {
  const img = new Image();

  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    history = [];
    saveHistory();
  };

  img.src = dataUrl;
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;

  return {
    x: ((touch.clientX - rect.left) / rect.width) * canvas.width,
    y: ((touch.clientY - rect.top) / rect.height) * canvas.height
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

function startDraw(e) {
  e.preventDefault();

  if (currentTool === "eyedropper") {
    pickColor(e);
    return;
  }

  const point = getPoint(e);

  drawing = true;
  lastX = point.x;
  lastY = point.y;
}

function draw(e) {
  if (!drawing) return;

  e.preventDefault();

  const point = getPoint(e);

  if (currentTool === "eraser") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fffdf8";
    ctx.lineWidth = Number(eraserSize.value);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  } else {
    const opacity = Number(penOpacity.value) / 100;

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = penColor.value;

    if (opacity < 1) {
      ctx.lineCap = "butt";
      ctx.lineWidth = Math.max(1, Number(penSize.value) * 0.9);
    } else {
      ctx.lineCap = "round";
      ctx.lineWidth = Number(penSize.value);
    }

    ctx.lineJoin = "round";
  }

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();

  ctx.globalAlpha = 1;

  lastX = point.x;
  lastY = point.y;
  hasDrawn = true;
}

function stopDraw() {
  if (!drawing) return;

  drawing = false;
  saveHistory();
}

function getCanvasImageData() {
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

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", stopDraw);
canvas.addEventListener("mouseleave", stopDraw);

canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", draw, { passive: false });
canvas.addEventListener("touchend", stopDraw);

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
  if (history.length <= 1) return;

  history.pop();

  const previous = history[history.length - 1];
  restoreImage(previous);
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

    message.textContent =
      "新しい下書きとして保存しました。このまま続きから描けます。";

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
      <p>ログインすると、保存した下書きをここで確認できます。</p>
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
      <p>まだ保存した下書きはありません。</p>
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
      <img src="${drawingData.imageData}" alt="保存した下書き">

      <div class="drawing-card-body">
        <p class="mini-info">
          ${
            drawingData.status === "adopted"
              ? "キャラ登録済み"
              : isEditing
                ? "編集中の下書き"
                : "下書き"
          }
        </p>

        <div class="drawing-card-actions">
          ${
            canEdit
              ? `<a class="primary-btn" href="/characters/new/?drawing=${drawingId}">この絵をキャラにする</a>`
              : `<span class="ghost-label">登録済み</span>`
          }

          ${
            canEdit
              ? `<button type="button" data-load="${drawingId}">続きを描く</button>`
              : ""
          }

          ${
            canEdit
              ? `<button type="button" class="danger-btn" data-delete="${drawingId}">削除</button>`
              : ""
          }
        </div>
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
        message.textContent =
          "下書きをキャンバスに戻しました。続きから描けます。";
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        deleteDraft(drawingId);
      });
    }
  });
}

if (opacityValue) {
  opacityValue.textContent = `${penOpacity.value}%`;

  penOpacity.addEventListener("input", () => {
    opacityValue.textContent = `${penOpacity.value}%`;
  });
}

onAuthStateChanged(auth, () => {
  loadDrawings().catch((error) => {
    console.error(error);

    drawingList.innerHTML = `
      <p>下書きの読み込みに失敗しました。ページを再読み込みしてみてください。</p>
    `;
  });
});

initCanvas();

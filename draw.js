import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
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
const clearBtn = document.getElementById("clearBtn");
const undoBtn = document.getElementById("undoBtn");
const saveDrawingBtn = document.getElementById("saveDrawingBtn");
const message = document.getElementById("message");
const drawingList = document.getElementById("drawingList");
const penModeBtn = document.getElementById("penModeBtn");
const eraserModeBtn = document.getElementById("eraserModeBtn");
const eraserSize = document.getElementById("eraserSize");
const penOpacity = document.getElementById("penOpacity");

let drawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawn = false;
let history = [];
let currentTool = "pen";

function initCanvas() {
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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

function startDraw(e) {
  e.preventDefault();

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
} else {
  ctx.globalAlpha = Number(penOpacity.value) / 100;
  ctx.strokeStyle = penColor.value;
  ctx.lineWidth = Number(penSize.value);
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

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", stopDraw);
canvas.addEventListener("mouseleave", stopDraw);

canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", draw, { passive: false });
canvas.addEventListener("touchend", stopDraw);

penModeBtn.addEventListener("click", () => {
  currentTool = "pen";
  penModeBtn.classList.add("tool-active");
  eraserModeBtn.classList.remove("tool-active");
});

eraserModeBtn.addEventListener("click", () => {
  currentTool = "eraser";
  eraserModeBtn.classList.add("tool-active");
  penModeBtn.classList.remove("tool-active");
});

clearBtn.addEventListener("click", () => {
  if (!confirm("キャンバスを全消しする？")) return;

  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  hasDrawn = false;
  saveHistory();
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
    message.textContent = "ログインしてから保存してくれ。";
    return;
  }

  if (!hasDrawn) {
    message.textContent = "まずは何か描いてくれ。";
    return;
  }

  try {
    message.textContent = "保存中...";

    const imageData = canvas.toDataURL("image/jpeg", 0.82);

    await addDoc(collection(db, "v2Drawings"), {
      userId: user.uid,
      imageData,
      status: "draft",
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    message.textContent = "下書き保存できた。いい感じ。";

    await loadDrawings();
  } catch (error) {
    console.error(error);
    message.textContent = "保存に失敗した。Firestoreルールを確認してくれ。";
  }
});

async function loadDrawings() {
  const user = auth.currentUser;

  if (!user) {
    drawingList.innerHTML = `<p>ログインすると保存した絵が見れるぞ。</p>`;
    return;
  }

  const q = query(
    collection(db, "v2Drawings"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    drawingList.innerHTML = `<p>まだ保存した絵はないぞ。</p>`;
    return;
  }

  drawingList.innerHTML = "";

  snap.forEach((docSnap) => {
    const drawing = docSnap.data();
    const drawingId = docSnap.id;

    const card = document.createElement("article");
    card.className = "drawing-card";

    const canAdopt = drawing.status === "draft";

    card.innerHTML = `
      <img src="${drawing.imageData}" alt="保存した絵">

      <div class="drawing-card-body">
        <p class="mini-info">
          ${drawing.status === "adopted" ? "キャラ登録済み" : "下書き"}
        </p>

        <div class="drawing-card-actions">
          ${
            canAdopt
              ? `<a class="primary-btn" href="/characters/new/?drawing=${drawingId}">キャラ登録へ</a>`
              : `<span class="ghost-label">登録済み</span>`
          }

          ${
            canAdopt
              ? `<button type="button" data-load="${drawingId}">描き直す</button>`
              : ""
          }
        </div>
      </div>
    `;

    drawingList.appendChild(card);

    const loadBtn = card.querySelector("[data-load]");

    if (loadBtn) {
      loadBtn.addEventListener("click", () => {
        restoreImage(drawing.imageData);
        hasDrawn = true;
        message.textContent = "下書きをキャンバスに戻した。描き直せるぞ。";
        saveHistory();
      });
    }
  });
}

onAuthStateChanged(auth, () => {
  loadDrawings().catch((error) => {
    console.error(error);
    drawingList.innerHTML = `<p>下書きの読み込みに失敗した。</p>`;
  });
});

const opacityValue = document.getElementById("opacityValue");

penOpacity.addEventListener("input", () => {
  opacityValue.textContent = `${penOpacity.value}%`;
});

initCanvas();

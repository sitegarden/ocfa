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
let drawing = false;
let currentTool = "pen";
let undoStack = [];

const CANVAS_SIZE = 768;
const FANART_LIMIT = 3;

function escapeHtml(text) {
  return String(text)
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

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;

  return {
    x: (point.clientX - rect.left) * (canvas.width / rect.width),
    y: (point.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function saveUndo() {
  if (!ctx || !canvas) return;

  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));

  if (undoStack.length > 20) {
    undoStack.shift();
  }
}

function setTool(tool) {
  currentTool = tool;

  document
    .getElementById("penModeBtn")
    ?.classList.toggle("tool-active", tool === "pen");

  document
    .getElementById("eraserModeBtn")
    ?.classList.toggle("tool-active", tool === "eraser");
}

function startDraw(e) {
  e.preventDefault();

  if (!ctx) return;

  saveUndo();
  drawing = true;

  const pos = getPointerPos(e);

  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
  if (!drawing || !ctx) return;

  e.preventDefault();

  const pos = getPointerPos(e);

  const penColor = document.getElementById("penColor").value;
  const penSize = Number(document.getElementById("penSize").value);
  const penOpacity = Number(document.getElementById("penOpacity").value) / 100;
  const eraserSize = Number(document.getElementById("eraserSize").value);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (currentTool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.lineWidth = eraserSize;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = penOpacity;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penSize;
  }

  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function endDraw() {
  drawing = false;

  if (!ctx) return;

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function fillCanvasBase() {
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function clearCanvas() {
  if (!ctx || !canvas) return;

  const ok = confirm("キャンバスを全消ししますか？");

  if (!ok) return;

  saveUndo();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fillCanvasBase();
}

function undoCanvas() {
  if (!ctx || !canvas) return;
  if (undoStack.length === 0) return;

  const imageData = undoStack.pop();

  ctx.putImageData(imageData, 0, 0);
}

function setupCanvas() {
  canvas = document.getElementById("fanartCanvas");
  ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  fillCanvasBase();

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", endDraw);

  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  window.addEventListener("touchend", endDraw);

  document.getElementById("penModeBtn").addEventListener("click", () => {
    setTool("pen");
  });

  document.getElementById("eraserModeBtn").addEventListener("click", () => {
    setTool("eraser");
  });

  document.getElementById("undoBtn").addEventListener("click", undoCanvas);
  document.getElementById("clearBtn").addEventListener("click", clearCanvas);

  const opacityInput = document.getElementById("penOpacity");
  const opacityValue = document.getElementById("opacityValue");

  opacityInput.addEventListener("input", () => {
    opacityValue.textContent = `${opacityInput.value}%`;
  });

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

  const claimRef = doc(db, "v2EventFanartClaims", getClaimId());
  const snap = await getDoc(claimRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getExistingFanartForCharacter() {
  if (!currentUser) return null;

  const fanartRef = doc(db, "v2EventFanarts", getFanartId());
  const snap = await getDoc(fanartRef);

  if (!snap.exists()) return null;

  const data = snap.data();

  if (data.isDeleted === true) return null;

  return {
    id: snap.id,
    data
  };
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

  const batch = writeBatch(db);

  batch.set(doc(db, "v2EventFanartClaims", claimId), {
    eventId,
    targetCharacterId: characterId,
    targetCharacterOwnerId: currentCharacter.data.userId || "",
    userId: currentUser.uid,
    status: "drawing",
    isDeleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  batch.update(doc(db, "v2EventEntries", entryId), {
    progressCount: increment(1),
    updatedAt: serverTimestamp()
  });

  await batch.commit();

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

        <div class="canvas-tools">
          <div class="tool-mode">
            <button id="penModeBtn" class="tool-active" type="button">ペン</button>
            <button id="eraserModeBtn" type="button">消しゴム</button>
          </div>

          <label>
            色
            <input id="penColor" type="color" value="#3c342e">
          </label>

          <label>
            ペン太さ
            <input id="penSize" type="range" min="1" max="30" value="6">
          </label>

          <label>
            透明度 <span id="opacityValue">100%</span>
            <input id="penOpacity" type="range" min="10" max="100" value="100">
          </label>

          <label>
            消しゴム太さ
            <input id="eraserSize" type="range" min="4" max="80" value="24">
          </label>

          <button id="undoBtn" type="button">戻す</button>
          <button id="clearBtn" type="button">全消し</button>
        </div>

        <div class="canvas-wrap">
          <canvas id="fanartCanvas" width="768" height="768"></canvas>
        </div>

        <div class="draw-actions">
          <button id="saveFanartBtn" class="primary-btn" type="button">
            ファンアートを保存
          </button>

          <button id="cancelClaimBtn" class="ghost-btn" type="button">
            描くのを取り下げる
          </button>

          <p id="fanartMessage" class="message"></p>
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

  saveBtn.addEventListener("click", async () => {
    if (!currentUser) {
      message.textContent = "保存するにはログインが必要です。";
      return;
    }

    const existing = await getExistingFanartForCharacter();

    if (existing) {
      message.textContent = "このキャラのファンアートはすでに保存済みです。";
      return;
    }

    try {
      message.textContent = "ファンアートを保存しています...";
      saveBtn.disabled = true;
      cancelBtn.disabled = true;

      fillCanvasBase();

      const imageData = canvas.toDataURL("image/png");

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

      message.textContent = "ファンアートを保存しました。";

      setTimeout(() => {
        location.href = `/events/file/?id=${encodeURIComponent(eventId)}`;
      }, 700);
    } catch (error) {
      console.error(error);

      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      message.textContent =
        "ファンアートの保存に失敗しました。少し時間を置いて、もう一度お試しください。";
    }
  });
}

function setupCancelClaim() {
  const cancelBtn = document.getElementById("cancelClaimBtn");
  const saveBtn = document.getElementById("saveFanartBtn");
  const message = document.getElementById("fanartMessage");

  cancelBtn.addEventListener("click", async () => {
    const ok = confirm("このキャラを描くのを取り下げますか？");

    if (!ok) return;

    try {
      cancelBtn.disabled = true;
      saveBtn.disabled = true;
      message.textContent = "取り下げています...";

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
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      message.textContent = "描く予定を取り下げました。";

      setTimeout(() => {
        location.href = `/events/file/?id=${encodeURIComponent(eventId)}`;
      }, 700);
    } catch (error) {
      console.error(error);

      cancelBtn.disabled = false;
      saveBtn.disabled = false;
      message.textContent =
        "取り下げに失敗しました。少し時間を置いて、もう一度お試しください。";
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

  const myClaims = await getMyClaims();

  const claimOk = await ensureClaim(myClaims);

  if (!claimOk) return;

  const updatedClaims = await getMyClaims();

  renderFanartPage(updatedClaims);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

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
});

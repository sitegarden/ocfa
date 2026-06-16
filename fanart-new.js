import { auth, db, storage } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const params = new URLSearchParams(location.search);
const characterId = params.get("characterId");

const fanartGuide = document.getElementById("fanartGuide");
const fanartForm = document.getElementById("fanartForm");
const characterPreview = document.getElementById("characterPreview");
const modeDrawingBtn = document.getElementById("modeDrawingBtn");
const modeUploadBtn = document.getElementById("modeUploadBtn");
const modeHelp = document.getElementById("modeHelp");
const drawingPanel = document.getElementById("drawingPanel");
const uploadPanel = document.getElementById("uploadPanel");
const uploadInput = document.getElementById("uploadInput");
const uploadPreview = document.getElementById("uploadPreview");
const fanartComment = document.getElementById("fanartComment");
const message = document.getElementById("message");

const canvas = document.getElementById("fanartCanvas");
const ctx = canvas.getContext("2d");
const clearCanvasBtn = document.getElementById("clearCanvasBtn");

let currentUser = null;
let currentUserData = null;
let characterData = null;
let selectedMode = "drawing";
let selectedUploadFile = null;

let isDrawing = false;
let lastX = 0;
let lastY = 0;
let penColor = "#30283a";
let penSize = 6;

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
];

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showGuide(html) {
  fanartGuide.hidden = false;
  fanartGuide.innerHTML = html;
  fanartForm.hidden = true;
}

function showForm() {
  fanartGuide.hidden = true;
  fanartForm.hidden = false;
}

function canUploadByUserData(userData) {
  return userData?.role === "admin" || userData?.uploadAllowed === true;
}

async function getUserData(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getCharacter() {
  if (!characterId) return null;

  const characterRef = doc(db, "v2Characters", characterId);
  const snap = await getDoc(characterRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

function getCharacterImageSrc(data) {
  return data.imageUrl || data.imageData || "";
}

function renderCharacterPreview(character) {
  const data = character.data;
  const imageSrc = getCharacterImageSrc(data);

  characterPreview.innerHTML = `
    <div class="character-mini-card">
      <div class="character-thumb">
        ${
          imageSrc
            ? `<img class="character-img" src="${imageSrc}" alt="${escapeHtml(data.name || "キャラクター画像")}">`
            : `<div class="no-image">No Image</div>`
        }
      </div>

      <div>
        <h3>${escapeHtml(data.name || "名前未設定")}</h3>

        ${
          data.kana
            ? `<p class="kana">${escapeHtml(data.kana)}</p>`
            : ""
        }

        <p>
          ${
            data.faOk
              ? "ファンアート歓迎のキャラクターです。"
              : "ファンアートは要確認のキャラクターです。投稿前に注意事項を確認してください。"
          }
        </p>

        ${
          data.ngText
            ? `<p class="error-text">NG・注意事項：${escapeHtml(data.ngText)}</p>`
            : ""
        }

        <a class="primary-link" href="/characters/file/?id=${character.id}">
          キャラ詳細を見る
        </a>
      </div>
    </div>
  `;
}

function setupCanvas() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function startDrawing(event) {
  event.preventDefault();

  const point = getCanvasPoint(event);

  isDrawing = true;
  lastX = point.x;
  lastY = point.y;
}

function draw(event) {
  if (!isDrawing) return;

  event.preventDefault();

  const point = getCanvasPoint(event);

  ctx.strokeStyle = penColor;
  ctx.lineWidth = penColor === "#ffffff" ? 22 : penSize;

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();

  lastX = point.x;
  lastY = point.y;
}

function stopDrawing() {
  isDrawing = false;
}

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", draw);
canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointerleave", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);

document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => {
    penColor = button.dataset.color || "#30283a";
  });
});

clearCanvasBtn?.addEventListener("click", () => {
  if (!confirm("描いたファンアートを消しますか？")) return;
  setupCanvas();
});

function setMode(mode) {
  selectedMode = mode;

  if (mode === "drawing") {
    drawingPanel.hidden = false;
    uploadPanel.hidden = true;
    modeHelp.textContent = "この場で描いたファンアートを投稿します。";
    return;
  }

  if (!canUploadByUserData(currentUserData)) {
    message.textContent = "画像投稿は現在利用できません。お絵描き投稿を使ってください。";
    selectedMode = "drawing";
    drawingPanel.hidden = false;
    uploadPanel.hidden = true;
    return;
  }

  drawingPanel.hidden = true;
  uploadPanel.hidden = false;
  modeHelp.textContent = "選んだ画像をファンアートとして投稿します。";
}

modeDrawingBtn?.addEventListener("click", () => {
  setMode("drawing");
});

modeUploadBtn?.addEventListener("click", () => {
  setMode("upload");
});

function validateUploadFile(file) {
  if (!file) {
    return "投稿する画像を選んでください。";
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "PNG / JPG / WEBP / GIF の画像を選んでください。";
  }

  if (file.size >= MAX_UPLOAD_SIZE) {
    return "画像サイズは5MB未満にしてください。";
  }

  return "";
}

function makeSafeFileName(fileName) {
  const ext = fileName.includes(".")
    ? fileName.split(".").pop().toLowerCase()
    : "png";

  const safeExt = ext.replace(/[^a-z0-9]/g, "") || "png";
  const random = Math.random().toString(36).slice(2, 10);

  return `${Date.now()}_${random}.${safeExt}`;
}

async function uploadFanartImage(user, file) {
  const safeFileName = makeSafeFileName(file.name);
  const imagePath = `fanartUploads/${user.uid}/${safeFileName}`;
  const imageRef = ref(storage, imagePath);

  await uploadBytes(imageRef, file, {
    contentType: file.type
  });

  const imageUrl = await getDownloadURL(imageRef);

  return {
    imageUrl,
    imagePath
  };
}

uploadInput?.addEventListener("change", () => {
  const file = uploadInput.files?.[0] || null;

  selectedUploadFile = file;

  if (!file) {
    uploadPreview.innerHTML = "まだ画像が選ばれていません。";
    return;
  }

  const errorMessage = validateUploadFile(file);

  if (errorMessage) {
    selectedUploadFile = null;
    uploadPreview.innerHTML = `<p class="error-text">${escapeHtml(errorMessage)}</p>`;
    return;
  }

  const previewUrl = URL.createObjectURL(file);

  uploadPreview.innerHTML = `
    <img src="${previewUrl}" alt="ファンアート画像プレビュー">
    <p>${escapeHtml(file.name)}</p>
  `;
});

async function init(user) {
  if (!user) {
    showGuide(`
      <h2>ログインが必要です</h2>
      <p>ファンアートを投稿するにはログインしてください。</p>
    `);

    return;
  }

  currentUser = user;
  currentUserData = await getUserData(user);

  if (!currentUserData) {
    showGuide(`
      <h2>ユーザー情報が見つかりません</h2>
      <p>一度ログアウトして、もう一度ログインしてみてください。</p>
    `);

    return;
  }

  const character = await getCharacter();

  if (!character) {
    showGuide(`
      <h2>キャラクターが見つかりませんでした</h2>
      <p>URLが正しいか確認してください。</p>
      <a class="primary-link" href="/characters/">キャラ一覧へ</a>
    `);

    return;
  }

  characterData = character.data;

  if (characterData.isDeleted === true || characterData.isPublic !== true) {
    showGuide(`
      <h2>このキャラには投稿できません</h2>
      <p>削除済み、または非公開のキャラクターです。</p>
      <a class="primary-link" href="/characters/">キャラ一覧へ</a>
    `);

    return;
  }

  renderCharacterPreview(character);
  setupCanvas();
  setMode("drawing");
  showForm();
}

fanartForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;

  if (!user || !characterData) {
    message.textContent = "投稿に必要な情報が見つかりません。";
    return;
  }

  try {
    message.textContent = "ファンアートを投稿しています...";

    const baseData = {
      characterId,
      characterName: characterData.name || "",
      characterOwnerUid: characterData.userId || "",

      artistUid: user.uid,
      artistName: user.displayName || "",
      artistPhotoURL: user.photoURL || "",

      comment: fanartComment.value.trim(),

      isPublic: true,
      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (selectedMode === "drawing") {
      const imageData = canvas.toDataURL("image/png");

      await addDoc(collection(db, "v2Fanarts"), {
        ...baseData,
        imageSource: "drawing",
        imageData
      });
    }

    if (selectedMode === "upload") {
      if (!canUploadByUserData(currentUserData)) {
        message.textContent = "画像投稿は現在利用できません。";
        return;
      }

      const uploadError = validateUploadFile(selectedUploadFile);

      if (uploadError) {
        message.textContent = uploadError;
        return;
      }

      message.textContent = "画像をアップロードしています...";

      const { imageUrl, imagePath } = await uploadFanartImage(user, selectedUploadFile);

      message.textContent = "ファンアートを投稿しています...";

      await addDoc(collection(db, "v2Fanarts"), {
        ...baseData,
        imageSource: "upload",
        imageUrl,
        imagePath
      });
    }

    message.textContent = "ファンアートを投稿しました。";

    setTimeout(() => {
      location.href = `/characters/file/?id=${characterId}`;
    }, 700);
  } catch (error) {
    console.error(error);
    message.textContent = "投稿に失敗しました。時間を置いてもう一度お試しください。";
  }
});

onAuthStateChanged(auth, (user) => {
  init(user).catch((error) => {
    console.error(error);

    showGuide(`
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
    `);
  });
});

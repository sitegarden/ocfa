import { auth, db, storage } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
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
const drawingId = params.get("drawing");

const form = document.getElementById("characterForm");
const registerGuide = document.getElementById("registerGuide");
const selectedDrawing = document.getElementById("selectedDrawing");
const message = document.getElementById("message");

const pageTitle = document.getElementById("pageTitle");
const pageLead = document.getElementById("pageLead");
const previewTitle = document.getElementById("previewTitle");

const charName = document.getElementById("charName");
const charKana = document.getElementById("charKana");
const charProfile = document.getElementById("charProfile");
const charTags = document.getElementById("charTags");
const faOk = document.getElementById("faOk");
const ngText = document.getElementById("ngText");

const uploadPanel = document.getElementById("uploadPanel");
const uploadInput = document.getElementById("uploadInput");
const uploadPreview = document.getElementById("uploadPreview");

let drawingData = null;
let currentUserData = null;
let selectedUploadFile = null;
let registerMode = drawingId ? "drawing" : "upload";

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
  registerGuide.hidden = false;
  registerGuide.innerHTML = html;
  form.hidden = true;
}

function showForm() {
  registerGuide.hidden = true;
  form.hidden = false;
}

function canUploadByUserData(userData) {
  return userData?.role === "admin" || userData?.uploadAllowed === true;
}

async function getUserData(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    return null;
  }

  return snap.data();
}

function renderUploadMode() {
  registerMode = "upload";
  drawingData = null;

  if (pageTitle) pageTitle.textContent = "画像をアップロードしてキャラ登録";
  if (pageLead) {
    pageLead.textContent = "運営から許可されたユーザーは、画像ファイルからキャラクターを登録できます。";
  }
  if (previewTitle) previewTitle.textContent = "アップロード画像";

  selectedDrawing.innerHTML = `
    <div class="empty-preview">
      <p>画像を選ぶと、ここにプレビューが表示されます。</p>
    </div>
  `;

  uploadPanel.hidden = false;
  showForm();
}

function renderDrawingPreview(data) {
  registerMode = "drawing";

  if (pageTitle) pageTitle.textContent = "この絵をキャラにする";
  if (pageLead) {
    pageLead.textContent = "保存した下書きに名前やプロフィールを付けて、キャラクターとして登録します。";
  }
  if (previewTitle) previewTitle.textContent = "選んだ絵";

  uploadPanel.hidden = true;

  selectedDrawing.innerHTML = `
    <div class="drawing-preview">
      <img src="${data.imageData}" alt="選んだ下書き">
      <p>この絵をキャラクター画像として登録します。</p>
    </div>
  `;

  showForm();
}

async function loadDrawing(user) {
  if (!drawingId) {
    return false;
  }

  const drawingRef = doc(db, "v2Drawings", drawingId);
  const snap = await getDoc(drawingRef);

  if (!snap.exists()) {
    showGuide(`
      <h2>下書きが見つかりませんでした</h2>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <a class="primary-link" href="/draw/">下書き一覧へ戻る</a>
    `);
    return true;
  }

  const data = snap.data();

  if (data.userId !== user.uid) {
    showGuide(`
      <h2>この下書きは登録できません</h2>
      <p>自分が保存した下書きだけ、キャラとして登録できます。</p>
    `);
    return true;
  }

  if (data.isDeleted === true) {
    showGuide(`
      <h2>この下書きは削除済みです</h2>
      <p>別の下書きを選んでください。</p>
      <a class="primary-link" href="/draw/">下書き一覧へ戻る</a>
    `);
    return true;
  }

  if (data.status === "adopted") {
    showGuide(`
      <h2>この下書きは登録済みです</h2>
      <p>すでにキャラクターとして登録されています。</p>
      <div class="button-row">
        <a class="primary-link" href="/characters/">キャラ一覧を見る</a>
        <a class="primary-link" href="/draw/">別の下書きを選ぶ</a>
      </div>
    `);
    return true;
  }

  drawingData = data;
  renderDrawingPreview(data);
  return true;
}

function validateUploadFile(file) {
  if (!file) {
    return "アップロードする画像を選んでください。";
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

async function uploadCharacterImage(user, file) {
  const safeFileName = makeSafeFileName(file.name);
  const imagePath = `characterUploads/${user.uid}/${safeFileName}`;
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
    uploadPreview.innerHTML = `
      <p class="error-text">${escapeHtml(errorMessage)}</p>
    `;
    return;
  }

  const previewUrl = URL.createObjectURL(file);

  uploadPreview.innerHTML = `
    <img src="${previewUrl}" alt="アップロード画像プレビュー">
    <p>${escapeHtml(file.name)}</p>
  `;

  selectedDrawing.innerHTML = `
    <div class="drawing-preview">
      <img src="${previewUrl}" alt="アップロード画像プレビュー">
      <p>この画像をキャラクター画像として登録します。</p>
    </div>
  `;
});

async function init() {
  const user = auth.currentUser;

  if (!user) {
    showGuide(`
      <h2>ログインが必要です</h2>
      <p>キャラ登録するにはログインしてください。</p>
    `);
    return;
  }

  currentUserData = await getUserData(user);

  if (!currentUserData) {
    showGuide(`
      <h2>ユーザー情報が見つかりません</h2>
      <p>一度ログアウトして、もう一度ログインしてみてください。</p>
    `);
    return;
  }

  const handledDrawing = await loadDrawing(user);

  if (handledDrawing) {
    return;
  }

  if (!canUploadByUserData(currentUserData)) {
    showGuide(`
      <h2>アップロード権限がありません</h2>
      <p>画像アップロードは、運営が許可したユーザーだけ使えます。</p>
      <p>まずはサイト内のお絵描き機能からキャラ登録してください。</p>
      <a class="primary-link" href="/draw/">絵を描きに行く</a>
    `);
    return;
  }

  renderUploadMode();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;

  if (!user) {
    message.textContent = "キャラ登録するにはログインが必要です。";
    return;
  }

  const name = charName.value.trim();
  const kana = charKana.value.trim();
  const profile = charProfile.value.trim();
  const tagsText = charTags.value.trim();

  if (!name) {
    message.textContent = "キャラ名を入力してください。";
    return;
  }

  const tags = tagsText
    .split(/[,\s、]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  try {
    message.textContent = "キャラを登録しています...";

    const baseCharacterData = {
      userId: user.uid,
      ownerName: user.displayName || "",
      ownerPhotoURL: user.photoURL || "",
      name,
      kana,
      profile,
      tags,
      faOk: faOk.checked,
      ngText: ngText.value.trim(),
      isPublic: true,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (registerMode === "drawing") {
      if (!drawingId || !drawingData) {
        message.textContent = "登録する下書きが見つかりません。";
        return;
      }

      await addDoc(collection(db, "v2Characters"), {
        ...baseCharacterData,
        imageSource: "drawing",
        drawingId,
        imageData: drawingData.imageData
      });

      await updateDoc(doc(db, "v2Drawings", drawingId), {
        status: "adopted",
        updatedAt: serverTimestamp()
      });
    }

    if (registerMode === "upload") {
      if (!canUploadByUserData(currentUserData)) {
        message.textContent = "アップロード権限がありません。";
        return;
      }

      const uploadError = validateUploadFile(selectedUploadFile);

      if (uploadError) {
        message.textContent = uploadError;
        return;
      }

      message.textContent = "画像をアップロードしています...";

      const { imageUrl, imagePath } = await uploadCharacterImage(user, selectedUploadFile);

      message.textContent = "キャラを登録しています...";

      await addDoc(collection(db, "v2Characters"), {
        ...baseCharacterData,
        imageSource: "upload",
        imageUrl,
        imagePath
      });
    }

    message.textContent = "キャラ登録が完了しました。";

    setTimeout(() => {
      location.href = "/characters/";
    }, 700);
  } catch (error) {
    console.error(error);
    message.textContent = "キャラ登録に失敗しました。権限や画像サイズを確認して、もう一度お試しください。";
  }
});

onAuthStateChanged(auth, () => {
  init().catch((error) => {
    console.error(error);

    showGuide(`
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
    `);
  });
});

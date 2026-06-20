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

const form = document.getElementById("characterForm");
const registerGuide = document.getElementById("registerGuide");
const message = document.getElementById("message");

const charName = document.getElementById("charName");
const charKana = document.getElementById("charKana");
const charProfile = document.getElementById("charProfile");
const charTags = document.getElementById("charTags");
const ngText = document.getElementById("ngText");

const uploadInput = document.getElementById("uploadInput");
const uploadPreview = document.getElementById("uploadPreview");

let currentUserData = null;
let selectedUploadFile = null;

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

function canRegisterCharacter(userData) {
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

function validateUploadFile(file) {
  if (!file) {
    return "キャラ画像を選んでください。";
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
  const extension = fileName.includes(".")
    ? fileName.split(".").pop().toLowerCase()
    : "png";

  const safeExtension = extension.replace(/[^a-z0-9]/g, "") || "png";
  const random = Math.random().toString(36).slice(2, 10);

  return `${Date.now()}_${random}.${safeExtension}`;
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

function getTags() {
  return charTags.value
    .trim()
    .split(/[,\s、]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

uploadInput?.addEventListener("change", () => {
  const file = uploadInput.files?.[0] || null;
  selectedUploadFile = file;

  if (!file) {
    uploadPreview.textContent = "まだ画像が選ばれていません。";
    return;
  }

  const errorMessage = validateUploadFile(file);

  if (errorMessage) {
    selectedUploadFile = null;
    uploadInput.value = "";

    uploadPreview.innerHTML = `
      <p class="error-text">${escapeHtml(errorMessage)}</p>
    `;

    return;
  }

  const previewUrl = URL.createObjectURL(file);

  uploadPreview.innerHTML = `
    <img src="${previewUrl}" alt="選択したキャラ画像のプレビュー">
    <p>${escapeHtml(file.name)}</p>
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
      <p>一度ログアウトしてから、もう一度ログインしてみてください。</p>
    `);
    return;
  }

  if (!canRegisterCharacter(currentUserData)) {
    showGuide(`
      <h2>キャラ登録は承認制です</h2>
      <p>
        キャラ登録は、運営が確認・承認したユーザーのみ利用できます。
      </p>
      <p>
        承認後、このページからキャラクターを登録できるようになります。
      </p>
      <a class="primary-link" href="/characters/">キャラ一覧を見る</a>
    `);
    return;
  }

  showForm();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = auth.currentUser;

  if (!user) {
    message.textContent = "キャラ登録するにはログインが必要です。";
    return;
  }

  if (!canRegisterCharacter(currentUserData)) {
    message.textContent = "キャラ登録の権限がありません。";
    return;
  }

  const name = charName.value.trim();
  const kana = charKana.value.trim();
  const profile = charProfile.value.trim();
  const tags = getTags();
  const uploadError = validateUploadFile(selectedUploadFile);

  if (!name) {
    message.textContent = "キャラ名を入力してください。";
    return;
  }

  if (uploadError) {
    message.textContent = uploadError;
    return;
  }

  try {
    message.textContent = "画像をアップロードしています...";

    const { imageUrl, imagePath } = await uploadCharacterImage(
      user,
      selectedUploadFile
    );

    message.textContent = "キャラを登録しています...";

    await addDoc(collection(db, "v2Characters"), {
      userId: user.uid,
      ownerName: currentUserData.displayName || user.displayName || "",
      ownerPhotoURL: currentUserData.photoURL || user.photoURL || "",

      name,
      kana,
      profile,
      tags,
      
      ngText: ngText.value.trim(),

      imageSource: "upload",
      imageUrl,
      imagePath,

      isPublic: true,
      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    message.textContent = "キャラ登録が完了しました。";

    setTimeout(() => {
      location.href = "/characters/";
    }, 700);
  } catch (error) {
    console.error(error);

    message.textContent =
      "キャラ登録に失敗しました。権限・画像形式・画像サイズを確認して、もう一度お試しください。";
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

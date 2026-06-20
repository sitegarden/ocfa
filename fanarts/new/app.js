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
const uploadInput = document.getElementById("uploadInput");
const uploadPreview = document.getElementById("uploadPreview");
const fanartComment = document.getElementById("fanartComment");
const message = document.getElementById("message");

let currentUserData = null;
let characterData = null;
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
  fanartGuide.hidden = false;
  fanartGuide.innerHTML = html;
  fanartForm.hidden = true;
}

function showForm() {
  fanartGuide.hidden = true;
  fanartForm.hidden = false;
}

function canPostFanart(userData) {
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

async function getCharacter() {
  if (!characterId) {
    return null;
  }

  const characterRef = doc(db, "v2Characters", characterId);
  const snap = await getDoc(characterRef);

  if (!snap.exists()) {
    return null;
  }

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
    <div class="fanart-target-card">
      ${
        imageSrc
          ? `<img src="${imageSrc}" alt="${escapeHtml(data.name || "キャラクター")}">`
          : `<div class="fanart-target-no-image">No Image</div>`
      }

      <div>
        <h3>${escapeHtml(data.name || "名前未設定")}</h3>
        ${
          data.kana
            ? `<p class="fanart-target-kana">${escapeHtml(data.kana)}</p>`
            : ""
        }

        ${
          data.ngText
            ? `
              <p class="fanart-target-note">
                <strong>注意事項</strong><br>
                ${escapeHtml(data.ngText)}
              </p>
            `
            : ""
        }

        <a class="text-link" href="/characters/file/?id=${character.id}">
          キャラ詳細を見る
        </a>
      </div>
    </div>
  `;
}

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
  const extension = fileName.includes(".")
    ? fileName.split(".").pop().toLowerCase()
    : "png";

  const safeExtension = extension.replace(/[^a-z0-9]/g, "") || "png";
  const random = Math.random().toString(36).slice(2, 10);

  return `${Date.now()}_${random}.${safeExtension}`;
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
    <img src="${previewUrl}" alt="選択したファンアート画像のプレビュー">
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

  currentUserData = await getUserData(user);

  if (!currentUserData) {
    showGuide(`
      <h2>ユーザー情報が見つかりません</h2>
      <p>一度ログアウトしてから、もう一度ログインしてみてください。</p>
    `);
    return;
  }

  if (!canPostFanart(currentUserData)) {
    showGuide(`
      <h2>ファンアート投稿は承認制です</h2>
      <p>
        ファンアート投稿は、運営が確認・承認したユーザーのみ利用できます。
      </p>
      <p>
        承認後、このページからファンアートを投稿できるようになります。
      </p>
      <a class="primary-link" href="/characters/">キャラ一覧を見る</a>
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

  if (
    characterData.isDeleted === true ||
    characterData.isPublic !== true
  ) {
    showGuide(`
      <h2>このキャラには投稿できません</h2>
      <p>削除済み、または非公開のキャラクターです。</p>
      <a class="primary-link" href="/characters/">キャラ一覧へ</a>
    `);
    return;
  }

  renderCharacterPreview(character);
  showForm();
}

fanartForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = auth.currentUser;

  if (!user || !characterData) {
    message.textContent = "投稿に必要な情報が見つかりません。";
    return;
  }

  if (!canPostFanart(currentUserData)) {
    message.textContent = "ファンアート投稿の権限がありません。";
    return;
  }

  const uploadError = validateUploadFile(selectedUploadFile);

  if (uploadError) {
    message.textContent = uploadError;
    return;
  }

  try {
    message.textContent = "画像をアップロードしています...";

    const { imageUrl, imagePath } = await uploadFanartImage(
      user,
      selectedUploadFile
    );

    message.textContent = "ファンアートを投稿しています...";

    await addDoc(collection(db, "v2Fanarts"), {
      characterId,
      characterName: characterData.name || "",
      characterOwnerUid: characterData.userId || "",

      artistUid: user.uid,
      artistName: currentUserData.displayName || user.displayName || "",
      artistPhotoURL: currentUserData.photoURL || user.photoURL || "",

      comment: fanartComment.value.trim(),

      imageSource: "upload",
      imageUrl,
      imagePath,

      isPublic: true,
      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    message.textContent = "ファンアートを投稿しました。";

    setTimeout(() => {
      location.href = `/characters/file/?id=${characterId}`;
    }, 700);
  } catch (error) {
    console.error(error);

    message.textContent =
      "投稿に失敗しました。権限・画像形式・画像サイズを確認して、もう一度お試しください。";
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

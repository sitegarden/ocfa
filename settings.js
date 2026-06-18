import { auth, db, storage } from "/firebase.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
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

const settingsContent = document.getElementById("settingsContent");

let currentUser = null;
let currentUserData = null;

const ICON_ALLOWED_ROLES = ["admin", "owner", "moderator"];
const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidHttpsUrl(url) {
  if (!url) return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(url) {
  return url.trim();
}

function canUploadIcon(userData) {
  return ICON_ALLOWED_ROLES.includes(userData.role);
}

async function ensureUserDoc(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return snap.data();
  }

  const initialData = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role: "user",
    handle: "",
    profileText: "",
    genreText: "",
    linkUrl: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userRef, initialData);
  return initialData;
}

function renderSettings(userData) {
  currentUserData = userData;

  const displayName = userData.displayName || currentUser.displayName || "";
  const profileText = userData.profileText || "";
  const genreText = userData.genreText || "";
  const linkUrl = userData.linkUrl || "";
  const photoURL = userData.photoURL || currentUser.photoURL || "";
  const uploadAllowed = canUploadIcon(userData);

  settingsContent.innerHTML = `
    <section class="panel">
      <h2>公開プロフィール</h2>

      <form id="settingsForm" class="form-stack">
        <label>
          <span>表示名</span>
          <input
            id="displayName"
            type="text"
            value="${escapeHtml(displayName)}"
            maxlength="30"
            required
          />
        </label>

        <label>
          <span>ひとこと紹介</span>
          <textarea
            id="profileText"
            rows="4"
            maxlength="300"
          >${escapeHtml(profileText)}</textarea>
        </label>

        <label>
          <span>好きな創作ジャンル</span>
          <textarea
            id="genreText"
            rows="3"
            maxlength="200"
          >${escapeHtml(genreText)}</textarea>
        </label>

        <label>
          <span>リンクURL</span>
          <input
            id="linkUrl"
            type="url"
            value="${escapeHtml(linkUrl)}"
            placeholder="https://example.com"
          />
        </label>

        <p class="note">リンクは https:// から始まるURLのみ保存できます。</p>

        <button type="submit" class="primary-btn">保存する</button>
        <p id="settingsMessage" class="form-message"></p>
      </form>
    </section>

    <section class="panel">
      <h2>アイコン設定</h2>

      <div class="profile-preview">
        ${
          photoURL
            ? `<img class="profile-preview-icon" src="${escapeHtml(photoURL)}" alt="プロフィールアイコン" />`
            : `<div class="profile-preview-icon profile-preview-placeholder">OC</div>`
        }

        <div>
          <h3>${escapeHtml(displayName || "名前未設定")}</h3>
          <p>${escapeHtml(profileText || "紹介文はまだありません。")}</p>
        </div>
      </div>

      ${
        uploadAllowed
          ? `
            <div class="form-stack icon-upload-box">
              <label>
                <span>アイコン画像をアップロード</span>
                <input
                  id="iconFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                />
              </label>

              <p class="note">
                PNG / JPG / WebP / GIF対応。2MB以内がおすすめです。
              </p>

              <button id="uploadIconBtn" type="button" class="primary-btn">
                アイコンをアップロード
              </button>

              <p id="iconUploadMessage" class="form-message"></p>
            </div>
          `
          : `
            <p class="note">
              アイコンのアップロードは、権限のあるユーザーのみ利用できます。
            </p>
          `
      }
    </section>

    <section class="panel">
      <h2>公開ページ</h2>
      <p>あなたの公開ページでは、登録したキャラクターとプロフィールが表示されます。</p>

      <a class="text-link" href="/users/?uid=${encodeURIComponent(currentUser.uid)}">
        公開ページを見る
      </a>
    </section>
  `;

  setupProfileForm();
  setupIconUpload();
}

function setupProfileForm() {
  const form = document.getElementById("settingsForm");
  const message = document.getElementById("settingsMessage");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const displayNameInput = document.getElementById("displayName");
    const profileTextInput = document.getElementById("profileText");
    const genreTextInput = document.getElementById("genreText");
    const linkUrlInput = document.getElementById("linkUrl");

    const nextDisplayName = displayNameInput.value.trim();
    const nextProfileText = profileTextInput.value.trim();
    const nextGenreText = genreTextInput.value.trim();
    const nextLinkUrl = normalizeUrl(linkUrlInput.value);

    if (!nextDisplayName) {
      message.textContent = "表示名を入力してください。";
      return;
    }

    if (!isValidHttpsUrl(nextLinkUrl)) {
      message.textContent = "リンクURLは https:// から始まるURLを入力してください。";
      return;
    }

    try {
      message.textContent = "プロフィールを保存しています...";

      await updateDoc(doc(db, "users", currentUser.uid), {
        displayName: nextDisplayName,
        profileText: nextProfileText,
        genreText: nextGenreText,
        linkUrl: nextLinkUrl,
        updatedAt: serverTimestamp()
      });

      currentUserData = {
        ...currentUserData,
        displayName: nextDisplayName,
        profileText: nextProfileText,
        genreText: nextGenreText,
        linkUrl: nextLinkUrl
      };

      message.textContent = "プロフィールを保存しました。";
    } catch (error) {
      console.error(error);
      message.textContent = "プロフィールの保存に失敗しました。少し時間を置いて、もう一度お試しください。";
    }
  });
}

function setupIconUpload() {
  const uploadBtn = document.getElementById("uploadIconBtn");
  const fileInput = document.getElementById("iconFile");
  const message = document.getElementById("iconUploadMessage");

  if (!uploadBtn || !fileInput || !message) return;

  uploadBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];

    if (!file) {
      message.textContent = "アップロードする画像を選んでください。";
      return;
    }

    if (!file.type.startsWith("image/")) {
      message.textContent = "画像ファイルを選んでください。";
      return;
    }

    if (file.size > MAX_ICON_SIZE) {
      message.textContent = "画像サイズは2MB以内にしてください。";
      return;
    }

    if (!canUploadIcon(currentUserData)) {
      message.textContent = "アイコンを変更する権限がありません。";
      return;
    }

    try {
      message.textContent = "アイコンをアップロードしています...";

      const ext = file.name.split(".").pop() || "png";
      const filePath = `profileIcons/${currentUser.uid}/icon_${Date.now()}.${ext}`;
      const iconRef = ref(storage, filePath);

      await uploadBytes(iconRef, file);
      const downloadURL = await getDownloadURL(iconRef);

      await updateDoc(doc(db, "users", currentUser.uid), {
        photoURL: downloadURL,
        iconPath: filePath,
        updatedAt: serverTimestamp()
      });

      currentUserData = {
        ...currentUserData,
        photoURL: downloadURL,
        iconPath: filePath
      };

      message.textContent = "アイコンを保存しました。";
      renderSettings(currentUserData);
    } catch (error) {
      console.error(error);
      message.textContent = "アイコンのアップロードに失敗しました。権限やStorageルールを確認してください。";
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    settingsContent.innerHTML = `
      <section class="panel">
        <h2>ログインが必要です</h2>
        <p>プロフィール設定を使うには、Googleログインしてください。</p>
      </section>
    `;
    return;
  }

  currentUser = user;

  try {
    const userData = await ensureUserDoc(user);
    renderSettings(userData);
  } catch (error) {
    console.error(error);

    settingsContent.innerHTML = `
      <section class="panel">
        <h2>読み込みに失敗しました</h2>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

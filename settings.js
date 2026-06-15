import { auth, db } from "/firebase.js";

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const settingsContent = document.getElementById("settingsContent");

const HANDLE_MIN_LENGTH = 4;
const HANDLE_MAX_LENGTH = 20;
const HANDLE_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

let currentUser = null;

function escapeHtml(text) {
  return String(text || "")
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
  return String(url || "").trim();
}

function normalizeHandle(handle) {
  return String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function isValidHandle(handle) {
  return /^[a-z0-9_]+$/.test(handle)
    && handle.length >= HANDLE_MIN_LENGTH
    && handle.length <= HANDLE_MAX_LENGTH;
}

function timestampToMs(timestamp) {
  if (!timestamp?.seconds) return 0;
  return timestamp.seconds * 1000;
}

function getHandleRemainingText(handleUpdatedAt) {
  const lastChangedMs = timestampToMs(handleUpdatedAt);

  if (!lastChangedMs) return "";

  const nextChangeMs = lastChangedMs + HANDLE_CHANGE_INTERVAL_MS;
  const remainingMs = nextChangeMs - Date.now();

  if (remainingMs <= 0) return "";

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  return `次にIDを変更できるまで、あと約${remainingDays}日です。`;
}

function canChangeHandle(userData, nextHandle) {
  const currentHandle = normalizeHandle(userData.handle || "");

  if (nextHandle === currentHandle) {
    return true;
  }

  if (!currentHandle) {
    return true;
  }

  const lastChangedMs = timestampToMs(userData.handleUpdatedAt);

  if (!lastChangedMs) {
    return true;
  }

  return Date.now() - lastChangedMs >= HANDLE_CHANGE_INTERVAL_MS;
}

async function ensureUserDoc(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return snap.data();
  }

  const initialData = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role: "user",
    uploadAllowed: false,
    handle: "",
    handleUpdatedAt: null,
    profileText: "",
    genreText: "",
    linkUrl: "",
    isPublic: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userRef, initialData);

  return initialData;
}

function getPublicPageUrl(userData = {}) {
  const handle = normalizeHandle(userData.handle || "");

  if (handle) {
    return `/users/?id=${encodeURIComponent(handle)}`;
  }

  return `/users/?id=${encodeURIComponent(currentUser.uid)}`;
}

function renderSettings(userData) {
  const displayName = userData.displayName || currentUser.displayName || "";
  const handle = userData.handle || "";
  const profileText = userData.profileText || "";
  const genreText = userData.genreText || "";
  const linkUrl = userData.linkUrl || "";
  const publicPageUrl = getPublicPageUrl(userData);
  const handleRemainingText = getHandleRemainingText(userData.handleUpdatedAt);

  settingsContent.innerHTML = `
    <section class="settings-layout">
      <form id="settingsForm" class="panel">
        <p class="eyebrow">Profile</p>
        <h2>公開プロフィール</h2>

        <label>
          表示名
          <input
            id="displayName"
            type="text"
            maxlength="40"
            value="${escapeHtml(displayName)}"
            required
          />
        </label>

        <label>
          ID
          <input
            id="handle"
            type="text"
            maxlength="${HANDLE_MAX_LENGTH}"
            value="${escapeHtml(handle)}"
            placeholder="例：ocfa_user"
            autocomplete="off"
          />
        </label>

        <p class="mini-info">
          IDは4文字以上20文字以内、英数字と_のみ使えます。大文字は自動で小文字になります。
          ${
            handle
              ? "IDの変更は基本1ヶ月に1回までです。"
              : "初回設定はいつでもできます。"
          }
        </p>

        ${
          handleRemainingText
            ? `<p class="status-pill muted-pill">${escapeHtml(handleRemainingText)}</p>`
            : ""
        }

        <label>
          ひとこと紹介
          <textarea id="profileText" rows="5" maxlength="500">${escapeHtml(profileText)}</textarea>
        </label>

        <label>
          好きな創作ジャンル
          <textarea id="genreText" rows="4" maxlength="500">${escapeHtml(genreText)}</textarea>
        </label>

        <label>
          リンクURL
          <input
            id="linkUrl"
            type="url"
            value="${escapeHtml(linkUrl)}"
            placeholder="https://..."
          />
        </label>

        <p class="mini-info">リンクは https:// から始まるURLのみ保存できます。</p>

        <div class="actions">
          <button class="primary-btn" type="submit">保存する</button>
          <a class="ghost-btn" href="${publicPageUrl}">公開ページを見る</a>
        </div>

        <p id="settingsMessage" class="message"></p>
      </form>

      <aside class="panel profile-preview">
        ${
          currentUser.photoURL
            ? `<img class="mypage-avatar" src="${escapeHtml(currentUser.photoURL)}" alt="">`
            : `<div class="mypage-avatar placeholder">OC</div>`
        }

        <div>
          <p class="eyebrow">Public Page</p>
          <h3>${escapeHtml(displayName || "名前未設定")}</h3>

          ${
            handle
              ? `<p class="mini-info">@${escapeHtml(handle)}</p>`
              : `<p class="mini-info">ID未設定</p>`
          }

          <p>${escapeHtml(profileText || "紹介文はまだありません。")}</p>

          ${
            genreText
              ? `<p class="mini-info">${escapeHtml(genreText)}</p>`
              : ""
          }

          ${
            linkUrl
              ? `<a class="text-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">リンクを見る</a>`
              : ""
          }
        </div>
      </aside>
    </section>
  `;

  const form = document.getElementById("settingsForm");
  const message = document.getElementById("settingsMessage");

  const handleInput = document.getElementById("handle");

  handleInput.addEventListener("input", () => {
    const normalized = normalizeHandle(handleInput.value);

    if (handleInput.value !== normalized) {
      handleInput.value = normalized;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const displayNameInput = document.getElementById("displayName");
    const profileTextInput = document.getElementById("profileText");
    const genreTextInput = document.getElementById("genreText");
    const linkUrlInput = document.getElementById("linkUrl");

    const nextDisplayName = displayNameInput.value.trim();
    const nextHandle = normalizeHandle(handleInput.value);
    const nextProfileText = profileTextInput.value.trim();
    const nextGenreText = genreTextInput.value.trim();
    const nextLinkUrl = normalizeUrl(linkUrlInput.value);

    if (!nextDisplayName) {
      message.textContent = "表示名を入力してください。";
      return;
    }

    if (nextHandle && !isValidHandle(nextHandle)) {
      message.textContent = "IDは4文字以上20文字以内、英数字と_のみ使えます。";
      return;
    }

    if (!canChangeHandle(userData, nextHandle)) {
      message.textContent = getHandleRemainingText(userData.handleUpdatedAt)
        || "IDは基本1ヶ月に1回まで変更できます。";
      return;
    }

    if (!isValidHttpsUrl(nextLinkUrl)) {
      message.textContent = "リンクURLは https:// から始まるURLを入力してください。";
      return;
    }

    try {
      message.textContent = "プロフィールを保存しています...";

      const userRef = doc(db, "users", currentUser.uid);

      await runTransaction(db, async (transaction) => {
        const latestUserSnap = await transaction.get(userRef);

        if (!latestUserSnap.exists()) {
          throw new Error("ユーザー情報が見つかりません。");
        }

        const latestUserData = latestUserSnap.data();
        const currentHandle = normalizeHandle(latestUserData.handle || "");
        const handleChanged = nextHandle !== currentHandle;

        if (handleChanged && !canChangeHandle(latestUserData, nextHandle)) {
          throw new Error(
            getHandleRemainingText(latestUserData.handleUpdatedAt)
            || "IDは基本1ヶ月に1回まで変更できます。"
          );
        }

        if (nextHandle) {
          const nextHandleRef = doc(db, "handles", nextHandle);
          const nextHandleSnap = await transaction.get(nextHandleRef);

          if (nextHandleSnap.exists()) {
            const ownerUid = nextHandleSnap.data().uid;

            if (ownerUid !== currentUser.uid) {
              throw new Error("このIDはすでに使われています。");
            }
          }

          transaction.set(nextHandleRef, {
            uid: currentUser.uid,
            handle: nextHandle,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }

        if (handleChanged && currentHandle) {
          const oldHandleRef = doc(db, "handles", currentHandle);
          transaction.delete(oldHandleRef);
        }

        transaction.update(userRef, {
          displayName: nextDisplayName,
          handle: nextHandle,
          profileText: nextProfileText,
          genreText: nextGenreText,
          linkUrl: nextLinkUrl,
          updatedAt: serverTimestamp(),
          ...(handleChanged
            ? { handleUpdatedAt: serverTimestamp() }
            : {})
        });
      });

      message.textContent = "プロフィールを保存しました。";

      const refreshedSnap = await getDoc(doc(db, "users", currentUser.uid));
      renderSettings(refreshedSnap.data());
    } catch (error) {
      console.error(error);
      message.textContent = error.message || "プロフィールの保存に失敗しました。";
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    settingsContent.innerHTML = `
      <section class="panel">
        <h1>ログインが必要です</h1>
        <p>プロフィール設定を使うにはログインしてください。</p>
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
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

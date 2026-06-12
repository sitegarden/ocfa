import { auth, db } from "/firebase.js";

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

const settingsContent = document.getElementById("settingsContent");

let currentUser = null;

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
  const displayName = userData.displayName || currentUser.displayName || "";
  const profileText = userData.profileText || "";
  const genreText = userData.genreText || "";
  const linkUrl = userData.linkUrl || "";

  settingsContent.innerHTML = `
    <form id="settingsForm" class="settings-layout">
      <section class="panel">
        <h2>公開プロフィール</h2>

        <label>
          表示名
          <input
            id="displayName"
            type="text"
            maxlength="30"
            value="${escapeHtml(displayName)}"
            placeholder="例：ゼロ"
          >
        </label>

        <label>
          ひとこと紹介
          <textarea
            id="profileText"
            rows="5"
            maxlength="300"
            placeholder="好きな創作、描いているもの、ひとことなど"
          >${escapeHtml(profileText)}</textarea>
        </label>

        <label>
          好きな創作ジャンル
          <input
            id="genreText"
            type="text"
            maxlength="80"
            value="${escapeHtml(genreText)}"
            placeholder="例：ファンタジー、学園、うちの子交流"
          >
        </label>

        <label>
          リンクURL
          <input
            id="linkUrl"
            type="url"
            value="${escapeHtml(linkUrl)}"
            placeholder="https://example.com"
          >
        </label>

        <p class="mini-info">
          リンクは https:// から始まるURLのみ保存できます。
        </p>

        <button class="primary-btn" type="submit">保存する</button>
        <p id="settingsMessage" class="message"></p>
      </section>

      <section class="panel">
        <h2>公開ページ</h2>

        <p>
          あなたの公開ページでは、登録したキャラクターとプロフィールが表示されます。
        </p>

        <div class="profile-preview">
          ${
            currentUser.photoURL
              ? `<img class="mypage-avatar" src="${currentUser.photoURL}" alt="">`
              : `<div class="mypage-avatar placeholder">OC</div>`
          }

          <div>
            <h3>${escapeHtml(displayName || "名前未設定")}</h3>
            <p>${escapeHtml(profileText || "紹介文はまだありません。")}</p>
          </div>
        </div>

        <div class="actions">
          <a class="ghost-btn" href="/users/?id=${currentUser.uid}">
            公開ページを見る
          </a>
        </div>
      </section>
    </form>
  `;

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

      message.textContent = "プロフィールを保存しました。";
    } catch (error) {
      console.error(error);
      message.textContent =
        "プロフィールの保存に失敗しました。少し時間を置いて、もう一度お試しください。";
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    settingsContent.innerHTML = `
      <section class="panel">
        <h1>ログインが必要です</h1>
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
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

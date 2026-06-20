import { auth, db } from "/firebase.js";

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

const noticeNewContent = document.getElementById("noticeNewContent");

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getUserData(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

function renderLoginRequired() {
  noticeNewContent.innerHTML = `
    <section class="panel">
      <h2>ログインが必要です</h2>
      <p>お知らせを書くには、管理者アカウントでログインしてください。</p>
    </section>
  `;
}

function renderNoPermission() {
  noticeNewContent.innerHTML = `
    <section class="panel">
      <h2>お知らせを作成できません</h2>
      <p>このページは管理者のみ利用できます。</p>

      <div class="actions">
        <a class="ghost-btn" href="/notices/">お知らせ一覧へ</a>
      </div>
    </section>
  `;
}

function renderForm(user, userData) {
  const writerName =
    userData?.displayName ||
    user.email ||
    "管理者";

  noticeNewContent.innerHTML = `
    <form id="noticeForm" class="form-grid">
      <section class="panel">
        <h2>お知らせ内容</h2>

        <label>
          タイトル
          <input
            id="noticeTitle"
            type="text"
            maxlength="80"
            placeholder="例：はじめてのイベントを開催しました"
            required
          >
        </label>

        <label>
          本文
          <textarea
            id="noticeBody"
            rows="10"
            maxlength="2000"
            placeholder="お知らせの内容を書いてください"
          ></textarea>
        </label>

        <label class="check-label">
          <input id="isImportant" type="checkbox">
          大切なお知らせにする
        </label>

        <label class="check-label">
          <input id="isPublic" type="checkbox" checked>
          公開する
        </label>

        <div class="actions">
          <button class="primary-btn" type="submit">
            お知らせを投稿
          </button>

          <a class="ghost-btn" href="/notices/">
            一覧へ戻る
          </a>
        </div>

        <p id="noticeMessage" class="form-message"></p>
      </section>

      <section class="panel">
        <h2>メモ</h2>
        <p>
          イベント開始、機能追加、注意事項などをここから投稿できます。
        </p>

        <div class="panel-soft">
          <p class="mini-info">
            投稿者：${escapeHtml(writerName)}
          </p>
        </div>
      </section>
    </form>
  `;

  const form = document.getElementById("noticeForm");
  const message = document.getElementById("noticeMessage");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = document.getElementById("noticeTitle").value.trim();
    const body = document.getElementById("noticeBody").value.trim();
    const isImportant = document.getElementById("isImportant").checked;
    const isPublic = document.getElementById("isPublic").checked;

    if (!title) {
      message.textContent = "タイトルを入力してください。";
      return;
    }

    try {
      message.textContent = "お知らせを投稿しています...";

      await addDoc(collection(db, "v2Notices"), {
        title,
        body,
        isImportant,
        isPublic,
        isDeleted: false,
        createdBy: user.uid,
        createdByName: writerName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      message.textContent = "お知らせを投稿しました。";

      setTimeout(() => {
        location.href = "/notices/";
      }, 700);
    } catch (error) {
      console.error(error);

      message.textContent =
        "お知らせの投稿に失敗しました。少し時間を置いて、もう一度お試しください。";
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderLoginRequired();
    return;
  }

  try {
    const userData = await getUserData(user);
    const isAdmin = userData?.role === "admin";

    if (!isAdmin) {
      renderNoPermission();
      return;
    }

    renderForm(user, userData);
  } catch (error) {
    console.error(error);

    noticeNewContent.innerHTML = `
      <section class="panel">
        <h2>確認に失敗しました</h2>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

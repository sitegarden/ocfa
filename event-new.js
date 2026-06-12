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

const eventNewContent = document.getElementById("eventNewContent");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function isAdminUser(user) {
  if (!user) return false;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return false;

  return snap.data().role === "admin";
}

function renderLoginRequired() {
  eventNewContent.innerHTML = `
    <section class="panel">
      <h2>ログインが必要です</h2>
      <p>イベントを作成するには、管理者アカウントでログインしてください。</p>
    </section>
  `;
}

function renderNoPermission() {
  eventNewContent.innerHTML = `
    <section class="panel">
      <h2>イベントを作成できません</h2>
      <p>このページは管理者のみ利用できます。</p>
      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderForm(user) {
  eventNewContent.innerHTML = `
    <form id="eventForm" class="form-grid">
      <section class="panel">
        <h2>イベント情報</h2>

        <label>
          イベント名
          <input
            id="eventTitle"
            type="text"
            maxlength="60"
            placeholder="例：第1回 うちの子ゆるFA会"
            required
          >
        </label>

        <label>
          説明
          <textarea
            id="eventDescription"
            rows="8"
            maxlength="1000"
            placeholder="イベントの内容、参加方法、雰囲気など"
          ></textarea>
        </label>

        <label>
          状態
          <select id="eventStatus">
            <option value="draft">下書き</option>
            <option value="open" selected>受付中</option>
            <option value="closed">終了</option>
          </select>
        </label>

        <label class="check-label">
          <input id="isPublic" type="checkbox" checked>
          公開する
        </label>

        <button class="primary-btn" type="submit">イベントを作成</button>
        <p id="eventMessage" class="message"></p>
      </section>

      <section class="panel">
        <h2>メモ</h2>
        <p>
          まずはイベント本体だけ作成します。
          参加キャラやファンアート投稿は、このあと追加していきます。
        </p>

        <div class="panel-soft">
          <p class="mini-info">
            作成者：${escapeHtml(user.displayName || user.email || "管理者")}
          </p>
        </div>
      </section>
    </form>
  `;

  const form = document.getElementById("eventForm");
  const message = document.getElementById("eventMessage");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = document.getElementById("eventTitle").value.trim();
    const description = document.getElementById("eventDescription").value.trim();
    const status = document.getElementById("eventStatus").value;
    const isPublic = document.getElementById("isPublic").checked;

    if (!title) {
      message.textContent = "イベント名を入力してください。";
      return;
    }

    try {
      message.textContent = "イベントを作成しています...";

      const docRef = await addDoc(collection(db, "v2Events"), {
        title,
        description,
        status,
        isPublic,
        isDeleted: false,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      message.textContent = "イベントを作成しました。";

      setTimeout(() => {
        location.href = `/events/file/?id=${encodeURIComponent(docRef.id)}`;
      }, 700);
    } catch (error) {
      console.error(error);
      message.textContent =
        "イベントの作成に失敗しました。少し時間を置いて、もう一度お試しください。";
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderLoginRequired();
    return;
  }

  try {
    const isAdmin = await isAdminUser(user);

    if (!isAdmin) {
      renderNoPermission();
      return;
    }

    renderForm(user);
  } catch (error) {
    console.error(error);

    eventNewContent.innerHTML = `
      <section class="panel">
        <h2>確認に失敗しました</h2>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

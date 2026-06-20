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
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

function renderLoginRequired() {
  eventNewContent.innerHTML = `
    <section class="panel">
      <h2>ログインが必要です</h2>
      <p>
        イベントを作成するには、管理者アカウントでログインしてください。
      </p>
    </section>
  `;
}

function renderNoPermission() {
  eventNewContent.innerHTML = `
    <section class="panel">
      <h2>イベントを作成できません</h2>
      <p>このページは管理者のみ利用できます。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">
          イベント一覧へ
        </a>
      </div>
    </section>
  `;
}

function renderForm(user, userData) {
  const creatorName =
    userData?.displayName ||
    user.email ||
    "管理者";

  eventNewContent.innerHTML = `
    <form id="eventForm" class="events-new-form">
      <section class="panel">
        <h2>イベント情報</h2>

        <label>
          イベント名
          <input
            id="eventTitle"
            type="text"
            maxlength="60"
            placeholder="例：第1回 OCFAキャラ交流会"
            required
          >
        </label>

        <label>
          説明
          <textarea
            id="eventDescription"
            rows="8"
            maxlength="1000"
            placeholder="イベントの内容、エントリー方法、注意事項など"
          ></textarea>
        </label>

        <section class="event-status-field">
          <p class="form-label">状態</p>

          <div class="event-status-options">
            <label class="event-status-card">
              <input type="radio" name="eventStatus" value="draft">

              <span>
                <strong>下書き</strong>
                <small>まだ公開前</small>
              </span>
            </label>

            <label class="event-status-card">
              <input
                type="radio"
                name="eventStatus"
                value="open"
                checked
              >

              <span>
                <strong>エントリー受付中</strong>
                <small>キャラをエントリーできる状態</small>
              </span>
            </label>

            <label class="event-status-card">
              <input type="radio" name="eventStatus" value="closed">

              <span>
                <strong>終了</strong>
                <small>エントリー受付を閉じる</small>
              </span>
            </label>
          </div>
        </section>

        <label class="check-label">
          <input id="isPublic" type="checkbox" checked>
          公開する
        </label>

        <div class="actions">
          <button class="primary-btn" type="submit">
            イベントを作成
          </button>

          <a class="ghost-btn" href="/events/">
            イベント一覧へ
          </a>
        </div>

        <p id="eventMessage" class="message"></p>
      </section>

      <section class="panel events-new-guide">
        <p class="eyebrow">About</p>
        <h2>このイベントでできること</h2>

        <p>
          作成したイベントは、アクティブユーザーへの企画告知として表示されます。
          受付中にすると、参加者は自分の公開キャラを1体エントリーできます。
        </p>

        <div class="panel-soft">
          <p class="mini-info">
            作成者：${escapeHtml(creatorName)}
          </p>
        </div>
      </section>
    </form>
  `;

  const form = document.getElementById("eventForm");
  const message = document.getElementById("eventMessage");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = document.getElementById("eventTitle").value.trim();
    const description = document
      .getElementById("eventDescription")
      .value
      .trim();

    const status = document.querySelector(
      'input[name="eventStatus"]:checked'
    )?.value || "draft";

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
        createdByName: creatorName,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      message.textContent = "イベントを作成しました。";

      setTimeout(() => {
        location.href =
          `/events/file/?id=${encodeURIComponent(docRef.id)}`;
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
    const userData = await getUserData(user);
    const isAdmin = userData?.role === "admin";

    if (!isAdmin) {
      renderNoPermission();
      return;
    }

    renderForm(user, userData);
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

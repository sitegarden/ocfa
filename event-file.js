import { auth, db } from "/firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const eventFile = document.getElementById("eventFile");

const params = new URLSearchParams(location.search);
const eventId = params.get("id");

let currentUser = null;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

function statusLabel(status) {
  if (status === "open") return "受付中";
  if (status === "closed") return "終了";
  if (status === "draft") return "下書き";
  return "準備中";
}

async function isAdminUser(user) {
  if (!user) return false;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return false;

  return snap.data().role === "admin";
}

async function getEvent() {
  const eventRef = doc(db, "v2Events", eventId);
  const snap = await getDoc(eventRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

function renderNoEventId() {
  eventFile.innerHTML = `
    <section class="panel">
      <h1>イベントが選ばれていません</h1>
      <p>URLが正しいか確認してください。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderNotFound() {
  eventFile.innerHTML = `
    <section class="panel">
      <h1>イベントが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderPrivateEvent() {
  eventFile.innerHTML = `
    <section class="panel">
      <h1>このイベントは非公開です</h1>
      <p>公開されていないイベントです。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

async function renderEvent(event) {
  const data = event.data;
  const isAdmin = await isAdminUser(currentUser);

  if (data.isDeleted === true) {
    renderNotFound();
    return;
  }

  if (data.isPublic === false && !isAdmin) {
    renderPrivateEvent();
    return;
  }

  eventFile.innerHTML = `
    <article class="event-detail panel">
      <div class="event-detail-head">
        <div>
          <p class="eyebrow">Event File</p>
          <h1>${escapeHtml(data.title || "無題のイベント")}</h1>

          <div class="event-status-row">
            <span class="status-pill">${statusLabel(data.status)}</span>
            ${
              data.isPublic === false
                ? `<span class="status-pill muted-pill">非公開</span>`
                : `<span class="status-pill">公開中</span>`
            }
          </div>
        </div>

        ${
          isAdmin
            ? `
              <div class="actions">
                <a class="primary-btn" href="/events/edit/?id=${encodeURIComponent(event.id)}">
                  編集する
                </a>
              </div>
            `
            : ""
        }
      </div>

      <section class="detail-section">
        <h2>イベント説明</h2>
        ${
          data.description
            ? `<p>${nl2br(data.description)}</p>`
            : `<p>説明文はまだありません。</p>`
        }
      </section>

      <section class="detail-section">
        <h2>参加キャラ</h2>
        <p>
          参加キャラ機能はこのあと追加します。
          まずはイベント本体の表示までできています。
        </p>
      </section>

      <section class="detail-section">
        <h2>ファンアート</h2>
        <p>
          ファンアート投稿機能は、参加キャラ機能のあとに追加予定です。
        </p>
      </section>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
        <a class="ghost-btn" href="/characters/">キャラ一覧を見る</a>
      </div>
    </article>
  `;
}

async function init() {
  if (!eventId) {
    renderNoEventId();
    return;
  }

  const event = await getEvent();

  if (!event) {
    renderNotFound();
    return;
  }

  await renderEvent(event);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  try {
    await init();
  } catch (error) {
    console.error(error);

    eventFile.innerHTML = `
      <section class="panel">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

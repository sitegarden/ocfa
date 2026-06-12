import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const eventList = document.getElementById("eventList");
const eventAdminActions = document.getElementById("eventAdminActions");

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

async function getUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getEvents(isAdmin) {
  const eventQuery = isAdmin
    ? query(
        collection(db, "v2Events"),
        where("isDeleted", "==", false)
      )
    : query(
        collection(db, "v2Events"),
        where("isDeleted", "==", false),
        where("isPublic", "==", true)
      );

  const snap = await getDocs(eventQuery);

  const events = [];

  snap.forEach((docSnap) => {
    events.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  events.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  return events;
}

function renderEvents(events, isAdmin) {
  if (events.length === 0) {
    eventList.innerHTML = `
      <div class="panel">
        <h2>イベントはまだありません</h2>
        <p>イベントが作成されると、ここに表示されます。</p>
        ${
          isAdmin
            ? `
              <div class="actions">
                <a class="primary-btn" href="/events/new/">最初のイベントを作る</a>
              </div>
            `
            : ""
        }
      </div>
    `;
    return;
  }

  eventList.innerHTML = `
    <div class="event-grid">
      ${events
        .map(({ id, data }) => {
          return `
            <article class="event-card">
              <a class="event-card-link" href="/events/file/?id=${encodeURIComponent(id)}">
                <div class="event-card-body">
                  <p class="status-pill">${statusLabel(data.status)}</p>

                  <h2>${escapeHtml(data.title || "無題のイベント")}</h2>

                  ${
                    data.description
                      ? `<p>${nl2br(data.description)}</p>`
                      : `<p>説明文はまだありません。</p>`
                  }

                  <p class="mini-info">
                    ${data.isPublic === false ? "非公開イベント" : "公開イベント"}
                  </p>
                </div>
              </a>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

onAuthStateChanged(auth, async (user) => {
  try {
    const userData = await getUserData(user);
    const isAdmin = userData?.role === "admin";

    if (isAdmin && eventAdminActions) {
      eventAdminActions.hidden = false;
    }

    const events = await getEvents(isAdmin);

    renderEvents(events, isAdmin);
  } catch (error) {
    console.error(error);

    eventList.innerHTML = `
      <div class="panel">
        <h2>読み込みに失敗しました</h2>
        <p>
          イベントの読み込みに失敗しました。<br>
          Firestoreルールか、イベントの公開設定を確認してください。
        </p>
      </div>
    `;
  }
});

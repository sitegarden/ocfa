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
function setLoading(text) {
  if (!eventList) return;
  eventList.innerHTML = `
    <div class="panel">
      <p>${text}</p>
    </div>
  `;
}
function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}
function getStatusLabel(status) {
  if (status === "open") return "エントリー受付中";
  if (status === "closed") return "終了";
  if (status === "draft") return "下書き";
  return "準備中";
}
function getStatusPriority(status) {
  if (status === "open") return 1;
  if (status === "preparing") return 2;
  if (status === "closed") return 3;
  if (status === "draft") return 4;
  return 9;
}
function getEventSummary(data) {
  const text = String(data?.description || "").trim();
  if (!text) {
    return "詳細はイベントページで確認できます。";
  }
  if (text.length <= 110) {
    return text;
  }
  return `${text.slice(0, 110)}…`;
}
function formatDate(value) {
  if (!value?.toDate) return "";
  const date = value.toDate();
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
async function getUserData(user) {
  if (!user) return null;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;
  return snap.data();
}
async function getPublicEvents() {
  const eventsQuery = query(
    collection(db, "v2Events"),
    where("isDeleted", "==", false),
    where("isPublic", "==", true)
  );
  const snap = await getDocs(eventsQuery);
  const events = [];
  snap.forEach((docSnap) => {
    events.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });
  return events;
}
async function getAdminEvents() {
  const eventsQuery = query(
    collection(db, "v2Events"),
    where("isDeleted", "==", false)
  );
  const snap = await getDocs(eventsQuery);
  const events = [];
  snap.forEach((docSnap) => {
    events.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });
  return events;
}
function sortEvents(events) {
  return [...events].sort((a, b) => {
    const statusDiff =
      getStatusPriority(a.data.status) -
      getStatusPriority(b.data.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });
}
function renderEmpty(isAdmin) {
  eventList.innerHTML = `
    <div class="panel event-empty-panel">
      <p class="eyebrow">Events</p>
      <h2>開催中のイベントはありません</h2>
      <p>
        新しい企画が始まると、ここでお知らせします。
      </p>
      ${
        isAdmin
          ? `
            <div class="actions">
              <a class="primary-btn" href="/events/new/">
                イベントを作る
              </a>
            </div>
          `
          : ""
      }
    </div>
  `;
}
function renderEvents(events, isAdmin) {
  if (!eventList) return;
  if (events.length === 0) {
    renderEmpty(isAdmin);
    return;
  }
  const activeEvents = events.filter((event) => {
    return event.data.status === "open";
  });
  const otherEvents = events.filter((event) => {
    return event.data.status !== "open";
  });
  eventList.innerHTML = `
    ${
      activeEvents.length > 0
        ? `
          <section class="event-list-section">
            <div class="event-list-heading">
              <div>
                <p class="eyebrow">Now Open</p>
                <h2>エントリー受付中</h2>
              </div>
              <p class="mini-info">
                参加したいイベントを選んで、エントリーできます。
              </p>
            </div>
            <div class="event-grid">
              ${activeEvents
                .map(({ id, data }) => {
                  const createdAt = formatDate(data.createdAt);
                  return `
                    <article class="event-card event-card-open">
                      <a
                        class="event-card-link"
                        href="/events/file/?id=${encodeURIComponent(id)}"
                      >
                        <div class="event-card-body">
                          <p class="status-pill">
                            ${escapeHtml(getStatusLabel(data.status))}
                          </p>
                          <h3>${escapeHtml(data.title || "無題のイベント")}</h3>
                          <p class="event-description">
                            ${nl2br(getEventSummary(data))}
                          </p>
                          <div class="event-card-meta">
                            ${
                              createdAt
                                ? `<span>開始告知：${escapeHtml(createdAt)}</span>`
                                : ""
                            }
                            <span>詳細・エントリーへ</span>
                          </div>
                        </div>
                      </a>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
        `
        : ""
    }
    ${
      otherEvents.length > 0
        ? `
          <section class="event-list-section event-archive-section">
            <div class="event-list-heading">
              <div>
                <p class="eyebrow">Archive</p>
                <h2>イベントのお知らせ</h2>
              </div>
            </div>
            <div class="event-grid">
              ${otherEvents
                .map(({ id, data }) => {
                  const createdAt = formatDate(data.createdAt);
                  return `
                    <article class="event-card">
                      <a
                        class="event-card-link"
                        href="/events/file/?id=${encodeURIComponent(id)}"
                      >
                        <div class="event-card-body">
                          <p class="status-pill">
                            ${escapeHtml(getStatusLabel(data.status))}
                          </p>
                          <h3>${escapeHtml(data.title || "無題のイベント")}</h3>
                          <p class="event-description">
                            ${nl2br(getEventSummary(data))}
                          </p>
                          <div class="event-card-meta">
                            ${
                              createdAt
                                ? `<span>${escapeHtml(createdAt)}</span>`
                                : ""
                            }
                            ${
                              data.isPublic === false
                                ? `<span>管理者のみ表示</span>`
                                : `<span>詳細を見る</span>`
                            }
                          </div>
                        </div>
                      </a>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
        `
        : ""
    }
  `;
}
onAuthStateChanged(auth, async (user) => {
  try {
    setLoading("イベントを読み込んでいます...");
    const userData = await getUserData(user);
    const isAdmin = userData?.role === "admin";
    if (isAdmin && eventAdminActions) {
      eventAdminActions.hidden = false;
    }
    let events = [];
    if (isAdmin) {
      try {
        events = await getAdminEvents();
      } catch (error) {
        console.warn(
          "管理者用イベント取得に失敗。公開イベントだけ読み込みます。",
          error
        );
        events = await getPublicEvents();
      }
    } else {
      events = await getPublicEvents();
    }
    renderEvents(sortEvents(events), isAdmin);
  } catch (error) {
    console.error(error);
    if (!eventList) return;
    eventList.innerHTML = `
      <div class="panel">
        <h2>読み込みに失敗しました</h2>
        <p>
          イベントの読み込みに失敗しました。<br>
          少し時間を置いて、もう一度開いてみてください。
        </p>
        <div class="panel-soft">
          <p class="mini-info">
            エラー内容：${escapeHtml(error.message || String(error))}
          </p>
        </div>
      </div>
    `;
  }
});

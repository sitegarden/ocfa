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

const noticeList = document.getElementById("noticeList");
const noticeAdminActions = document.getElementById("noticeAdminActions");

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

function formatDate(timestamp) {
  if (!timestamp?.seconds) return "";

  const date = new Date(timestamp.seconds * 1000);

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

async function isAdminUser(user) {
  if (!user) return false;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return false;

  return snap.data().role === "admin";
}

async function getNotices(isAdmin) {
  const baseRef = collection(db, "v2Notices");

  const q = isAdmin
    ? query(
        baseRef,
        where("isDeleted", "==", false)
      )
    : query(
        baseRef,
        where("isDeleted", "==", false),
        where("isPublic", "==", true)
      );

  const snap = await getDocs(q);

  const notices = [];

  snap.forEach((docSnap) => {
    notices.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  notices.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  return notices;
}

function renderEmpty(isAdmin) {
  noticeList.innerHTML = `
    <div class="panel">
      <h2>お知らせはまだありません</h2>
      <p>更新情報やイベント案内があると、ここに表示されます。</p>

      ${
        isAdmin
          ? `
            <div class="actions">
              <a class="primary-btn" href="/notices/new/">最初のお知らせを書く</a>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderNotices(notices, isAdmin) {
  if (!noticeList) return;

  if (notices.length === 0) {
    renderEmpty(isAdmin);
    return;
  }

  noticeList.innerHTML = `
    <div class="notice-stack">
      ${notices
        .map(({ id, data }) => {
          const title = data.title || "無題のお知らせ";
          const body = data.body || "";

          return `
            <article class="notice-card panel">
              <a class="notice-card-link" href="/notices/file/?id=${encodeURIComponent(id)}">
                <div class="notice-card-head">
                  <div>
                    <p class="eyebrow">
                      ${data.isImportant ? "Important" : "News"}
                    </p>

                    <h2>${escapeHtml(title)}</h2>
                  </div>

                  ${
                    data.createdAt
                      ? `<p class="notice-date">${formatDate(data.createdAt)}</p>`
                      : ""
                  }
                </div>

                ${
                  data.isImportant
                    ? `<p class="status-pill">大切なお知らせ</p>`
                    : ""
                }

                <div class="notice-body">
                  ${
                    body
                      ? `<p>${nl2br(body)}</p>`
                      : `<p>本文はありません。</p>`
                  }
                </div>

                ${
                  data.isPublic === false
                    ? `<p class="mini-info">非公開のお知らせ</p>`
                    : ""
                }
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
    if (!noticeList) return;

    noticeList.innerHTML = `
      <div class="panel">
        <p>お知らせを読み込み中...</p>
      </div>
    `;

    const isAdmin = await isAdminUser(user);

    if (noticeAdminActions) {
      noticeAdminActions.hidden = !isAdmin;
    }

    const notices = await getNotices(isAdmin);

    renderNotices(notices, isAdmin);
  } catch (error) {
    console.error(error);

    if (!noticeList) return;

    noticeList.innerHTML = `
      <div class="panel">
        <h2>読み込みに失敗しました</h2>
        <p>ページを再読み込みしてみてください。</p>
      </div>
    `;
  }
});

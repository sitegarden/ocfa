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

function formatDate(timestamp) {
  if (!timestamp?.seconds) return "";

  const date = new Date(timestamp.seconds * 1000);

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function setAdminActionsVisible(isVisible) {
  if (!noticeAdminActions) return;

  noticeAdminActions.hidden = !isVisible;
  noticeAdminActions.style.display = isVisible ? "" : "none";
}

async function isAdminUser(user) {
  if (!user) return false;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return false;

  return snap.data().role === "admin";
}

async function getNewsList(isAdmin) {
  const newsRef = collection(db, "v2Notices");

  const noticesQuery = isAdmin
    ? query(
        newsRef,
        where("isDeleted", "==", false)
      )
    : query(
        newsRef,
        where("isDeleted", "==", false),
        where("isPublic", "==", true)
      );

  const snap = await getDocs(noticesQuery);
  const newsList = [];

  snap.forEach((docSnap) => {
    newsList.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  newsList.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;

    return bTime - aTime;
  });

  return newsList;
}

function renderLoading() {
  if (!noticeList) return;

  noticeList.innerHTML = `
    <div class="panel">
      <p>お知らせを読み込み中...</p>
    </div>
  `;
}

function renderEmpty() {
  if (!noticeList) return;

  noticeList.innerHTML = `
    <div class="panel">
      <h2>お知らせはまだありません</h2>
      <p>更新情報やイベント案内があると、ここに表示されます。</p>
    </div>
  `;
}

function renderError() {
  if (!noticeList) return;

  noticeList.innerHTML = `
    <div class="panel">
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
    </div>
  `;
}

function renderNews(newsList) {
  if (!noticeList) return;

  if (newsList.length === 0) {
    renderEmpty();
    return;
  }

  noticeList.innerHTML = `
    <div class="notice-stack">
      ${newsList
        .map(({ data }) => {
          const title = data.title || "無題のお知らせ";
          const body = data.body || "";
          const isImportant = data.isImportant === true;
          const isPrivate = data.isPublic === false;

          return `
            <article class="notice-card panel">
              <div class="notice-card-head">
                <div>
                  <p class="eyebrow">
                    ${isImportant ? "Important" : "News"}
                  </p>

                  <h2>${escapeHtml(title)}</h2>
                </div>

                ${
                  data.createdAt
                    ? `
                      <p class="notice-date">
                        ${escapeHtml(formatDate(data.createdAt))}
                      </p>
                    `
                    : ""
                }
              </div>

              ${
                isImportant
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
                isPrivate
                  ? `<p class="mini-info">非公開のお知らせ</p>`
                  : ""
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

onAuthStateChanged(auth, async (user) => {
  if (!noticeList) return;

  try {
    setAdminActionsVisible(false);
    renderLoading();

    const isAdmin = await isAdminUser(user);

    setAdminActionsVisible(isAdmin);

    const newsList = await getNewsList(isAdmin);

    renderNews(newsList);
  } catch (error) {
    console.error("お知らせ読み込みエラー:", error);

    setAdminActionsVisible(false);
    renderError();
  }
});

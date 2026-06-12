import { db } from "/firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const homeNoticeList = document.getElementById("homeNoticeList");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function trimText(text, maxLength = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();

  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength)}...`;
}

async function getLatestNotices() {
  const q = query(
    collection(db, "v2Notices"),
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

  return notices.slice(0, 3);
}

function renderNotices(notices) {
  if (!homeNoticeList) return;

  if (notices.length === 0) {
    homeNoticeList.innerHTML = `
      <div class="home-notice-empty">
        <p>お知らせはまだありません。</p>
      </div>
    `;
    return;
  }

  homeNoticeList.innerHTML = notices
    .map(({ data }) => {
      return `
        <article class="home-notice-card">
          <div class="home-notice-meta">
            ${
              data.isImportant
                ? `<span class="mini-badge">大切</span>`
                : `<span class="mini-badge soft">お知らせ</span>`
            }

            ${
              data.createdAt
                ? `<span>${formatDate(data.createdAt)}</span>`
                : ""
            }
          </div>

          <h3>${escapeHtml(data.title || "無題のお知らせ")}</h3>

          ${
            data.body
              ? `<p>${escapeHtml(trimText(data.body))}</p>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

async function initHomeNotices() {
  if (!homeNoticeList) return;

  try {
    const notices = await getLatestNotices();
    renderNotices(notices);
  } catch (error) {
    console.error(error);

    homeNoticeList.innerHTML = `
      <div class="home-notice-empty">
        <p>お知らせの読み込みに失敗しました。</p>
      </div>
    `;
  }
}

initHomeNotices();

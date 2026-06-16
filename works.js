import { db } from "/firebase.js";

import {
  collection,
  getDocs,
  limit,
  query
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const workList = document.getElementById("workList");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value?.toDate) return "";

  const date = value.toDate();

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function getWorkTypeLabel(type) {
  if (type === "shared") return "共有作品";
  return "自分専用";
}

function getJoinTypeLabel(type) {
  if (type === "free") return "自由参加";
  if (type === "approval") return "承認制";
  return "募集なし";
}

function renderEmpty() {
  workList.innerHTML = `
    <div class="empty-preview">
      まだ作品がありません。
    </div>
  `;
}

function createWorkCard(item) {
  const data = item.data;
  const workUrl = `/works/file/?id=${encodeURIComponent(item.id)}`;

  const card = document.createElement("article");
  card.className = "work-card";

  card.innerHTML = `
    <a class="work-link" href="${workUrl}">
      <div class="work-card-head">
        <span>${escapeHtml(getWorkTypeLabel(data.workType))}</span>
        ${
          data.workType === "shared"
            ? `<span>${escapeHtml(getJoinTypeLabel(data.joinType))}</span>`
            : ""
        }
      </div>

      <div class="work-card-body">
        <h2>${escapeHtml(data.title || "作品名未設定")}</h2>

        <p class="work-owner">
          by ${escapeHtml(data.ownerName || "作者名未設定")}
        </p>

        <p class="work-description">
          ${escapeHtml(data.description || "説明はまだありません。")}
        </p>

        <div class="work-stats">
          <span>キャラ ${Number(data.characterCount || 0)}</span>
          <span>FA ${Number(data.fanartCount || 0)}</span>
          ${
            data.createdAt
              ? `<span>${escapeHtml(formatDate(data.createdAt))}</span>`
              : ""
          }
        </div>

        <p class="primary-link fake-link">
          作品を見る
        </p>
      </div>
    </a>
  `;

  return card;
}

async function loadWorks() {
  try {
    const worksQuery = query(
      collection(db, "works"),
      limit(80)
    );

    const snap = await getDocs(worksQuery);

    if (snap.empty) {
      renderEmpty();
      return;
    }

    const works = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.isPublic !== true) return;
      if (data.isDeleted === true) return;

      works.push({
        id: docSnap.id,
        data
      });
    });

    if (works.length === 0) {
      renderEmpty();
      return;
    }

    works.sort((a, b) => {
      const aTime = a.data.createdAt?.toMillis?.() || 0;
      const bTime = b.data.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    workList.innerHTML = "";

    works.forEach((item) => {
      workList.appendChild(createWorkCard(item));
    });
  } catch (error) {
    console.error("作品一覧読み込みエラー:", error);

    workList.innerHTML = `
      <div class="empty-preview">
        作品一覧の読み込みに失敗しました。<br>
        ${escapeHtml(error.message || "")}
      </div>
    `;
  }
}

loadWorks();

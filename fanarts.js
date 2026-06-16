import { db } from "/firebase.js";

import {
  collection,
  getDocs,
  limit,
  query
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const fanartList = document.getElementById("fanartList");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getFanartImageSrc(data) {
  return data.imageUrl || data.imageData || "";
}

function formatDate(value) {
  if (!value?.toDate) return "";

  const date = value.toDate();

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function renderEmpty() {
  fanartList.innerHTML = `
    <div class="empty-preview">
      まだファンアートが投稿されていません。
    </div>
  `;
}

function createFanartCard(item) {
  const data = item.data;
  const imageSrc = getFanartImageSrc(data);

  const card = document.createElement("article");
  card.className = "fanart-card";

  card.innerHTML = `
    <div class="fanart-thumb">
      ${
        imageSrc
          ? `<img src="${imageSrc}" alt="${escapeHtml(data.characterName || "ファンアート")}">`
          : `<div class="no-image">No Image</div>`
      }
    </div>

    <div class="fanart-body">
      <div class="fanart-meta">
        <span>${data.imageSource === "upload" ? "画像投稿" : "お絵描き"}</span>
        ${
          data.createdAt
            ? `<span>${escapeHtml(formatDate(data.createdAt))}</span>`
            : ""
        }
      </div>

      <h2>${escapeHtml(data.characterName || "キャラ名未設定")}</h2>

      <p class="fanart-artist">
        by ${escapeHtml(data.artistName || "作者名未設定")}
      </p>

      <p class="fanart-comment">
        ${escapeHtml(data.comment || "コメントはありません。")}
      </p>

      <div class="button-row">
        ${
          data.characterId
            ? `<a class="primary-link" href="/characters/file/?id=${escapeHtml(data.characterId)}">この子を見る</a>`
            : ""
        }
      </div>
    </div>
  `;

  return card;
}

async function loadFanarts() {
  try {
    const fanartsQuery = query(
      collection(db, "v2Fanarts"),
      limit(80)
    );

    const snap = await getDocs(fanartsQuery);

    if (snap.empty) {
      renderEmpty();
      return;
    }

    const fanarts = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.isPublic !== true) return;
      if (data.isDeleted === true) return;

      fanarts.push({
        id: docSnap.id,
        data
      });
    });

    if (fanarts.length === 0) {
      renderEmpty();
      return;
    }

    fanarts.sort((a, b) => {
      const aTime = a.data.createdAt?.toMillis?.() || 0;
      const bTime = b.data.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    fanartList.innerHTML = "";

    fanarts.forEach((item) => {
      fanartList.appendChild(createFanartCard(item));
    });
  } catch (error) {
    console.error("ファンアート一覧読み込みエラー:", error);

    fanartList.innerHTML = `
      <div class="empty-preview">
        ファンアートの読み込みに失敗しました。<br>
        ${escapeHtml(error.message || "")}
      </div>
    `;
  }
}

loadFanarts();

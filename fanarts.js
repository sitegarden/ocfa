import { db } from "/firebase.js";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where
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

async function loadFanarts() {
  const fanartsQuery = query(
    collection(db, "v2Fanarts"),
    where("isPublic", "==", true),
    where("isDeleted", "==", false),
    orderBy("createdAt", "desc"),
    limit(60)
  );

  const snap = await getDocs(fanartsQuery);

  if (snap.empty) {
    fanartList.innerHTML = `
      <div class="empty-preview">
        まだファンアートが投稿されていません。
      </div>
    `;

    return;
  }

  fanartList.innerHTML = "";

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const imageSrc = getFanartImageSrc(data);

    const card = document.createElement("article");
    card.className = "character-card";

    card.innerHTML = `
      <a class="character-link" href="/characters/file/?id=${escapeHtml(data.characterId || "")}">
        <div class="character-thumb">
          ${
            imageSrc
              ? `<img class="character-img" src="${imageSrc}" alt="${escapeHtml(data.characterName || "ファンアート")}">`
              : `<div class="no-image">No Image</div>`
          }
        </div>

        <div class="character-body">
          <h2>${escapeHtml(data.characterName || "キャラ名未設定")}</h2>

          <p class="character-profile">
            ${escapeHtml(data.comment || "コメントはありません。")}
          </p>

          <p class="character-kana">
            by ${escapeHtml(data.artistName || "作者名未設定")}
          </p>

          <div class="character-tags">
            <span>${data.imageSource === "upload" ? "画像投稿" : "お絵描き"}</span>
            ${
              data.createdAt
                ? `<span>${escapeHtml(formatDate(data.createdAt))}</span>`
                : ""
            }
          </div>
        </div>
      </a>
    `;

    fanartList.appendChild(card);
  });
}

loadFanarts().catch((error) => {
  console.error(error);

  fanartList.innerHTML = `
    <div class="empty-preview">
      ファンアートの読み込みに失敗しました。
    </div>
  `;
});

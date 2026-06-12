import { db } from "/firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const characterList = document.getElementById("characterList");

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadCharacters() {
  const q = query(
  collection(db, "v2Characters"),
  where("isDeleted", "==", false),
  where("isPublic", "==", true)
);

  const snap = await getDocs(q);

  if (snap.empty) {
    characterList.innerHTML = `
      <div class="panel">
        <h2>まだキャラが登録されていません</h2>
        <p>まずは絵を描いて、気に入った下書きをキャラとして登録してみてください。</p>
        <div class="actions">
          <a class="primary-btn" href="/draw/">絵を描く</a>
        </div>
      </div>
    `;
    return;
  }

  const characters = [];

  snap.forEach((docSnap) => {
    characters.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  characters.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  characterList.innerHTML = "";

  characters.forEach((item) => {
    const character = item.data;
    const characterId = item.id;

    const card = document.createElement("article");
    card.className = "character-card";

    const name = character.name || "名前未設定";
    const imageData = character.imageData || "";
    const profile = character.profile || "プロフィールはまだありません。";

    const tags = Array.isArray(character.tags)
      ? character.tags
          .map((tag) => `<span>${escapeHtml(tag)}</span>`)
          .join("")
      : "";

    card.innerHTML = `
      <a class="character-card-link" href="/characters/file/?id=${encodeURIComponent(characterId)}">
        ${
          imageData
            ? `<img src="${imageData}" alt="${escapeHtml(name)}">`
            : `<div class="character-no-image">No Image</div>`
        }

        <div class="character-body">
          <h2>${escapeHtml(name)}</h2>

          ${
            character.kana
              ? `<p class="mini-info">${escapeHtml(character.kana)}</p>`
              : ""
          }

          <p class="character-card-desc">
            ${escapeHtml(profile)}
          </p>

          <div class="tag-list">
            ${tags}
          </div>

          <p class="mini-info">
            ${character.faOk ? "ファンアート歓迎" : "ファンアートは要確認"}
          </p>
        </div>
      </a>
    `;

    characterList.appendChild(card);
  });
}

loadCharacters().catch((error) => {
  console.error(error);

  characterList.innerHTML = `
    <div class="panel">
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
      <p class="mini-info">${escapeHtml(error.message)}</p>
    </div>
  `;
});

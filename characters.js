import { db } from "./firebase.js";

import {
  collection,
  getDocs,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const characterList = document.getElementById("characterList");

async function loadCharacters() {
  const q = query(
    collection(db, "v2Characters"),
    where("isDeleted", "==", false),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    characterList.innerHTML = `<p>まだキャラがいないぞ。最初の1人、作っちまえ。</p>`;
    return;
  }

  characterList.innerHTML = "";

  snap.forEach((docSnap) => {
    const chara = docSnap.data();

    const card = document.createElement("article");
    card.className = "character-card";

    const tags = Array.isArray(chara.tags)
      ? chara.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")
      : "";

    card.innerHTML = `
      <img src="${chara.imageData}" alt="${escapeHtml(chara.name)}" />
      <div class="character-body">
        <h2>${escapeHtml(chara.name)}</h2>
        <p>${escapeHtml(chara.profile || "プロフィール未設定")}</p>

        <div class="tag-list">
          ${tags}
        </div>

        <p class="mini-info">
          ${chara.faOk ? "FA歓迎" : "FA要確認"}
        </p>
      </div>
    `;

    characterList.appendChild(card);
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadCharacters().catch((error) => {
  console.error(error);
  characterList.innerHTML = `<p>読み込みに失敗した。Firestoreルールかindexが怪しい。</p>`;
});

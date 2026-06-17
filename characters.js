import { db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const characterList = document.getElementById("characterList");

const DEFAULT_THEME = {
  bgColor: "#fff7fb",
  mainColor: "#ff7ab6",
  subColor: "#8bc6ff",
  textColor: "#3a2d35",
  cardColor: "#ffffff"
};

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTheme(character) {
  return {
    ...DEFAULT_THEME,
    ...(character.customTheme || {})
  };
}

function getImageSrc(character) {
  if (character.imageSource === "upload" && character.imageUrl) {
    return character.imageUrl;
  }

  if (character.imageData) {
    return character.imageData;
  }

  return "";
}

async function getOwnerName(userId) {
  if (!userId) return "作者不明";

  try {
    const userSnap = await getDoc(doc(db, "users", userId));

    if (!userSnap.exists()) return "作者不明";

    const userData = userSnap.data();

    return (
      userData.displayName ||
      userData.name ||
      userData.nickname ||
      "作者不明"
    );
  } catch (error) {
    console.error(error);
    return "作者不明";
  }
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
      <div class="characters-empty">
        <h2>まだキャラが登録されていません</h2>
        <p>まずは絵を描いて、気に入った下書きをキャラとして登録してみてください。</p>
        <a class="primary-btn" href="/draw/">絵を描く</a>
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

  for (const item of characters) {
    const character = item.data;
    const characterId = item.id;

    const name = character.name || "名前未設定";
    const kana = character.kana || "";
    const imageSrc = getImageSrc(character);
    const ownerName = await getOwnerName(character.userId);
    const theme = getTheme(character);

    const card = document.createElement("article");
    card.className = "character-list-card";

    card.style.setProperty("--card-bg", theme.bgColor);
    card.style.setProperty("--card-main", `${theme.mainColor}33`);
    card.style.setProperty("--card-sub", `${theme.subColor}3d`);
    card.style.setProperty("--card-main-solid", theme.mainColor);
    card.style.setProperty("--card-text", theme.textColor);
    card.style.setProperty("--card-inner", theme.cardColor);

    card.innerHTML = `
      <a class="character-list-link" href="/characters/file/?id=${encodeURIComponent(characterId)}">
        <div class="character-list-image-wrap">
          ${
            imageSrc
              ? `<img class="character-list-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(name)}">`
              : `<div class="character-list-no-image">No Image</div>`
          }
        </div>

        <div class="character-list-body">
          <span class="character-list-label">Character</span>

          <h2 class="character-list-name">${escapeHtml(name)}</h2>

          ${
            kana
              ? `<p class="character-list-kana">${escapeHtml(kana)}</p>`
              : `<p class="character-list-kana">ふりがな未設定</p>`
          }

          <p class="character-list-owner">
            作者：<span>${escapeHtml(ownerName)}</span>
          </p>
        </div>
      </a>
    `;

    characterList.appendChild(card);
  }
}

loadCharacters().catch((error) => {
  console.error(error);

  characterList.innerHTML = `
    <div class="characters-error">
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
});

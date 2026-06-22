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

const PAGE_SIZE = 30;

const DEFAULT_THEME = {
  bgColor: "#fff7fb",
  mainColor: "#ff7ab6",
  subColor: "#8bc6ff",
  textColor: "#3a2d35",
  cardColor: "#ffffff",
  radius: "24",
  pattern: "dot"
};

let allCharacters = [];
let displayedCount = 0;

const ownerNameCache = new Map();

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

function hasCustomTheme(character) {
  const theme = character.customTheme;

  if (!theme || typeof theme !== "object") {
    return false;
  }

  return Boolean(
    theme.bgColor ||
    theme.mainColor ||
    theme.subColor ||
    theme.textColor ||
    theme.cardColor ||
    theme.radius ||
    theme.pattern
  );
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

function getLoadMoreArea() {
  let area = document.getElementById("characterLoadMoreArea");

  if (area) return area;

  area = document.createElement("div");
  area.id = "characterLoadMoreArea";
  area.className = "character-load-more-area";

  characterList.insertAdjacentElement("afterend", area);

  return area;
}

function renderLoadMoreButton() {
  const area = getLoadMoreArea();
  const hasMore = displayedCount < allCharacters.length;

  if (!hasMore) {
    area.innerHTML = "";
    return;
  }

  const remaining = allCharacters.length - displayedCount;
  const nextCount = Math.min(PAGE_SIZE, remaining);

  area.innerHTML = `
    <button
      id="loadMoreCharactersBtn"
      class="ghost-btn character-load-more-btn"
      type="button"
    >
      もっと見る（あと${nextCount}件）
    </button>
  `;

  document
    .getElementById("loadMoreCharactersBtn")
    ?.addEventListener("click", () => {
      renderNextCharacters();
    });
}

async function getOwnerInfo(userId) {
  if (!userId) {
    return {
      name: "作者不明",
      photoURL: ""
    };
  }

  if (ownerNameCache.has(userId)) {
    return ownerNameCache.get(userId);
  }

  try {
    const userSnap = await getDoc(doc(db, "users", userId));

    if (!userSnap.exists()) {
      const ownerInfo = {
        name: "作者不明",
        photoURL: ""
      };

      ownerNameCache.set(userId, ownerInfo);

      return ownerInfo;
    }

    const userData = userSnap.data();

    const ownerInfo = {
      name:
        userData.displayName ||
        userData.name ||
        userData.nickname ||
        "作者不明",

      photoURL:
        userData.photoURL ||
        userData.iconImageData ||
        ""
    };

    ownerNameCache.set(userId, ownerInfo);

    return ownerInfo;

  } catch (error) {
    console.error(error);

    const ownerInfo = {
      name: "作者不明",
      photoURL: ""
    };

    ownerNameCache.set(userId, ownerInfo);

    return ownerInfo;
  }
}

function createCharacterCard(characterId, character, ownerInfo, isNewestForOwner) {
  const name = character.name || "名前未設定";
  const kana = character.kana || "";
  const imageSrc = getImageSrc(character);

  const tags = Array.isArray(character.tags)
  ? character.tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .slice(0, 2)
  : [];

const theme = getTheme(character);
const isCustomTheme = hasCustomTheme(character);

const card = document.createElement("article");

card.className = [
  "character-list-card",
  isCustomTheme ? "has-custom-theme" : "is-default-theme",
  `character-pattern-${theme.pattern || "dot"}`
].join(" ");

card.style.setProperty("--card-bg", theme.bgColor);
card.style.setProperty("--card-main", `${theme.mainColor}33`);
card.style.setProperty("--card-sub", `${theme.subColor}3d`);
card.style.setProperty("--card-main-solid", theme.mainColor);
card.style.setProperty("--card-text", theme.textColor);
card.style.setProperty("--card-inner", theme.cardColor);
card.style.setProperty("--card-radius", `${Number(theme.radius) || 24}px`);
  
  card.innerHTML = `
    <a
      class="character-list-link"
      href="/characters/file/?id=${encodeURIComponent(characterId)}"
    >
      <div class="character-list-image-wrap">
  ${
    isNewestForOwner
      ? `<span class="character-list-new">NEW</span>`
      : ""
  }

  ${
    imageSrc
            ? `
              <img
                class="character-list-image"
                src="${escapeHtml(imageSrc)}"
                alt="${escapeHtml(name)}"
              >
            `
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

        ${
  tags.length > 0
    ? `
      <div class="character-list-tags">
        ${tags
          .map(
            (tag) => `
              <span class="character-list-tag">
                #${escapeHtml(tag)}
              </span>
            `
          )
          .join("")}
      </div>
    `
    : ""
}

        <div class="character-list-owner">
  <span class="character-list-owner-label">作者</span>

  <span class="character-list-owner-info">
    ${
      ownerInfo.photoURL
        ? `
          <img
            class="character-list-owner-icon"
            src="${escapeHtml(ownerInfo.photoURL)}"
            alt=""
          >
        `
        : `
          <span class="character-list-owner-placeholder">
            ${escapeHtml(ownerInfo.name.slice(0, 1) || "？")}
          </span>
        `
    }

    <span class="character-list-owner-name">
      ${escapeHtml(ownerInfo.name)}
    </span>
  </span>
</div>
      </div>
    </a>
  `;

  return card;
}

async function renderNextCharacters() {
  const nextCharacters = allCharacters.slice(
    displayedCount,
    displayedCount + PAGE_SIZE
  );

  if (nextCharacters.length === 0) {
    renderLoadMoreButton();
    return;
  }

  const area = getLoadMoreArea();

  area.innerHTML = `
    <p class="character-load-status">読み込み中...</p>
  `;

  const newestCharacterIdsByOwner = new Set();
  const seenUserIds = new Set();

  for (const item of allCharacters) {
    const userId = item.data.userId || "";

    if (!userId || seenUserIds.has(userId)) {
      continue;
    }

    seenUserIds.add(userId);
    newestCharacterIdsByOwner.add(item.id);
  }

  const ownerInfos = await Promise.all(
    nextCharacters.map((item) => getOwnerInfo(item.data.userId))
  );

  nextCharacters.forEach((item, index) => {
    const card = createCharacterCard(
      item.id,
      item.data,
      ownerInfos[index],
      newestCharacterIdsByOwner.has(item.id)
    );

    characterList.appendChild(card);
  });

  displayedCount += nextCharacters.length;

  renderLoadMoreButton();
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
        <p>承認されたクリエイターのキャラクターが、ここに追加されます。</p>
        <a class="primary-btn" href="/characters/new/">キャラ登録について見る</a>
      </div>
    `;

    getLoadMoreArea().innerHTML = "";
    return;
  }

  allCharacters = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data()
  }));

  allCharacters.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;

    return bTime - aTime;
  });

  displayedCount = 0;
  characterList.innerHTML = "";

  await renderNextCharacters();
}

loadCharacters().catch((error) => {
  console.error(error);

  characterList.innerHTML = `
    <div class="characters-error">
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
      <p>${escapeHtml(error.message || "")}</p>
    </div>
  `;
});

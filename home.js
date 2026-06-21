import { auth, db } from "/firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const homeNoticeList = document.getElementById("homeNoticeList");
const homeCharacterList = document.getElementById("homeCharacterList");

const homeOcImage = document.getElementById("homeOcImage");
const homeOcFallback = document.getElementById("homeOcFallback");

const HOME_CHARACTER_COUNT = 6;

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

function getCharacterImage(data) {
  return data?.imageUrl || data?.imageData || "";
}

function showHomeCharacterImage(imageUrl, name) {
  if (!homeOcImage) return;

  homeOcImage.src = imageUrl;
  homeOcImage.alt = `${name || "キャラクター"}のイラスト`;
  homeOcImage.hidden = false;

  if (homeOcFallback) {
    homeOcFallback.hidden = true;
  }
}

function showHomeCharacterFallback() {
  if (homeOcImage) {
    homeOcImage.hidden = true;
    homeOcImage.src = "";
  }

  if (homeOcFallback) {
    homeOcFallback.hidden = false;
  }
}

function pickRandom(items) {
  if (items.length === 0) return null;

  const index = Math.floor(Math.random() * items.length);

  return items[index];
}

async function loadMyRandomCharacter(user) {
  if (!user) {
    showHomeCharacterFallback();
    return;
  }

  const charactersQuery = query(
    collection(db, "v2Characters"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(charactersQuery);
  const characters = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const image = getCharacterImage(data);

    if (!image) return;

    characters.push({
      id: docSnap.id,
      data,
      image
    });
  });

  if (characters.length === 0) {
    showHomeCharacterFallback();
    return;
  }

  const randomCharacter = pickRandom(characters);

  showHomeCharacterImage(
    randomCharacter.image,
    randomCharacter.data.name
  );
}

async function loadHomeNotices() {
  if (!homeNoticeList) return;

  try {
    const noticesQuery = query(
      collection(db, "v2Notices"),
      where("isDeleted", "==", false),
      where("isPublic", "==", true)
    );

    const snap = await getDocs(noticesQuery);

    if (snap.empty) {
      homeNoticeList.innerHTML = `
        <div class="panel-soft">
          <p>まだお知らせはありません。</p>
        </div>
      `;
      return;
    }

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

    const latestNotices = notices.slice(0, 3);

    homeNoticeList.innerHTML = latestNotices
      .map(({ data }) => {
        const body = data.body || "";

        const shortBody =
          body.length > 80
            ? `${body.slice(0, 80)}...`
            : body;

        return `
          <article class="home-notice-card">
            <a href="/notices/" class="home-notice-link">
              <div class="home-notice-body">
                <p class="mini-info">
                  ${data.isImportant ? "重要" : "お知らせ"}
                </p>

                <h3>${escapeHtml(data.title || "無題")}</h3>

                <p>${nl2br(shortBody)}</p>
              </div>
            </a>
          </article>
        `;
      })
      .join("");

  } catch (error) {
    console.error("トップお知らせ読み込みエラー:", error);

    homeNoticeList.innerHTML = `
      <div class="panel-soft">
        <p>お知らせの読み込みに失敗しました。</p>
      </div>
    `;
  }
}

async function loadLatestCharacters() {
  if (!homeCharacterList) return;

  try {
    const charactersQuery = query(
      collection(db, "v2Characters"),
      where("isDeleted", "==", false),
      where("isPublic", "==", true)
    );

    const snap = await getDocs(charactersQuery);

    if (snap.empty) {
      homeCharacterList.innerHTML = `
        <div class="panel-soft">
          <p>まだ公開キャラクターはいません。</p>
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

    const latestCharacters = characters.slice(0, HOME_CHARACTER_COUNT);

    homeCharacterList.innerHTML = latestCharacters
      .map(({ id, data }) => {
        const name = data.name || "名前未設定";
        const kana = data.kana || "";
        const imageUrl = getCharacterImage(data);

        return `
          <article class="home-character-card">
            <a
              class="home-character-link"
              href="/characters/file/?id=${encodeURIComponent(id)}"
            >
              <div class="home-character-image-wrap">
                <span class="home-character-new">NEW</span>

                ${
                  imageUrl
                    ? `
                      <img
                        class="home-character-image"
                        src="${escapeHtml(imageUrl)}"
                        alt="${escapeHtml(name)}"
                      >
                    `
                    : `
                      <div class="home-character-no-image">
                        No Image
                      </div>
                    `
                }
              </div>

              <div>
                <h3 class="home-character-name">
                  ${escapeHtml(name)}
                </h3>

                ${
                  kana
                    ? `
                      <p class="home-character-kana">
                        ${escapeHtml(kana)}
                      </p>
                    `
                    : ""
                }
              </div>
            </a>
          </article>
        `;
      })
      .join("");

  } catch (error) {
    console.error("トップ最新キャラ読み込みエラー:", error);

    homeCharacterList.innerHTML = `
      <div class="panel-soft">
        <p>キャラクターの読み込みに失敗しました。</p>
      </div>
    `;
  }
}

loadHomeNotices();
loadLatestCharacters();

onAuthStateChanged(auth, (user) => {
  loadMyRandomCharacter(user);
});

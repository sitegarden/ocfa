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
const homeOcImage = document.getElementById("homeOcImage");
const homeOcFallback = document.getElementById("homeOcFallback");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

function showHomeCharacterImage(imageData, name) {
  if (!homeOcImage) return;

  homeOcImage.src = imageData;
  homeOcImage.alt = `${name || "キャラクター"} のイラスト`;
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
  if (!items.length) return null;

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

async function loadMyRandomCharacter(user) {
  if (!user) {
    showHomeCharacterFallback();
    return;
  }

  const q = query(
    collection(db, "v2Characters"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  const characters = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (!data.imageData) return;

    characters.push({
      id: docSnap.id,
      data
    });
  });

  if (characters.length === 0) {
    showHomeCharacterFallback();
    return;
  }

  const randomCharacter = pickRandom(characters);

  showHomeCharacterImage(
    randomCharacter.data.imageData,
    randomCharacter.data.name
  );
}

async function loadHomeNotices() {
  if (!homeNoticeList) return;

  try {
    const q = query(
      collection(db, "v2Notices"),
      where("isDeleted", "==", false),
      where("isPublic", "==", true)
    );

    const snap = await getDocs(q);

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
      .map(({ id, data }) => {
        const body = data.body || "";
        const shortBody =
          body.length > 80
            ? `${body.slice(0, 80)}...`
            : body;

        return `
          <article class="home-notice-card">
            <a href="/news/" class="home-notice-link">
              <div class="home-notice-body">
                <p class="mini-info">${data.isImportant ? "重要" : "お知らせ"}</p>
                <h3>${escapeHtml(data.title || "無題")}</h3>
                <p>${nl2br(shortBody)}</p>
              </div>
            </a>
          </article>
        `;
      })
      .join("");
  } catch (error) {
    console.error(error);

    homeNoticeList.innerHTML = `
      <div class="panel-soft">
        <p>お知らせの読み込みに失敗しました。</p>
      </div>
    `;
  }
}

loadHomeNotices();

onAuthStateChanged(auth, (user) => {
  loadMyRandomCharacter(user);
});

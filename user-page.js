import { db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const userPageContent = document.getElementById("userPageContent");

const params = new URLSearchParams(location.search);
const userId = params.get("id");

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

async function getUserData() {
  if (!userId) return null;

  const userRef = doc(db, "users", userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getPublicCharacters() {
  if (!userId) return [];

  const q = query(
    collection(db, "v2Characters"),
    where("userId", "==", userId),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  const characters = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.isPublic !== true) return;

    characters.push({
      id: docSnap.id,
      data
    });
  });

  characters.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  return characters;
}

function renderIcon(userData) {
  const displayName = userData.displayName || "名無し";
  const photoURL = userData.photoURL || "";

  if (photoURL && photoURL.startsWith("https://")) {
    return `
      <div class="user-page-icon">
        <img src="${photoURL}" alt="${escapeHtml(displayName)}" referrerpolicy="no-referrer">
      </div>
    `;
  }

  return `
    <div class="user-page-icon">
      <span>${escapeHtml(displayName.slice(0, 1))}</span>
    </div>
  `;
}

function renderCharacterCards(characters) {
  if (characters.length === 0) {
    return `
      <div class="panel-soft">
        <p>公開キャラクターはまだありません。</p>
      </div>
    `;
  }

  return `
    <div class="character-list">
      ${characters
        .map(({ id, data }) => {
          const tags = Array.isArray(data.tags)
            ? data.tags
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join("")
            : "";

          return `
            <article class="character-card">
              <a class="character-card-link" href="/characters/file/?id=${encodeURIComponent(id)}">
                <img
                  src="${data.imageData}"
                  alt="${escapeHtml(data.name || "キャラクター")}"
                >

                <div class="character-body">
                  <h2>${escapeHtml(data.name || "名前未設定")}</h2>

                  ${
                    data.kana
                      ? `<p class="mini-info">${escapeHtml(data.kana)}</p>`
                      : ""
                  }

                  <div class="tag-list">
                    ${tags}
                  </div>

                  <p class="mini-info">
                    ${data.faOk ? "ファンアート歓迎" : "ファンアート要確認"}
                  </p>
                </div>
              </a>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderUserPage(user, characters) {
  const data = user.data;

  const displayName = data.displayName || "名無し";
  const profileText = data.profileText || "";
  const genreText = data.genreText || "";
  const linkUrl = data.linkUrl || "";

  userPageContent.innerHTML = `
    <section class="user-profile-box panel">
      <div class="user-profile-main">
        ${renderIcon(data)}

        <div class="user-profile-body">
          <p class="eyebrow">User Page</p>
          <h1>${escapeHtml(displayName)}</h1>

          <p class="mini-info">
            公開キャラ ${characters.length}体
          </p>

          ${
            profileText
              ? `<p class="user-profile-text">${nl2br(profileText)}</p>`
              : `<p class="user-profile-text muted-text">プロフィールはまだありません。</p>`
          }

          ${
            genreText
              ? `
                <div class="tag-list">
                  <span>${escapeHtml(genreText)}</span>
                </div>
              `
              : ""
          }

          ${
            linkUrl && linkUrl.startsWith("https://")
              ? `
                <p class="mini-info">
                  <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">
                    登録リンクを開く
                  </a>
                </p>
              `
              : ""
          }
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Characters</p>
          <h2>公開キャラクター</h2>
        </div>
      </div>

      ${renderCharacterCards(characters)}
    </section>
  `;
}

function renderNoUserId() {
  userPageContent.innerHTML = `
    <section class="panel">
      <h1>ユーザーが選ばれていません</h1>
      <p>URLが正しいか確認してください。</p>

      <div class="actions">
        <a class="ghost-btn" href="/">トップへ戻る</a>
      </div>
    </section>
  `;
}

function renderNotFound() {
  userPageContent.innerHTML = `
    <section class="panel">
      <h1>ユーザーが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>

      <div class="actions">
        <a class="ghost-btn" href="/">トップへ戻る</a>
      </div>
    </section>
  `;
}

function renderError(error) {
  console.error(error);

  userPageContent.innerHTML = `
    <section class="panel">
      <h1>読み込みに失敗しました</h1>
      <p>ページを再読み込みしてみてください。</p>
    </section>
  `;
}

async function init() {
  if (!userId) {
    renderNoUserId();
    return;
  }

  userPageContent.innerHTML = `
    <section class="panel">
      <p>ユーザーページを読み込んでいます...</p>
    </section>
  `;

  try {
    const user = await getUserData();

    if (!user) {
      renderNotFound();
      return;
    }

    const characters = await getPublicCharacters();

    renderUserPage(user, characters);
  } catch (error) {
    renderError(error);
  }
}

init();

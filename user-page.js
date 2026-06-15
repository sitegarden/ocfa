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

function getDisplayName(userData) {
  return userData.displayName || "名無し";
}

function getCharacterImage(data) {
  return data.imageUrl || data.imageData || "";
}

function renderUserIcon(userData, className = "user-page-icon") {
  const displayName = getDisplayName(userData);
  const iconImage = userData.iconImageData || userData.photoURL || "";

  if (iconImage) {
    return `
      <div class="${className}">
        <img src="${escapeHtml(iconImage)}" alt="${escapeHtml(displayName)}">
      </div>
    `;
  }

  return `
    <div class="${className}">
      <span>${escapeHtml(displayName.slice(0, 1) || "？")}</span>
    </div>
  `;
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

async function getPublicUsers() {
  const snap = await getDocs(collection(db, "users"));
  const users = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.isDeleted === true) return;
    if (data.isPublic === false) return;

    users.push({
      id: docSnap.id,
      data
    });
  });

  users.sort((a, b) => {
    const aTime = a.data.updatedAt?.seconds || a.data.createdAt?.seconds || 0;
    const bTime = b.data.updatedAt?.seconds || b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  return users;
}

async function getPublicCharacters(targetUserId = userId) {
  if (!targetUserId) return [];

  const q = query(
    collection(db, "v2Characters"),
    where("userId", "==", targetUserId),
    where("isDeleted", "==", false),
    where("isPublic", "==", true)
  );

  const snap = await getDocs(q);
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

  return characters;
}

async function getPublicCharacterCounts(users) {
  const counts = {};

  await Promise.all(
    users.map(async (user) => {
      const characters = await getPublicCharacters(user.id);
      counts[user.id] = characters.length;
    })
  );

  return counts;
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
          const image = getCharacterImage(data);

          const tags = Array.isArray(data.tags)
            ? data.tags
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join("")
            : "";

          return `
            <article class="character-card">
              <a class="character-card-link" href="/characters/file/?id=${encodeURIComponent(id)}">
                ${
                  image
                    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(data.name || "キャラクター画像")}">`
                    : `<div class="character-card-noimage">No Image</div>`
                }

                <div class="character-body">
                  <h2>${escapeHtml(data.name || "名前未設定")}</h2>

                  ${
                    data.kana
                      ? `<p class="mini-info">${escapeHtml(data.kana)}</p>`
                      : ""
                  }

                  ${
                    tags
                      ? `<div class="tag-list">${tags}</div>`
                      : ""
                  }

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

function renderUserList(users, characterCounts) {
  if (!userPageContent) return;

  if (users.length === 0) {
    userPageContent.innerHTML = `
      <section class="page-head user-public-hero">
        <p class="eyebrow">Users</p>
        <h1>公開ユーザー</h1>
        <p>まだ公開ユーザーはいません。</p>

        <div class="actions">
          <a class="ghost-btn" href="/">トップへ戻る</a>
        </div>
      </section>
    `;
    return;
  }

  userPageContent.innerHTML = `
    <section class="page-head user-public-hero">
      <p class="eyebrow">Users</p>
      <h1>公開ユーザー</h1>
      <p class="lead">プロフィールを公開しているユーザーだけ表示しています。</p>
    </section>

    <section class="user-list-grid">
      ${users
        .map((user) => {
          const data = user.data;
          const displayName = getDisplayName(data);
          const profileText = data.profileText || "";
          const genreText = data.genreText || "";
          const publicCharacterCount = characterCounts[user.id] || 0;

          return `
            <article class="user-list-card">
              <a class="user-list-card-link" href="/users/?id=${encodeURIComponent(user.id)}">
                ${renderUserIcon(data, "user-list-icon")}

                <div class="user-list-body">
                  <h2>${escapeHtml(displayName)}</h2>
                  <p class="mini-info">公開キャラ ${publicCharacterCount}体</p>

                  ${
                    profileText
                      ? `
                        <p class="user-list-profile">
                          ${escapeHtml(profileText).slice(0, 90)}
                          ${profileText.length > 90 ? "..." : ""}
                        </p>
                      `
                      : `<p class="user-list-profile">プロフィールはまだありません。</p>`
                  }

                  ${
                    genreText
                      ? `<p class="mini-info">${escapeHtml(genreText)}</p>`
                      : ""
                  }

                  <span class="ghost-btn user-list-more">ページを見る</span>
                </div>
              </a>
            </article>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderUserPage(user, characters) {
  if (!userPageContent) return;

  const data = user.data;

  if (data.isDeleted === true || data.isPublic === false) {
    renderNotFound();
    return;
  }

  const displayName = getDisplayName(data);
  const profileText = data.profileText || "";
  const genreText = data.genreText || "";
  const linkUrl = data.linkUrl || "";

  userPageContent.innerHTML = `
    <section class="page-head user-public-hero">
      <div class="user-profile-main">
        ${renderUserIcon(data)}

        <div>
          <p class="eyebrow">User Page</p>
          <h1>${escapeHtml(displayName)}</h1>
          <p class="mini-info">公開キャラ ${characters.length}体</p>
        </div>
      </div>
    </section>

    <section class="panel user-profile-box">
      <h2>プロフィール</h2>

      ${
        profileText
          ? `<p>${nl2br(profileText)}</p>`
          : `<p>プロフィールはまだありません。</p>`
      }

      ${
        genreText
          ? `
            <div class="panel-soft">
              <h3>好きな創作ジャンル</h3>
              <p>${nl2br(genreText)}</p>
            </div>
          `
          : ""
      }

      ${
        linkUrl && linkUrl.startsWith("https://")
          ? `
            <div class="actions">
              <a class="text-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">
                登録リンクを開く
              </a>
            </div>
          `
          : ""
      }

      <div class="actions">
        <a class="ghost-btn" href="/users/">ユーザー一覧へ</a>
      </div>
    </section>

    <section class="user-characters-head">
      <p class="eyebrow">Characters</p>
      <h2>公開キャラクター</h2>
    </section>

    ${renderCharacterCards(characters)}
  `;
}

function renderNotFound() {
  if (!userPageContent) return;

  userPageContent.innerHTML = `
    <section class="panel">
      <h1>ユーザーが見つかりませんでした</h1>
      <p>削除されたか、非公開になっている可能性があります。</p>

      <div class="actions">
        <a class="ghost-btn" href="/users/">ユーザー一覧へ</a>
        <a class="ghost-btn" href="/">トップへ戻る</a>
      </div>
    </section>
  `;
}

function renderError(error) {
  console.error(error);

  if (!userPageContent) return;

  userPageContent.innerHTML = `
    <section class="panel">
      <h1>読み込みに失敗しました</h1>
      <p>ページを再読み込みしてみてください。</p>
    </section>
  `;
}

async function initUserList() {
  if (!userPageContent) return;

  userPageContent.innerHTML = `
    <section class="panel">
      <p>ユーザー一覧を読み込んでいます...</p>
    </section>
  `;

  try {
    const users = await getPublicUsers();
    const characterCounts = await getPublicCharacterCounts(users);

    renderUserList(users, characterCounts);
  } catch (error) {
    renderError(error);
  }
}

async function initUserDetail() {
  if (!userPageContent) return;

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

    const characters = await getPublicCharacters(user.id);

    renderUserPage(user, characters);
  } catch (error) {
    renderError(error);
  }
}

async function init() {
  if (userId) {
    await initUserDetail();
    return;
  }

  await initUserList();
}

init();
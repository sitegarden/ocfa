import { auth, db } from "/firebase.js";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const userPageContent = document.getElementById("userPageContent");

const params = new URLSearchParams(location.search);
const rawUserId = params.get("id");

let currentViewer = null;

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

function normalizeHandle(handle) {
  return String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function getDisplayName(userData) {
  return userData.displayName || "名無し";
}

function getUserBadges(userData) {
  const badges = [];

  if (userData.officialLevel === "official") {
    badges.push({
      className: "user-badge-official",
      label: "公式"
    });
  }

  if (userData.officialLevel === "sample") {
    badges.push({
      className: "user-badge-sample",
      label: "公式サンプル"
    });
  }

  if (userData.uploadAllowed === true) {
    badges.push({
      className: "user-badge-upload",
      label: "アップロード許可"
    });
  }

  return badges;
}

function renderUserBadges(userData) {
  const badges = getUserBadges(userData);

  if (badges.length === 0) return "";

  return `
    <div class="user-badges">
      ${badges
        .map((badge) => `
          <span class="user-badge ${escapeHtml(badge.className)}">
            ${escapeHtml(badge.label)}
          </span>
        `)
        .join("")}
    </div>
  `;
}

function getCharacterImage(data) {
  return data.imageUrl || data.imageData || "";
}

function waitAuthReady() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

function renderLoading(text = "読み込んでいます...") {
  if (!userPageContent) return;

  userPageContent.innerHTML = `
    <section class="panel">
      <p>${escapeHtml(text)}</p>
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

function renderUserIcon(userData, className = "user-page-icon") {
  const displayName = getDisplayName(userData);
  const iconImage = userData.photoURL || "";

  if (iconImage) {
    return `
      <img
        class="${escapeHtml(className)}"
        src="${escapeHtml(iconImage)}"
        alt="${escapeHtml(displayName)}のアイコン"
      />
    `;
  }

  return `
    <div class="${escapeHtml(className)}">
      ${escapeHtml(displayName.slice(0, 1) || "？")}
    </div>
  `;
}

function getUserPageUrl(userId, userData = {}) {
  const handle = normalizeHandle(userData.handle || "");

  if (handle) {
    return `/users/?id=${encodeURIComponent(handle)}`;
  }

  return `/users/?id=${encodeURIComponent(userId)}`;
}

async function resolveUserId(rawId) {
  if (!rawId) return "";

  const originalId = String(rawId).trim().replace(/^@+/, "");

  if (!originalId) return "";

  // UIDは大文字小文字があるので、そのまま読む
  const directUserRef = doc(db, "users", originalId);
  const directUserSnap = await getDoc(directUserRef);

  if (directUserSnap.exists()) {
    return originalId;
  }

  // UIDでなければ、IDとして小文字化して handles から探す
  const handle = normalizeHandle(originalId);
  const handleRef = doc(db, "handles", handle);
  const handleSnap = await getDoc(handleRef);

  if (!handleSnap.exists()) {
    return "";
  }

  return handleSnap.data().uid || "";
}

async function getUserData() {
  const resolvedUid = await resolveUserId(rawUserId);

  if (!resolvedUid) return null;

  const userRef = doc(db, "users", resolvedUid);
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

async function getPublicCharacters(targetUserId) {
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

function getFavoriteRef(targetUid) {
  if (!currentViewer || !targetUid) return null;

  return doc(
    db,
    "users",
    currentViewer.uid,
    "favorites",
    targetUid
  );
}

async function isFavoriteUser(targetUid) {
  const favoriteRef = getFavoriteRef(targetUid);

  if (!favoriteRef) return false;

  const snap = await getDoc(favoriteRef);

  return snap.exists();
}

async function addFavoriteUser(targetUid) {
  const favoriteRef = getFavoriteRef(targetUid);

  if (!favoriteRef) return;

  await setDoc(favoriteRef, {
    ownerUid: currentViewer.uid,
    targetUid,
    createdAt: serverTimestamp()
  });
}

async function removeFavoriteUser(targetUid) {
  const favoriteRef = getFavoriteRef(targetUid);

  if (!favoriteRef) return;

  await deleteDoc(favoriteRef);
}

function renderFavoriteControl(targetUid, isFavorite) {
  if (!currentViewer) {
    return `
      <div class="favorite-area">
        <p class="mini-info">ログインすると、このユーザーをお気に入りに保存できます。</p>
      </div>
    `;
  }

  if (currentViewer.uid === targetUid) {
    return `
      <div class="favorite-area">
        <p class="mini-info">自分のページです。</p>
      </div>
    `;
  }

  return `
    <div class="favorite-area">
      <button
        id="favoriteUserBtn"
        class="ghost-btn favorite-user-btn ${isFavorite ? "is-active" : ""}"
        type="button"
        data-favorite="${isFavorite ? "true" : "false"}"
      >
        ${isFavorite ? "★ お気に入り済み" : "☆ お気に入りに追加"}
      </button>

      <p id="favoriteMessage" class="mini-info"></p>
    </div>
  `;
}

function bindFavoriteButton(targetUid) {
  const button = document.getElementById("favoriteUserBtn");
  const message = document.getElementById("favoriteMessage");

  if (!button) return;

  button.addEventListener("click", async () => {
    const isFavorite = button.dataset.favorite === "true";

    try {
      button.disabled = true;

      if (message) {
        message.textContent = isFavorite
          ? "お気に入りを解除しています..."
          : "お気に入りに追加しています...";
      }

      if (isFavorite) {
        await removeFavoriteUser(targetUid);
      } else {
        await addFavoriteUser(targetUid);
      }

      const nextFavorite = !isFavorite;

      button.dataset.favorite = nextFavorite ? "true" : "false";
      button.classList.toggle("is-active", nextFavorite);
      button.textContent = nextFavorite
        ? "★ お気に入り済み"
        : "☆ お気に入りに追加";

      if (message) {
        message.textContent = nextFavorite
          ? "お気に入りに追加しました。"
          : "お気に入りを解除しました。";
      }
    } catch (error) {
      console.error(error);

      if (message) {
        message.textContent = "お気に入りの更新に失敗しました。";
      }
    } finally {
      button.disabled = false;
    }
  });
}

function renderUserList(users) {
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
        .map(({ id, data }) => {
          const displayName = getDisplayName(data);
          const profileText = data.profileText || "";
          const genreText = data.genreText || "";
          const userUrl = getUserPageUrl(id, data);

          return `
            <article class="user-list-card">
              <a class="user-list-card-link" href="${userUrl}">
                ${renderUserIcon(data, "user-list-icon")}

                <div class="user-list-body">
                  <h2>${escapeHtml(displayName)}</h2>

                  ${renderUserBadges(data)}

                  ${
                    data.handle
                      ? `<p class="mini-info">@${escapeHtml(data.handle)}</p>`
                      : `<p class="mini-info">ID未設定</p>`
                  }

                  ${
                    profileText
                      ? `
                        <p class="user-list-profile">
                          ${escapeHtml(profileText.slice(0, 90))}
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

function renderUserPage(user, characters, isFavorite) {
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

          ${renderUserBadges(data)}

          ${
            data.handle
              ? `<p class="mini-info">@${escapeHtml(data.handle)}</p>`
              : `<p class="mini-info">ID未設定</p>`
          }

          <p class="mini-info">公開キャラ ${characters.length}体</p>

          ${renderFavoriteControl(user.id, isFavorite)}
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

  bindFavoriteButton(user.id);
}

async function initUserList() {
  renderLoading("ユーザー一覧を読み込んでいます...");

  try {
    const users = await getPublicUsers();
    renderUserList(users);
  } catch (error) {
    renderError(error);
  }
}

async function initUserDetail() {
  renderLoading("ユーザーページを読み込んでいます...");

  try {
    const user = await getUserData();

    if (!user) {
      renderNotFound();
      return;
    }

    const characters = await getPublicCharacters(user.id);
    const favorite = await isFavoriteUser(user.id);

    renderUserPage(user, characters, favorite);
  } catch (error) {
    renderError(error);
  }
}

async function init() {
  currentViewer = await waitAuthReady();

  if (rawUserId) {
    await initUserDetail();
    return;
  }

  await initUserList();
}

init();

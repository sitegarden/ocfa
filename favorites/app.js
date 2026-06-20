import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const favoritesContent = document.getElementById("favoritesContent");

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function getUserPageUrl(userId, userData = {}) {
  const handle = normalizeHandle(userData.handle || "");

  if (handle) {
    return `/users/?id=${encodeURIComponent(handle)}`;
  }

  return `/users/?id=${encodeURIComponent(userId)}`;
}

function renderLoading(text = "読み込んでいます...") {
  if (!favoritesContent) return;

  favoritesContent.innerHTML = `
    <section class="panel">
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function renderLoginRequired() {
  if (!favoritesContent) return;

  favoritesContent.innerHTML = `
    <section class="panel">
      <h2>ログインが必要です</h2>
      <p>お気に入りユーザーを見るにはログインしてください。</p>

      <div class="actions">
        <a class="ghost-btn" href="/users/">公開ユーザーを見る</a>
        <a class="ghost-btn" href="/">トップへ戻る</a>
      </div>
    </section>
  `;
}

function renderEmpty() {
  if (!favoritesContent) return;

  favoritesContent.innerHTML = `
    <section class="panel">
      <h2>お気に入りユーザーはまだいません</h2>
      <p>公開ユーザーページから、お気に入りに追加できます。</p>

      <div class="actions">
        <a class="primary-btn" href="/users/">公開ユーザーを探す</a>
      </div>
    </section>
  `;
}

function renderError(error) {
  console.error(error);

  if (!favoritesContent) return;

  favoritesContent.innerHTML = `
    <section class="panel">
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
    </section>
  `;
}

function renderUserIcon(userData, className = "user-list-icon") {
  const displayName = getDisplayName(userData);
  const iconImage = userData.photoURL || "";

  if (iconImage) {
    return `
      <img
        class="${escapeHtml(className)}"
        src="${escapeHtml(iconImage)}"
        alt="${escapeHtml(displayName)}のアイコン"
      >
    `;
  }

  return `
    <div class="${escapeHtml(className)} user-icon-placeholder">
      ${escapeHtml(displayName.slice(0, 1) || "？")}
    </div>
  `;
}

async function getFavoriteDocs(user) {
  const favoritesRef = collection(db, "users", user.uid, "favorites");
  const snap = await getDocs(favoritesRef);

  const favorites = [];

  snap.forEach((docSnap) => {
    favorites.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  return favorites;
}

async function getFavoriteUsers(user) {
  const favorites = await getFavoriteDocs(user);
  const users = [];

  await Promise.all(
    favorites.map(async (favorite) => {
      const targetUid = favorite.data.targetUid || favorite.id;

      const userRef = doc(db, "users", targetUid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) return;

      const userData = userSnap.data();

      if (userData.isDeleted === true) return;
      if (userData.isPublic === false) return;

      users.push({
        id: userSnap.id,
        data: userData,
        favoriteData: favorite.data
      });
    })
  );

  users.sort((a, b) => {
    const aTime = a.favoriteData.createdAt?.seconds || 0;
    const bTime = b.favoriteData.createdAt?.seconds || 0;

    return bTime - aTime;
  });

  return users;
}

function renderFavoriteUsers(users) {
  if (!favoritesContent) return;

  if (users.length === 0) {
    renderEmpty();
    return;
  }

  favoritesContent.innerHTML = `
    <section class="user-list-grid favorite-user-grid">
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderLoginRequired();
    return;
  }

  try {
    renderLoading("お気に入りユーザーを読み込んでいます...");

    const users = await getFavoriteUsers(user);
    renderFavoriteUsers(users);
  } catch (error) {
    renderError(error);
  }
});

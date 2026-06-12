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

async function getUserData() {
  const userRef = doc(db, "users", userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getUserCharacters() {
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

function renderCharacters(characters) {
  if (characters.length === 0) {
    return `
      <div class="panel-soft">
        <p>公開されているキャラはまだありません。</p>
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
              <a class="character-card-link" href="/characters/file/?id=${id}">
                <img src="${data.imageData}" alt="${escapeHtml(data.name)}">

                <div class="character-body">
                  <h2>${escapeHtml(data.name)}</h2>

                  ${
                    data.kana
                      ? `<p class="mini-info">${escapeHtml(data.kana)}</p>`
                      : ""
                  }

                  <div class="tag-list">
                    ${tags}
                  </div>

                  <p class="mini-info">
                    ${data.faOk ? "ファンアート歓迎" : "ファンアートは要確認"}
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

async function renderUserPage() {
  if (!userId) {
    userPageContent.innerHTML = `
      <section class="panel">
        <h1>ユーザーが選ばれていません</h1>
        <p>公開ページのURLが正しいか確認してください。</p>
      </section>
    `;
    return;
  }

  const [userData, characters] = await Promise.all([
    getUserData(),
    getUserCharacters()
  ]);

  if (!userData) {
    userPageContent.innerHTML = `
      <section class="panel">
        <h1>ユーザーが見つかりませんでした</h1>
        <p>削除されたか、URLが変わっている可能性があります。</p>
      </section>
    `;
    return;
  }

  const displayName = userData.displayName || "名前未設定";
  const photoURL = userData.photoURL || "";

  userPageContent.innerHTML = `
    <section class="user-public-hero panel">
      <div class="mypage-user">
        ${
          photoURL
            ? `<img class="mypage-avatar" src="${photoURL}" alt="">`
            : `<div class="mypage-avatar placeholder">OC</div>`
        }

        <div>
          <p class="eyebrow">Creator Page</p>
          <h1>${escapeHtml(displayName)}</h1>
          <p class="mini-info">${characters.length}件のキャラを公開中</p>
        </div>
      </div>
    </section>

    <section class="page-head user-characters-head">
      <p class="eyebrow">Characters</p>
      <h1>公開キャラ</h1>
      <p>${escapeHtml(displayName)}さんが公開しているキャラクターです。</p>
    </section>

    ${renderCharacters(characters)}
  `;
}

renderUserPage().catch((error) => {
  console.error(error);

  userPageContent.innerHTML = `
    <section class="panel">
      <h1>読み込みに失敗しました</h1>
      <p>ページを再読み込みしてみてください。</p>
    </section>
  `;
});

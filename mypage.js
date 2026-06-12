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

const mypageContent = document.getElementById("mypageContent");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getMyCharacters(user) {
  const q = query(
    collection(db, "v2Characters"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
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

function renderCharacterCards(characters) {
  if (characters.length === 0) {
    return `
      <div class="panel-soft">
        <p>まだキャラが登録されていません。</p>
        <div class="actions">
          <a class="primary-btn" href="/draw/">絵を描く</a>
        </div>
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

async function renderMypage(user) {
  const characters = await getMyCharacters(user);

  mypageContent.innerHTML = `
    <section class="mypage-hero panel">
      <div class="mypage-user">
        ${
          user.photoURL
            ? `<img class="mypage-avatar" src="${user.photoURL}" alt="">`
            : `<div class="mypage-avatar placeholder">OC</div>`
        }

        <div>
          <p class="eyebrow">My Atelier</p>
          <h1>${escapeHtml(user.displayName || "名前未設定")}</h1>
          <p class="mini-info">${escapeHtml(user.email || "")}</p>
        </div>
      </div>

      <div class="mypage-actions">
        <a class="primary-btn" href="/draw/">絵を描く</a>
        <a class="ghost-btn" href="/users/?id=${user.uid}">公開ページを見る</a>
      </div>
    </section>

    <section class="mypage-grid">
      <article class="panel">
        <h2>自分のキャラ</h2>
        <p>${characters.length}件のキャラクターが登録されています。</p>
      </article>

      <article class="panel">
        <h2>下書き</h2>
        <p>保存した下書きは「描く」ページから確認できます。</p>
        <div class="actions">
          <a class="ghost-btn" href="/draw/">下書きを見る</a>
        </div>
      </article>

      <article class="panel">
        <h2>公開ページ</h2>
        <p>あなたのキャラクターをまとめて見られるページです。</p>
        <div class="actions">
          <a class="ghost-btn" href="/users/?id=${user.uid}">公開ページを見る</a>
        </div>
      </article>
    </section>

    <section class="page-head my-characters-head">
      <p class="eyebrow">My Characters</p>
      <h1>登録したキャラ</h1>
      <p>自分が登録したオリジナルキャラクターたちです。</p>
    </section>

    ${renderCharacterCards(characters)}
  `;
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    mypageContent.innerHTML = `
      <section class="panel">
        <h1>ログインが必要です</h1>
        <p>マイページを見るには、Googleログインしてください。</p>
      </section>
    `;
    return;
  }

  renderMypage(user).catch((error) => {
    console.error(error);

    mypageContent.innerHTML = `
      <section class="panel">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  });
});

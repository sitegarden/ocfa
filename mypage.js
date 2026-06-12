import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
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

function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

async function getOcfaUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
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
        <p>まだキャラクターが登録されていません。</p>

        <div class="actions">
          <a class="primary-btn" href="/draw/">キャラを描く</a>
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
                    ${data.isPublic === false ? "非公開" : "公開中"} /
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

function renderMypage(user, userData, characters) {
  const displayName =
    userData?.displayName ||
    user.displayName ||
    "名前未設定";

  const profileText = userData?.profileText || "";
  const genreText = userData?.genreText || "";
  const linkUrl = userData?.linkUrl || "";

  const publicCharacters = characters.filter((character) => {
    return character.data.isPublic !== false;
  });

  mypageContent.innerHTML = `
    <section class="mypage-hero panel">
      <div class="mypage-profile">
        <div class="mypage-icon">
          ${
            user.photoURL
              ? `<img src="${user.photoURL}" alt="${escapeHtml(displayName)}">`
              : `<span>${escapeHtml(displayName.slice(0, 1))}</span>`
          }
        </div>

        <div class="mypage-profile-body">
          <p class="eyebrow">My Page</p>
          <h1>${escapeHtml(displayName)}</h1>

          <p class="mini-info">
            登録キャラ ${characters.length}体 /
            公開キャラ ${publicCharacters.length}体
          </p>

          ${
            profileText
              ? `<p class="mypage-profile-text">${nl2br(profileText)}</p>`
              : `<p class="mypage-profile-text muted-text">プロフィールはまだ設定されていません。</p>`
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

      <div class="actions">
        <a class="primary-btn" href="/draw/">新しく描く</a>
        <a class="ghost-btn" href="/settings/">プロフィール設定</a>
        <a class="ghost-btn" href="/users/?id=${encodeURIComponent(user.uid)}">
          公開ページを見る
        </a>
      </div>
    </section>

    <section class="mypage-section panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Characters</p>
          <h2>自分のキャラクター</h2>
        </div>

        <a class="ghost-btn" href="/characters/">キャラ一覧へ</a>
      </div>

      ${renderCharacterCards(characters)}
    </section>

    <section class="mypage-section panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Draft</p>
          <h2>下書き・作成</h2>
        </div>
      </div>

      <div class="mypage-link-grid">
        <a class="mypage-link-card" href="/draw/">
          <strong>描く</strong>
          <span>サイト内キャンバスで新しい絵を描きます。</span>
        </a>

        <a class="mypage-link-card" href="/characters/new/">
          <strong>キャラ登録</strong>
          <span>保存した下書きからキャラクターを登録します。</span>
        </a>

        <a class="mypage-link-card" href="/events/">
          <strong>イベント</strong>
          <span>開催中のイベントや参加キャラを確認します。</span>
        </a>
      </div>
    </section>
  `;
}

function renderLoginRequired() {
  mypageContent.innerHTML = `
    <section class="panel">
      <p class="eyebrow">My Page</p>
      <h1>ログインが必要です</h1>
      <p>マイページを見るにはログインしてください。</p>

      <div class="actions">
        <a class="ghost-btn" href="/">トップへ戻る</a>
      </div>
    </section>
  `;
}

function renderError(error) {
  console.error(error);

  mypageContent.innerHTML = `
    <section class="panel">
      <h1>読み込みに失敗しました</h1>
      <p>ページを再読み込みしてみてください。</p>
    </section>
  `;
}

onAuthStateChanged(auth, async (user) => {
  if (!mypageContent) return;

  if (!user) {
    renderLoginRequired();
    return;
  }

  mypageContent.innerHTML = `
    <section class="panel">
      <p>マイページを読み込んでいます...</p>
    </section>
  `;

  try {
    const [userData, characters] = await Promise.all([
      getOcfaUserData(user),
      getMyCharacters(user)
    ]);

    renderMypage(user, userData, characters);
  } catch (error) {
    renderError(error);
  }
});

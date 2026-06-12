import { auth, db } from "/firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const characterFile = document.getElementById("characterFile");

const params = new URLSearchParams(location.search);
const characterId = params.get("id");

let currentUser = null;

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

async function getCharacter() {
  const characterRef = doc(db, "v2Characters", characterId);
  const snap = await getDoc(characterRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getOwnerName(userId) {
  if (!userId) return "作者名未設定";

  const userRef = doc(db, "users", userId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return "作者名未設定";

  const userData = snap.data();

  return userData.displayName || "作者名未設定";
}

function renderNotFound() {
  characterFile.innerHTML = `
    <div class="panel">
      <h1>キャラが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <div class="actions">
        <a class="ghost-btn" href="/characters/">キャラ一覧へ</a>
      </div>
    </div>
  `;
}

async function renderCharacter(character) {
  const data = character.data;

  if (data.isDeleted === true) {
    renderNotFound();
    return;
  }

  if (data.isPublic !== true && data.userId !== currentUser?.uid) {
    characterFile.innerHTML = `
      <div class="panel">
        <h1>このキャラは非公開です</h1>
        <p>公開されていないキャラクターです。</p>
        <div class="actions">
          <a class="ghost-btn" href="/characters/">キャラ一覧へ</a>
        </div>
      </div>
    `;
    return;
  }

  const ownerName = await getOwnerName(data.userId);

  const tags = Array.isArray(data.tags)
    ? data.tags
        .map((tag) => `<span>${escapeHtml(tag)}</span>`)
        .join("")
    : "";

  const isOwner = currentUser && currentUser.uid === data.userId;

  characterFile.innerHTML = `
    <article class="character-detail panel">
      <div class="character-detail-grid">
        <div class="character-detail-image">
          <img src="${data.imageData}" alt="${escapeHtml(data.name)}">
        </div>

        <div class="character-detail-info">
          <p class="eyebrow">Character File</p>

          <h1>${escapeHtml(data.name || "名前未設定")}</h1>

          ${
            data.kana
              ? `<p class="mini-info">${escapeHtml(data.kana)}</p>`
              : ""
          }

          <p class="status-pill">
            ${data.faOk ? "ファンアート歓迎" : "ファンアートは要確認"}
          </p>

          ${
            data.isPublic === false
              ? `<p class="status-pill muted-pill">非公開</p>`
              : ""
          }

          <div class="tag-list">
            ${tags}
          </div>

          <div class="actions">
            ${
              isOwner
                ? `
                  <a class="primary-btn" href="/characters/edit/?id=${encodeURIComponent(character.id)}">
                    編集する
                  </a>
                `
                : ""
            }

            <a class="ghost-btn" href="/characters/">一覧へ戻る</a>
            <a class="ghost-btn" href="/draw/">絵を描く</a>
          </div>
        </div>
      </div>

      <section class="detail-section">
        <h2>プロフィール</h2>
        ${
          data.profile
            ? `<p>${nl2br(data.profile)}</p>`
            : `<p>プロフィールはまだありません。</p>`
        }
      </section>

      <section class="detail-section">
        <h2>NG・注意事項</h2>
        ${
          data.ngText
            ? `<p>${nl2br(data.ngText)}</p>`
            : `<p>特に記載はありません。</p>`
        }
      </section>

      <section class="detail-section">
        <h2>作者</h2>
        <p>
          <a class="text-link" href="/users/?id=${encodeURIComponent(data.userId)}">
            ${escapeHtml(ownerName)}
          </a>
        </p>
      </section>

      <section class="detail-section">
        <h2>ファンアート</h2>
        <p>ファンアート機能は、イベント機能と一緒に追加予定です。</p>
      </section>
    </article>
  `;
}

async function init() {
  if (!characterId) {
    characterFile.innerHTML = `
      <div class="panel">
        <h1>キャラが選ばれていません</h1>
        <p>URLが正しいか確認してください。</p>
        <div class="actions">
          <a class="ghost-btn" href="/characters/">キャラ一覧へ</a>
        </div>
      </div>
    `;
    return;
  }

  const character = await getCharacter();

  if (!character) {
    renderNotFound();
    return;
  }

  await renderCharacter(character);
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  init().catch((error) => {
    console.error(error);

    characterFile.innerHTML = `
      <div class="panel">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </div>
    `;
  });
});

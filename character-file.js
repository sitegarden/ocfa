import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where
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

function getCharacterImageSrc(data) {
  return data.imageUrl || data.imageData || "";
}

function renderNotFound() {
  characterFile.innerHTML = `
    <section class="card message-card">
      <h1>キャラが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <a class="primary-link" href="/characters/">キャラ一覧へ</a>
    </section>
  `;
}

function getFanartImageSrc(data) {
  return data.imageUrl || data.imageData || "";
}

function formatDate(value) {
  if (!value?.toDate) return "";

  const date = value.toDate();

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

async function loadCharacterFanarts() {
  const fanartList = document.getElementById("characterFanartList");

  if (!fanartList || !characterId) return;

  const fanartsQuery = query(
    collection(db, "v2Fanarts"),
    where("characterId", "==", characterId),
    where("isPublic", "==", true),
    where("isDeleted", "==", false),
    orderBy("createdAt", "desc"),
    limit(12)
  );

  const snap = await getDocs(fanartsQuery);

  if (snap.empty) {
    fanartList.innerHTML = `
      <div class="empty-preview">
        まだこの子へのファンアートはありません。
      </div>
    `;

    return;
  }

  fanartList.innerHTML = "";

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const imageSrc = getFanartImageSrc(data);

    const card = document.createElement("article");
    card.className = "character-card";

    card.innerHTML = `
      <div class="character-thumb">
        ${
          imageSrc
            ? `<img class="character-img" src="${imageSrc}" alt="${escapeHtml(data.characterName || "ファンアート")}">`
            : `<div class="no-image">No Image</div>`
        }
      </div>

      <div class="character-body">
        <h2>${escapeHtml(data.artistName || "作者名未設定")}</h2>

        <p class="character-profile">
          ${escapeHtml(data.comment || "コメントはありません。")}
        </p>

        <div class="character-tags">
          <span>${data.imageSource === "upload" ? "画像投稿" : "お絵描き"}</span>
          ${
            data.createdAt
              ? `<span>${escapeHtml(formatDate(data.createdAt))}</span>`
              : ""
          }
        </div>
      </div>
    `;

    fanartList.appendChild(card);
  });
}

async function renderCharacter(character) {
  const data = character.data;

  if (data.isDeleted === true) {
    renderNotFound();
    return;
  }

  if (data.isPublic !== true && data.userId !== currentUser?.uid) {
    characterFile.innerHTML = `
      <section class="card message-card">
        <h1>このキャラは非公開です</h1>
        <p>公開されていないキャラクターです。</p>
        <a class="primary-link" href="/characters/">キャラ一覧へ</a>
      </section>
    `;
    return;
  }

  const ownerName = await getOwnerName(data.userId);

  const tags = Array.isArray(data.tags)
    ? data.tags
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("")
    : "";

  const isOwner = currentUser && currentUser.uid === data.userId;
  const imageSrc = getCharacterImageSrc(data);

  characterFile.innerHTML = `
    <article class="character-file-card">
      <section class="character-file-visual card">
        ${
          imageSrc
            ? `<img src="${imageSrc}" alt="${escapeHtml(data.name || "キャラクター画像")}">`
            : `<div class="empty-preview">画像がありません。</div>`
        }
      </section>

      <section class="character-file-info card">
        <p class="eyebrow">Character File</p>

        <h1>${escapeHtml(data.name || "名前未設定")}</h1>

        ${
          data.kana
            ? `<p class="kana">${escapeHtml(data.kana)}</p>`
            : ""
        }

        <div class="badge-row">
          <span class="badge">${data.faOk ? "ファンアート歓迎" : "ファンアートは要確認"}</span>
          ${
            data.isPublic === false
              ? `<span class="badge muted">非公開</span>`
              : ""
          }
          ${
            data.imageSource === "upload"
              ? `<span class="badge muted">アップロード画像</span>`
              : `<span class="badge muted">お絵描き画像</span>`
          }
        </div>

        ${
          tags
            ? `<div class="tag-row">${tags}</div>`
            : ""
        }

        <div class="button-row">
          ${
            isOwner
              ? `<a class="primary-link" href="/characters/edit/?id=${character.id}">編集する</a>`
              : ""
          }
          <a class="primary-link" href="/characters/">一覧へ戻る</a>
          <a class="primary-link" href="/draw/">絵を描く</a>
        </div>
      </section>

      <section class="card">
        <h2>プロフィール</h2>
        ${
          data.profile
            ? `<p>${nl2br(data.profile)}</p>`
            : `<p>プロフィールはまだありません。</p>`
        }
      </section>

      <section class="card">
        <h2>NG・注意事項</h2>
        ${
          data.ngText
            ? `<p>${nl2br(data.ngText)}</p>`
            : `<p>特に記載はありません。</p>`
        }
      </section>

      <section class="card">
        <h2>作者</h2>
        <a class="primary-link" href="/users/file/?id=${escapeHtml(data.userId || "")}">
          ${escapeHtml(ownerName)}
        </a>
      </section>

      <section class="card">

<h2>ファンアート</h2>

<p>
  このキャラクターに向けて、イベントとは別に自由なファンアートを投稿できます。
</p>

<div class="button-row">
  ${
    data.faOk
      ? `<a class="primary-link" href="/fanarts/new/?characterId=${character.id}">この子のFAを描く</a>`
      : `<span class="badge muted">ファンアートは要確認</span>`
  }

  <a class="primary-link" href="/fanarts/">FA一覧を見る</a>
</div>

<div id="characterFanartList" class="character-grid">
  <p>ファンアートを読み込み中...</p>
</div>

</section>
  `;

  await loadCharacterFanarts();
}

async function init() {
  if (!characterId) {
    characterFile.innerHTML = `
      <section class="card message-card">
        <h1>キャラが選ばれていません</h1>
        <p>URLが正しいか確認してください。</p>
        <a class="primary-link" href="/characters/">キャラ一覧へ</a>
      </section>
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
      <section class="card message-card">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  });
});

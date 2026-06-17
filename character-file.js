import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
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

async function getWork(workId) {
  if (!workId) return null;

  const workRef = doc(db, "works", workId);
  const snap = await getDoc(workRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

function getWorkTypeLabel(type) {
  if (type === "shared") return "共有作品";
  return "自分専用";
}

function getJoinTypeLabel(type) {
  if (type === "free") return "自由参加";
  if (type === "approval") return "承認制";
  return "募集なし";
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

  try {
    const fanartsQuery = query(
      collection(db, "v2Fanarts"),
      where("characterId", "==", characterId),
      where("isPublic", "==", true),
      where("isDeleted", "==", false),
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

    const fanarts = [];

    snap.forEach((docSnap) => {
      fanarts.push({
        id: docSnap.id,
        data: docSnap.data()
      });
    });

    fanarts.sort((a, b) => {
      const aTime = a.data.createdAt?.toMillis?.() || 0;
      const bTime = b.data.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    fanartList.innerHTML = "";

    fanarts.forEach((item) => {
      const data = item.data;
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
  } catch (error) {
    console.error(error);

    fanartList.innerHTML = `
      <div class="empty-preview">
        ファンアートの読み込みに失敗しました。
      </div>
    `;
  }
}

function getTheme(data) {
  const theme = data.customTheme || {};

  return {
    bgColor: theme.bgColor || "#fff7fb",
    mainColor: theme.mainColor || "#ff7ab6",
    subColor: theme.subColor || "#8bc6ff",
    textColor: theme.textColor || "#3a2d35",
    cardColor: theme.cardColor || "#ffffff",
    radius: theme.radius || "24",
    pattern: theme.pattern || "dot"
  };
}

function getThemeStyle(theme) {
  return `
    --cf-bg: ${escapeHtml(theme.bgColor)};
    --cf-main: ${escapeHtml(theme.mainColor)};
    --cf-sub: ${escapeHtml(theme.subColor)};
    --cf-text: ${escapeHtml(theme.textColor)};
    --cf-card: ${escapeHtml(theme.cardColor)};
    --cf-radius: ${Number(theme.radius) || 24}px;
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
  const work = await getWork(data.workId || "");
  const imageSrc = getCharacterImageSrc(data);

  const theme = getTheme(data);
const themeStyle = getThemeStyle(theme);

characterFile.innerHTML = `
  <div class="cf-page cf-pattern-${escapeHtml(theme.pattern)}" style="${themeStyle}">
    <section class="cf-profile-card">
      <div class="cf-image-wrap">
        ${
          imageSrc
            ? `<img class="cf-main-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(data.name || "キャラクター画像")}">`
            : `<div class="cf-no-image">画像がありません</div>`
        }
      </div>

      <div class="cf-main-info">
        <p class="cf-label">Character File</p>

        <h1>${escapeHtml(data.name || "名前未設定")}</h1>

        ${
          data.kana
            ? `<p class="cf-kana">${escapeHtml(data.kana)}</p>`
            : ""
        }

        <div class="cf-badges">
          <span>${data.faOk ? "FA歓迎" : "FA要確認"}</span>
          ${data.isPublic === false ? `<span>非公開</span>` : ""}
          <span>${data.imageSource === "upload" ? "アップロード画像" : "お絵描き画像"}</span>
        </div>

        ${
          tags
            ? `<div class="cf-tags">${tags}</div>`
            : ""
        }

        <div class="cf-actions">
          ${isOwner ? `<a class="primary-btn" href="/characters/edit/?id=${character.id}">編集する</a>` : ""}
          <a class="ghost-btn" href="/characters/">一覧へ戻る</a>
          <a class="ghost-btn" href="/draw/?characterId=${character.id}">絵を描く</a>
        </div>
      </div>
    </section>

    <section class="cf-link-list">
      <article class="cf-link-card">
        <h2>プロフィール</h2>
        ${
          data.profile
            ? `<p>${nl2br(data.profile)}</p>`
            : `<p>プロフィールはまだありません。</p>`
        }
      </article>

      <article class="cf-link-card">
        <h2>NG・注意事項</h2>
        ${
          data.ngText
            ? `<p>${nl2br(data.ngText)}</p>`
            : `<p>特に記載はありません。</p>`
        }
      </article>

      <article class="cf-link-card">
        <h2>作者</h2>
        <p>
          <a href="/users/profile/?id=${escapeHtml(data.userId || "")}">
            ${escapeHtml(ownerName)}
          </a>
        </p>
      </article>

      <article class="cf-link-card">
        <h2>所属作品</h2>
        ${
          work
            ? `
              <h3>${escapeHtml(work.data.title || "作品名未設定")}</h3>
              <p>
                ${escapeHtml(getWorkTypeLabel(work.data.workType))}
                ${
                  work.data.workType === "shared"
                    ? ` / ${escapeHtml(getJoinTypeLabel(work.data.joinType))}`
                    : ""
                }
              </p>
              <p>${escapeHtml(work.data.description || "作品説明はまだありません。")}</p>
              <a class="cf-mini-link" href="/works/file/?id=${work.id}">作品を見る</a>
            `
            : `<p>まだ作品には所属していません。</p>`
        }
      </article>

      <article class="cf-link-card">
        <h2>ファンアート</h2>
        <p>このキャラクターに向けて、イベントとは別に自由なファンアートを投稿できます。</p>

        <div class="cf-actions">
          ${
            data.faOk
              ? `<a class="primary-btn" href="/fanarts/new/?characterId=${character.id}">この子のFAを描く</a>`
              : `<span class="ghost-label">ファンアートは要確認</span>`
          }
          <a class="ghost-btn" href="/fanarts/?characterId=${character.id}">FA一覧を見る</a>
        </div>

        <div id="characterFanartList" class="cf-fanart-grid">
          <p>ファンアートを読み込み中...</p>
        </div>
      </article>
    </section>
  </div>
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

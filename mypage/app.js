import { auth, db } from "/firebase.js";

import {
  collection,
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

const mypageContent = document.getElementById("mypageContent");

let currentUser = null;
let currentUserData = null;
let currentCharacters = [];

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

function getCharacterImage(data) {
  return data?.imageUrl || data?.imageData || "";
}

function getPublicUserUrl(user, userData) {
  const handle = normalizeHandle(userData?.handle || "");

  if (handle) {
    return `/users/?id=${encodeURIComponent(handle)}`;
  }

  return `/users/?id=${encodeURIComponent(user.uid)}`;
}

async function getOcfaUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getMyCharacters(user) {
  const charactersQuery = query(
    collection(db, "v2Characters"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(charactersQuery);

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

async function setMyIconCharacter(character) {
  if (!currentUser || !character) return;

  const imageUrl = getCharacterImage(character.data);

  if (!imageUrl) {
    throw new Error("character image is empty");
  }

  const userRef = doc(db, "users", currentUser.uid);

  await setDoc(
    userRef,
    {
      iconCharacterId: character.id,
      iconCharacterName: character.data.name || "名前未設定",
      iconImageUrl: imageUrl,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function getMypageIconHtml(user, userData, displayName) {
  const iconImage =
    userData?.iconImageUrl ||
    userData?.iconImageData ||
    userData?.photoURL ||
    user?.photoURL ||
    "";

  if (iconImage) {
    return `
      <img
        class="mypage-icon"
        src="${escapeHtml(iconImage)}"
        alt="${escapeHtml(displayName)}のアイコン"
      >
    `;
  }

  return `
    <div class="mypage-icon mypage-icon-placeholder">
      ${escapeHtml(displayName.slice(0, 1) || "？")}
    </div>
  `;
}

function renderCharacterCards(characters, userData) {
  if (characters.length === 0) {
    return `
      <div class="panel-soft">
        <p>まだキャラクターが登録されていません。</p>

        <div class="actions">
          <a class="primary-btn" href="/characters/new/">
            キャラを登録する
          </a>
        </div>
      </div>
    `;
  }

  const iconCharacterId = userData?.iconCharacterId || "";

  return `
    <div class="mypage-character-list">
      ${characters
        .map(({ id, data }) => {
          const image = getCharacterImage(data);

          const tags = Array.isArray(data.tags)
            ? data.tags
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join("")
            : "";

          const isCurrentIcon = iconCharacterId === id;

          return `
            <article class="mypage-character-card">
              <a
                class="mypage-character-link"
                href="/characters/file/?id=${encodeURIComponent(id)}"
              >
                <div class="mypage-character-image">
                  ${
                    image
                      ? `
                        <img
                          src="${escapeHtml(image)}"
                          alt="${escapeHtml(data.name || "キャラクター")}"
                        >
                      `
                      : `
                        <div class="mypage-character-noimage">
                          No Image
                        </div>
                      `
                  }
                </div>

                <div class="mypage-character-info">
                  <h3>${escapeHtml(data.name || "名前未設定")}</h3>

                  ${
                    data.kana
                      ? `<p class="mini-info">${escapeHtml(data.kana)}</p>`
                      : ""
                  }

                  <p class="mini-info">
                    ${data.isPublic === false ? "非公開キャラ" : "公開中"}
                  </p>

                  ${
                    tags
                      ? `
                        <div class="character-tags">
                          ${tags}
                        </div>
                      `
                      : ""
                  }
                </div>
              </a>

              <div class="mypage-character-actions">
                <button
                  class="ghost-btn icon-character-btn"
                  type="button"
                  data-character-id="${escapeHtml(id)}"
                  ${!image ? "disabled" : ""}
                >
                  ${isCurrentIcon ? "現在のアイコン" : "アイコンにする"}
                </button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function setupIconButtons() {
  const buttons = document.querySelectorAll(".icon-character-btn");

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const characterId = button.dataset.characterId;

      const character = currentCharacters.find((item) => {
        return item.id === characterId;
      });

      if (!character) {
        alert("キャラクターが見つかりませんでした。");
        return;
      }

      if (!getCharacterImage(character.data)) {
        alert("このキャラには画像がありません。");
        return;
      }

      const characterName = character.data.name || "このキャラ";

      const ok = confirm(
        `${characterName}をアイコンに設定しますか？`
      );

      if (!ok) return;

      const oldText = button.textContent;

      button.disabled = true;
      button.textContent = "設定中...";

      try {
        await setMyIconCharacter(character);

        const latestUserData = await getOcfaUserData(currentUser);
        currentUserData = latestUserData || currentUserData;

        renderMypage(currentUser, currentUserData, currentCharacters);
      } catch (error) {
        console.error(error);

        alert("アイコン設定に失敗しました。");

        button.disabled = false;
        button.textContent = oldText;
      }
    });
  });
}

function renderMypage(user, userData, characters) {
  const displayName =
    userData?.displayName ||
    user.displayName ||
    "名前未設定";

  const profileText = userData?.profileText || "";
  const genreText = userData?.genreText || "";
  const linkUrl = userData?.linkUrl || "";
  const isPublic = userData?.isPublic !== false;

  const publicCharacters = characters.filter((character) => {
    return character.data.isPublic !== false;
  });

  mypageContent.innerHTML = `
    <section class="panel mypage-profile-panel">
      <div class="mypage-profile-head">
        <div class="mypage-icon-wrap">
          ${getMypageIconHtml(user, userData, displayName)}
        </div>

        <div class="mypage-profile-main">
          <p class="eyebrow">My Page</p>
          <h1>${escapeHtml(displayName)}</h1>

          ${
            userData?.handle
              ? `<p class="mini-info">@${escapeHtml(userData.handle)}</p>`
              : ""
          }

          <p class="mini-info">
            登録キャラ ${characters.length}体 / 公開キャラ ${publicCharacters.length}体
          </p>
        </div>
      </div>

      ${
        userData?.iconCharacterName
          ? `
            <p class="mini-info">
              現在のアイコン：${escapeHtml(userData.iconCharacterName)}
            </p>
          `
          : `
            <p class="mini-info">
              登録した自分のキャラをアイコンに設定できます。
            </p>
          `
      }

      <div class="mypage-profile-text">
        ${
          profileText
            ? `<p>${nl2br(profileText)}</p>`
            : `<p>プロフィールはまだ設定されていません。</p>`
        }
      </div>

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
              <a
                class="ghost-btn"
                href="${escapeHtml(linkUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                登録リンクを開く
              </a>
            </div>
          `
          : ""
      }

      <div class="actions">
        <a class="primary-btn" href="/characters/new/">
          キャラを登録
        </a>

        <a class="ghost-btn" href="/settings/">
          プロフィール・設定
        </a>

        ${
          isPublic
            ? `
              <a
                class="ghost-btn"
                href="${getPublicUserUrl(user, userData)}"
              >
                公開ページを見る
              </a>
            `
            : `
              <span class="ghost-btn disabled-link">
                公開ページは非公開中
              </span>
            `
        }
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Characters</p>
          <h2>自分のキャラクター</h2>
        </div>

        <a class="ghost-btn" href="/characters/">
          キャラ一覧へ
        </a>
      </div>

      ${renderCharacterCards(characters, userData)}
    </section>

    <section class="panel">
      <p class="eyebrow">Create</p>
      <h2>登録・参加</h2>

      <div class="mypage-link-grid">
        <a class="panel-soft" href="/characters/new/">
          <strong>キャラ登録</strong>
          <span>画像をアップロードしてキャラクターを登録します。</span>
        </a>

        <a class="panel-soft" href="/fanarts/">
          <strong>ファンアートを見る</strong>
          <span>みんなが投稿したファンアートを見られます。</span>
        </a>

        <a class="panel-soft" href="/events/">
          <strong>イベント</strong>
          <span>開催中のイベントや参加キャラを確認します。</span>
        </a>
      </div>
    </section>
  `;

  setupIconButtons();
}

function renderLoginRequired() {
  mypageContent.innerHTML = `
    <section class="panel">
      <p class="eyebrow">My Page</p>
      <h1>ログインが必要です</h1>

      <p>
        マイページを見るにはログインしてください。
      </p>

      <div class="actions">
        <a class="ghost-btn" href="/">
          トップへ戻る
        </a>
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

  currentUser = user;

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

    currentUserData = userData || {
      isPublic: true
    };

    currentCharacters = characters;

    renderMypage(user, currentUserData, currentCharacters);
  } catch (error) {
    renderError(error);
  }
});

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

async function setMyIconCharacter(character) {
  if (!currentUser || !character) return;

  const imageData = character.data.imageData || "";

  if (!imageData) {
    throw new Error("character imageData is empty");
  }

  const userRef = doc(db, "users", currentUser.uid);

  await setDoc(userRef, {
    iconCharacterId: character.id,
    iconCharacterName: character.data.name || "名前未設定",
    iconImageData: imageData,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function setMyProfilePublic(isPublic) {
  if (!currentUser) return;

  const userRef = doc(db, "users", currentUser.uid);

  await setDoc(userRef, {
    isPublic,
    updatedAt: serverTimestamp()
  }, { merge: true });

  currentUserData = {
    ...(currentUserData || {}),
    isPublic
  };
}

function getMypageIconHtml(user, userData, displayName) {
  const iconImage = userData?.iconImageData || user.photoURL || "";

  if (iconImage) {
    return `
      <img
        src="${iconImage}"
        alt="${escapeHtml(displayName)}のアイコン"
      >
    `;
  }

  return `
    <span>${escapeHtml(displayName.slice(0, 1) || "？")}</span>
  `;
}

function renderPublicSetting(userData) {
  const isPublic = userData?.isPublic !== false;

  return `
    <div class="panel-soft mypage-public-setting">
      <p class="mini-info">
        公開設定：
        <strong>${isPublic ? "公開中" : "非公開"}</strong>
      </p>

      <button
        id="togglePublicProfileBtn"
        class="${isPublic ? "ghost-btn" : "primary-btn"}"
        type="button"
      >
        ${isPublic ? "非公開にする" : "公開にする"}
      </button>

      <p class="mini-info">
        非公開にすると、ユーザー一覧と公開ユーザーページに表示されません。
      </p>
    </div>
  `;
}

function renderCharacterCards(characters, userData) {
  if (characters.length === 0) {
    return `
      <div class="panel-soft">
        <p>まだキャラクターが登録されていません。</p>

        <div class="actions">
          <a class="primary-btn" href="/draw/">
            キャラを描く
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
          const tags = Array.isArray(data.tags)
            ? data.tags
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join("")
            : "";

          const isCurrentIcon = iconCharacterId === id;

          return `
            <article class="mypage-character-card">
              <a class="mypage-character-link" href="/characters/detail/?id=${encodeURIComponent(id)}">
                <div class="mypage-character-image">
                  ${
                    data.imageData
                      ? `
                        <img
                          src="${data.imageData}"
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
                    ${data.isPublic === false ? "非公開" : "公開中"}
                    /
                    ${data.faOk ? "ファンアート歓迎" : "ファンアート要確認"}
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
                  ${!data.imageData ? "disabled" : ""}
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

      if (!character.data.imageData) {
        alert("このキャラには画像がありません。");
        return;
      }

      const ok = confirm(
        `${character.data.name || "このキャラ"}をアイコンに設定しますか？`
      );

      if (!ok) return;

      const oldText = button.textContent;

      button.disabled = true;
      button.textContent = "設定中...";

      try {
        await setMyIconCharacter(character);

        const latestUserData = await getOcfaUserData(currentUser);
        currentUserData = latestUserData;

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

function setupPublicProfileButton() {
  const button = document.getElementById("togglePublicProfileBtn");

  if (!button) return;

  button.addEventListener("click", async () => {
    const isNowPublic = currentUserData?.isPublic !== false;
    const nextIsPublic = !isNowPublic;

    const ok = confirm(
      nextIsPublic
        ? "プロフィールを公開しますか？"
        : "プロフィールを非公開にしますか？\nユーザー一覧と公開ページに表示されなくなります。"
    );

    if (!ok) return;

    const oldText = button.textContent;

    button.disabled = true;
    button.textContent = "変更中...";

    try {
      await setMyProfilePublic(nextIsPublic);

      renderMypage(currentUser, currentUserData, currentCharacters);
    } catch (error) {
      console.error(error);

      alert("公開設定の変更に失敗しました。");

      button.disabled = false;
      button.textContent = oldText;
    }
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

  const publicCharacters = characters.filter((character) => {
    return character.data.isPublic !== false;
  });

  mypageContent.innerHTML = `
    <section class="panel mypage-profile-panel">
      <div class="mypage-profile-head">
        <div class="mypage-icon">
          ${getMypageIconHtml(user, userData, displayName)}
        </div>

        <div>
          <p class="eyebrow">My Page</p>
          <h1>${escapeHtml(displayName)}</h1>

          <p class="mini-info">
            登録キャラ ${characters.length}体 / 公開キャラ ${publicCharacters.length}体
          </p>
        </div>
      </div>

      ${
        userData?.iconCharacterName
          ? `
            <p class="mini-info">
              現在のアイコン：
              ${escapeHtml(userData.iconCharacterName)}
            </p>
          `
          : `
            <p class="mini-info">
              自分のキャラをアイコンに設定できます。
            </p>
          `
      }

      ${renderPublicSetting(userData)}

      ${
        profileText
          ? `
            <div class="mypage-profile-text">
              <p>${nl2br(profileText)}</p>
            </div>
          `
          : `
            <div class="mypage-profile-text">
              <p>プロフィールはまだ設定されていません。</p>
            </div>
          `
      }

      ${
        genreText
          ? `
            <p class="mini-info">
              好きなジャンル：
              ${escapeHtml(genreText)}
            </p>
          `
          : ""
      }

      ${
        linkUrl && linkUrl.startsWith("https://")
          ? `
            <div class="actions">
              <a class="ghost-btn" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">
                登録リンクを開く
              </a>
            </div>
          `
          : ""
      }

      <div class="actions">
        <a class="primary-btn" href="/draw/">
          新しく描く
        </a>

        <a class="ghost-btn" href="/settings/">
          プロフィール設定
        </a>

        ${
          userData?.isPublic === false
            ? `
              <span class="ghost-btn disabled-link">
                公開ページは非公開中
              </span>
            `
            : `
              <a class="ghost-btn" href="/users/?id=${encodeURIComponent(user.uid)}">
                公開ページを見る
              </a>
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
      <p class="eyebrow">Draft</p>
      <h2>下書き・作成</h2>

      <div class="mypage-link-grid">
        <a class="panel-soft" href="/draw/">
          <strong>描く</strong>
          <span>サイト内キャンバスで新しい絵を描きます。</span>
        </a>

        <a class="panel-soft" href="/characters/new/">
          <strong>キャラ登録</strong>
          <span>保存した下書きからキャラクターを登録します。</span>
        </a>

        <a class="panel-soft" href="/events/">
          <strong>イベント</strong>
          <span>開催中のイベントや参加キャラを確認します。</span>
        </a>
      </div>
    </section>
  `;

  setupIconButtons();
  setupPublicProfileButton();
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

    renderMypage(user, currentUserData, characters);
  } catch (error) {
    renderError(error);
  }
});

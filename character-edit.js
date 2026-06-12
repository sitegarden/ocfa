import { auth, db } from "/firebase.js";

import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const characterEditContent = document.getElementById("characterEditContent");

const params = new URLSearchParams(location.search);
const characterId = params.get("id");

let currentUser = null;
let currentCharacter = null;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tagsToText(tags) {
  if (!Array.isArray(tags)) return "";
  return tags.join(", ");
}

function textToTags(text) {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
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

function renderNoCharacterId() {
  characterEditContent.innerHTML = `
    <section class="panel">
      <h1>キャラが選ばれていません</h1>
      <p>編集したいキャラクターのURLが正しいか確認してください。</p>
      <div class="actions">
        <a class="ghost-btn" href="/characters/">キャラ一覧へ</a>
      </div>
    </section>
  `;
}

function renderLoginRequired() {
  characterEditContent.innerHTML = `
    <section class="panel">
      <h1>ログインが必要です</h1>
      <p>キャラを編集するには、登録したアカウントでログインしてください。</p>
    </section>
  `;
}

function renderNotFound() {
  characterEditContent.innerHTML = `
    <section class="panel">
      <h1>キャラが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <div class="actions">
        <a class="ghost-btn" href="/characters/">キャラ一覧へ</a>
      </div>
    </section>
  `;
}

function renderNoPermission() {
  characterEditContent.innerHTML = `
    <section class="panel">
      <h1>編集できません</h1>
      <p>このキャラクターを編集できるのは、登録した本人だけです。</p>
      <div class="actions">
        <a class="ghost-btn" href="/characters/file/?id=${encodeURIComponent(characterId)}">
          キャラファイルへ
        </a>
      </div>
    </section>
  `;
}

function renderEditForm(character) {
  const data = character.data;

  const name = data.name || "";
  const kana = data.kana || "";
  const profile = data.profile || "";
  const tagText = tagsToText(data.tags);
  const faOk = data.faOk === true;
  const ngText = data.ngText || "";
  const isPublic = data.isPublic !== false;

  characterEditContent.innerHTML = `
    <form id="characterEditForm" class="form-grid">
      <section class="panel">
        <h2>キャラ情報</h2>

        <label>
          キャラ名
          <input
            id="charName"
            type="text"
            maxlength="40"
            value="${escapeHtml(name)}"
            required
          >
        </label>

        <label>
          ふりがな
          <input
            id="charKana"
            type="text"
            maxlength="60"
            value="${escapeHtml(kana)}"
          >
        </label>

        <label>
          プロフィール
          <textarea
            id="charProfile"
            rows="7"
            maxlength="800"
          >${escapeHtml(profile)}</textarea>
        </label>

        <label>
          タグ
          <input
            id="charTags"
            type="text"
            maxlength="160"
            value="${escapeHtml(tagText)}"
            placeholder="例：ファンタジー, 学園, 魔法"
          >
        </label>

        <p class="mini-info">
          タグはカンマ区切りで入力できます。
        </p>

        <label class="check-label">
          <input id="faOk" type="checkbox" ${faOk ? "checked" : ""}>
          ファンアート歓迎にする
        </label>

        <label class="check-label">
          <input id="isPublic" type="checkbox" ${isPublic ? "checked" : ""}>
          公開する
        </label>

        <label>
          NG・注意事項
          <textarea
            id="ngText"
            rows="5"
            maxlength="500"
            placeholder="描くときに避けてほしいことなど"
          >${escapeHtml(ngText)}</textarea>
        </label>

        <button class="primary-btn" type="submit">保存する</button>
        <p id="editMessage" class="message"></p>
      </section>

      <section class="panel">
        <h2>登録画像</h2>

        <div class="selected-drawing">
          <img src="${data.imageData}" alt="${escapeHtml(name)}">
        </div>

        <p class="mini-info">
          今回は画像の差し替えはできません。
        </p>

        <div class="actions">
          <a class="ghost-btn" href="/characters/file/?id=${encodeURIComponent(character.id)}">
            キャラファイルへ戻る
          </a>
        </div>
      </section>
    </form>
  `;

  const form = document.getElementById("characterEditForm");
  const message = document.getElementById("editMessage");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nextName = document.getElementById("charName").value.trim();
    const nextKana = document.getElementById("charKana").value.trim();
    const nextProfile = document.getElementById("charProfile").value.trim();
    const nextTags = textToTags(document.getElementById("charTags").value);
    const nextFaOk = document.getElementById("faOk").checked;
    const nextIsPublic = document.getElementById("isPublic").checked;
    const nextNgText = document.getElementById("ngText").value.trim();

    if (!nextName) {
      message.textContent = "キャラ名を入力してください。";
      return;
    }

    try {
      message.textContent = "保存しています...";

      await updateDoc(doc(db, "v2Characters", character.id), {
        name: nextName,
        kana: nextKana,
        profile: nextProfile,
        tags: nextTags,
        faOk: nextFaOk,
        isPublic: nextIsPublic,
        ngText: nextNgText,
        updatedAt: serverTimestamp()
      });

      message.textContent = "キャラ情報を保存しました。";

      setTimeout(() => {
        location.href = `/characters/file/?id=${encodeURIComponent(character.id)}`;
      }, 700);
    } catch (error) {
      console.error(error);
      message.textContent =
        "保存に失敗しました。少し時間を置いて、もう一度お試しください。";
    }
  });
}

async function init() {
  if (!characterId) {
    renderNoCharacterId();
    return;
  }

  if (!currentUser) {
    renderLoginRequired();
    return;
  }

  const character = await getCharacter();

  if (!character || character.data.isDeleted === true) {
    renderNotFound();
    return;
  }

  currentCharacter = character;

  if (currentCharacter.data.userId !== currentUser.uid) {
    renderNoPermission();
    return;
  }

  renderEditForm(currentCharacter);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  try {
    await init();
  } catch (error) {
    console.error(error);

    characterEditContent.innerHTML = `
      <section class="panel">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

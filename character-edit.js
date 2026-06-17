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

const DEFAULT_THEME = {
  bgColor: "#fff7fb",
  mainColor: "#ff7ab6",
  subColor: "#8bc6ff",
  textColor: "#3a2d35",
  cardColor: "#ffffff",
  radius: "24",
  pattern: "dot"
};

const THEME_PRESETS = {
  cute: {
    bgColor: "#fff7fb",
    mainColor: "#ff7ab6",
    subColor: "#8bc6ff",
    textColor: "#3a2d35",
    cardColor: "#ffffff",
    radius: "24",
    pattern: "dot"
  },
  pop: {
    bgColor: "#fff8d8",
    mainColor: "#ff7a59",
    subColor: "#58d68d",
    textColor: "#34291f",
    cardColor: "#ffffff",
    radius: "22",
    pattern: "dot"
  },
  cool: {
    bgColor: "#eef5ff",
    mainColor: "#4f7cff",
    subColor: "#7ad7ff",
    textColor: "#26314a",
    cardColor: "#ffffff",
    radius: "18",
    pattern: "stripe"
  },
  darkCute: {
    bgColor: "#2c2130",
    mainColor: "#ff70b8",
    subColor: "#b48cff",
    textColor: "#fff1fa",
    cardColor: "#3a2a42",
    radius: "24",
    pattern: "dot"
  },
  japanese: {
    bgColor: "#fff8ef",
    mainColor: "#d85c5c",
    subColor: "#f1bf6b",
    textColor: "#3a2c24",
    cardColor: "#fffdf8",
    radius: "16",
    pattern: "none"
  },
  cyber: {
    bgColor: "#edfaff",
    mainColor: "#00b8ff",
    subColor: "#a86bff",
    textColor: "#1d2440",
    cardColor: "#ffffff",
    radius: "14",
    pattern: "stripe"
  },
  simple: {
    bgColor: "#f8f8fb",
    mainColor: "#7777dd",
    subColor: "#b7b7ff",
    textColor: "#333344",
    cardColor: "#ffffff",
    radius: "18",
    pattern: "none"
  }
};

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

function getTheme(data) {
  return {
    ...DEFAULT_THEME,
    ...(data.customTheme || {})
  };
}

function getThemeFromForm() {
  return {
    bgColor: document.getElementById("themeBgColor").value,
    mainColor: document.getElementById("themeMainColor").value,
    subColor: document.getElementById("themeSubColor").value,
    textColor: document.getElementById("themeTextColor").value,
    cardColor: document.getElementById("themeCardColor").value,
    radius: document.getElementById("themeRadius").value,
    pattern: document.getElementById("themePattern").value
  };
}

function setThemeToForm(theme) {
  document.getElementById("themeBgColor").value = theme.bgColor;
  document.getElementById("themeMainColor").value = theme.mainColor;
  document.getElementById("themeSubColor").value = theme.subColor;
  document.getElementById("themeTextColor").value = theme.textColor;
  document.getElementById("themeCardColor").value = theme.cardColor;
  document.getElementById("themeRadius").value = theme.radius;
  document.getElementById("themePattern").value = theme.pattern;

  updateThemePreview();
}

function updateThemePreview() {
  const preview = document.getElementById("themePreview");
  const radiusText = document.getElementById("themeRadiusText");

  if (!preview) return;

  const theme = getThemeFromForm();

  preview.style.setProperty("--preview-bg", theme.bgColor);
  preview.style.setProperty("--preview-main", theme.mainColor);
  preview.style.setProperty("--preview-sub", theme.subColor);
  preview.style.setProperty("--preview-text", theme.textColor);
  preview.style.setProperty("--preview-card", theme.cardColor);
  preview.style.setProperty("--preview-radius", `${Number(theme.radius) || 24}px`);

  if (radiusText) {
    radiusText.textContent = `${theme.radius}px`;
  }
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
  const theme = getTheme(data);

  characterEditContent.innerHTML = `
    <section class="panel">
      <form id="characterEditForm" class="form">
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
          <textarea id="charProfile" rows="7" maxlength="2000">${escapeHtml(profile)}</textarea>
        </label>

        <label>
          タグ
          <input
            id="charTags"
            type="text"
            maxlength="200"
            value="${escapeHtml(tagText)}"
            placeholder="例：高校生, 魔法使い, 人外"
          >
        </label>

        <p class="help-text">タグはカンマ区切りで入力できます。</p>

        <label class="check-row">
          <input id="faOk" type="checkbox" ${faOk ? "checked" : ""}>
          ファンアート歓迎にする
        </label>

        <label class="check-row">
          <input id="isPublic" type="checkbox" ${isPublic ? "checked" : ""}>
          公開する
        </label>

        <label>
          NG・注意事項
          <textarea id="ngText" rows="5" maxlength="1200">${escapeHtml(ngText)}</textarea>
        </label>

        <section class="theme-editor">
          <h2>ページデザイン</h2>

          <p class="theme-editor-note">
            キャラファイルの見た目をカスタムできます。
            色と雰囲気で、この子だけのページにできます。
          </p>

          <label class="theme-field">
            テンプレート
            <select id="themePreset">
              <option value="">選択してください</option>
              <option value="cute">ゆめかわ</option>
              <option value="pop">ポップ</option>
              <option value="cool">クール</option>
              <option value="darkCute">闇かわ</option>
              <option value="japanese">和風</option>
              <option value="cyber">サイバー</option>
              <option value="simple">シンプル</option>
            </select>
          </label>

          <div class="theme-grid">
            <label class="theme-field">
              背景色
              <input id="themeBgColor" type="color" value="${escapeHtml(theme.bgColor)}">
            </label>

            <label class="theme-field">
              メイン色
              <input id="themeMainColor" type="color" value="${escapeHtml(theme.mainColor)}">
            </label>

            <label class="theme-field">
              サブ色
              <input id="themeSubColor" type="color" value="${escapeHtml(theme.subColor)}">
            </label>

            <label class="theme-field">
              文字色
              <input id="themeTextColor" type="color" value="${escapeHtml(theme.textColor)}">
            </label>

            <label class="theme-field">
              カード色
              <input id="themeCardColor" type="color" value="${escapeHtml(theme.cardColor)}">
            </label>

            <label class="theme-field">
              背景パターン
              <select id="themePattern">
                <option value="dot" ${theme.pattern === "dot" ? "selected" : ""}>ドット</option>
                <option value="stripe" ${theme.pattern === "stripe" ? "selected" : ""}>ストライプ</option>
                <option value="none" ${theme.pattern === "none" ? "selected" : ""}>なし</option>
              </select>
            </label>

            <label class="theme-field">
              角丸：<span id="themeRadiusText">${escapeHtml(theme.radius)}px</span>
              <input
                id="themeRadius"
                type="range"
                min="8"
                max="40"
                value="${escapeHtml(theme.radius)}"
              >
            </label>
          </div>

          <div id="themePreview" class="theme-preview">
            <div class="theme-preview-card">
              <span class="theme-preview-label">Preview</span>
              <h3>${escapeHtml(name || "キャラクター名")}</h3>
              <p>この子だけのキャラページを作れます。</p>
            </div>
          </div>
        </section>

        <div class="actions">
          <button class="primary-btn" type="submit">保存する</button>

          <a class="ghost-btn" href="/characters/file/?id=${encodeURIComponent(character.id)}">
            キャラファイルへ戻る
          </a>
        </div>

        <p id="editMessage" class="form-message"></p>
      </form>
    </section>

    <section class="panel">
      <h2>登録画像</h2>
      <p>今回は画像の差し替えはできません。</p>
    </section>
  `;

  const form = document.getElementById("characterEditForm");
  const message = document.getElementById("editMessage");
  const themePreset = document.getElementById("themePreset");

  const themeInputIds = [
    "themeBgColor",
    "themeMainColor",
    "themeSubColor",
    "themeTextColor",
    "themeCardColor",
    "themeRadius",
    "themePattern"
  ];

  themeInputIds.forEach((id) => {
    const input = document.getElementById(id);

    input.addEventListener("input", updateThemePreview);
    input.addEventListener("change", updateThemePreview);
  });

  themePreset.addEventListener("change", () => {
    const preset = THEME_PRESETS[themePreset.value];
    if (!preset) return;

    setThemeToForm(preset);
  });

  updateThemePreview();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nextName = document.getElementById("charName").value.trim();
    const nextKana = document.getElementById("charKana").value.trim();
    const nextProfile = document.getElementById("charProfile").value.trim();
    const nextTags = textToTags(document.getElementById("charTags").value);
    const nextFaOk = document.getElementById("faOk").checked;
    const nextIsPublic = document.getElementById("isPublic").checked;
    const nextNgText = document.getElementById("ngText").value.trim();
    const nextTheme = getThemeFromForm();

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
        customTheme: nextTheme,
        updatedAt: serverTimestamp()
      });

      message.textContent = "キャラ情報を保存しました。";

      setTimeout(() => {
        location.href = `/characters/file/?id=${encodeURIComponent(character.id)}`;
      }, 700);
    } catch (error) {
      console.error(error);
      message.textContent = "保存に失敗しました。少し時間を置いて、もう一度お試しください。";
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
import { db } from "/firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const characterFile = document.getElementById("characterFile");

const params = new URLSearchParams(location.search);
const characterId = params.get("id");

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

async function loadCharacterFile() {
  if (!characterId) {
    characterFile.innerHTML = `
      <section class="panel">
        <h1>キャラが選ばれていません</h1>
        <p>キャラ一覧から見たいキャラクターを選んでください。</p>

        <div class="actions">
          <a class="primary-btn" href="/characters/">キャラ一覧へ</a>
        </div>
      </section>
    `;
    return;
  }

  const ref = doc(db, "v2Characters", characterId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    characterFile.innerHTML = `
      <section class="panel">
        <h1>キャラが見つかりませんでした</h1>
        <p>削除されたか、URLが変わっている可能性があります。</p>

        <div class="actions">
          <a class="primary-btn" href="/characters/">キャラ一覧へ</a>
        </div>
      </section>
    `;
    return;
  }

  const character = snap.data();

  if (character.isDeleted === true || character.isPublic !== true) {
    characterFile.innerHTML = `
      <section class="panel">
        <h1>このキャラは表示できません</h1>
        <p>非公開、または削除済みの可能性があります。</p>

        <div class="actions">
          <a class="primary-btn" href="/characters/">キャラ一覧へ</a>
        </div>
      </section>
    `;
    return;
  }

  const tags = Array.isArray(character.tags)
    ? character.tags
        .map((tag) => `<span>${escapeHtml(tag)}</span>`)
        .join("")
    : "";

  characterFile.innerHTML = `
    <section class="character-detail-layout">
      <div class="character-detail-visual panel">
        <img
          class="character-detail-img"
          src="${character.imageData}"
          alt="${escapeHtml(character.name)}"
        >
      </div>

      <div class="character-detail-info panel">
        <p class="eyebrow">Character File</p>

        <h1>${escapeHtml(character.name)}</h1>

        ${
          character.kana
            ? `<p class="character-kana">${escapeHtml(character.kana)}</p>`
            : ""
        }

        <div class="character-status-row">
          <span class="status-badge">
            ${character.faOk ? "ファンアート歓迎" : "ファンアートは要確認"}
          </span>
        </div>

        <section class="detail-section">
          <h2>プロフィール</h2>
          <p>
            ${
              character.profile
                ? nl2br(character.profile)
                : "プロフィールはまだありません。"
            }
          </p>
        </section>

        ${
          tags
            ? `
              <section class="detail-section">
                <h2>タグ</h2>
                <div class="tag-list">
                  ${tags}
                </div>
              </section>
            `
            : ""
        }

        ${
          character.ngText
            ? `
              <section class="detail-section caution-box">
                <h2>NG・注意事項</h2>
                <p>${nl2br(character.ngText)}</p>
              </section>
            `
            : ""
        }

        <section class="detail-section">
  <h2>作者</h2>
  <p>
    <a class="text-link" href="/users/?id=${encodeURIComponent(character.userId)}">
      ${escapeHtml(character.ownerName || "作者名未設定")}
    </a>
  </p>
</section>

        <section class="detail-section">
          <h2>ファンアート</h2>
          <p>この子のファンアート機能は、イベント機能と一緒に追加予定です。</p>
        </section>

        <div class="actions">
          <a class="ghost-btn" href="/characters/">一覧へ戻る</a>
          <a class="primary-btn" href="/draw/">絵を描く</a>
        </div>
      </div>
    </section>
  `;
}

loadCharacterFile().catch((error) => {
  console.error(error);

  characterFile.innerHTML = `
    <section class="panel">
      <h1>読み込みに失敗しました</h1>
      <p>ページを再読み込みしてみてください。</p>

      <div class="actions">
        <a class="primary-btn" href="/characters/">キャラ一覧へ</a>
      </div>
    </section>
  `;
});

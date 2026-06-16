import { auth, db } from "/firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const workFile = document.getElementById("workFile");

const params = new URLSearchParams(location.search);
const workId = params.get("id");

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

function formatDate(value) {
  if (!value?.toDate) return "";

  const date = value.toDate();

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
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

function getJoinDescription(type) {
  if (type === "free") {
    return "この作品は自由参加です。参加したい人が気軽に入れる設定です。";
  }

  if (type === "approval") {
    return "この作品は承認制です。参加にはオーナーの確認が必要です。";
  }

  return "この作品は現在、参加募集をしていません。";
}

function renderNotFound() {
  workFile.innerHTML = `
    <section class="card message-card">
      <h1>作品が見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <a class="primary-link" href="/works/">作品一覧へ</a>
    </section>
  `;
}

async function getWork() {
  if (!workId) return null;

  const workRef = doc(db, "works", workId);
  const snap = await getDoc(workRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

function renderWork(work) {
  const data = work.data;

  if (data.isDeleted === true) {
    renderNotFound();
    return;
  }

  const isOwner = currentUser && currentUser.uid === data.userId;

  if (data.isPublic !== true && !isOwner) {
    workFile.innerHTML = `
      <section class="card message-card">
        <h1>この作品は非公開です</h1>
        <p>公開されていない作品です。</p>
        <a class="primary-link" href="/works/">作品一覧へ</a>
      </section>
    `;
    return;
  }

  const isShared = data.workType === "shared";

  workFile.innerHTML = `
    <article class="work-file-card">
      <section class="card work-file-hero">
        <p class="eyebrow">Works</p>

        <div class="work-file-head">
          <div>
            <h1>${escapeHtml(data.title || "作品名未設定")}</h1>

            <p class="work-owner">
              by ${escapeHtml(data.ownerName || "作者名未設定")}
            </p>
          </div>

          <div class="badge-row">
            <span class="badge">${escapeHtml(getWorkTypeLabel(data.workType))}</span>
            ${
              isShared
                ? `<span class="badge muted">${escapeHtml(getJoinTypeLabel(data.joinType))}</span>`
                : ""
            }
            ${
              data.isPublic === false
                ? `<span class="badge muted">非公開</span>`
                : ""
            }
          </div>
        </div>

        <div class="work-stats work-file-stats">
          <span>キャラ ${Number(data.characterCount || 0)}</span>
          <span>FA ${Number(data.fanartCount || 0)}</span>
          ${
            data.createdAt
              ? `<span>${escapeHtml(formatDate(data.createdAt))}</span>`
              : ""
          }
        </div>

        <div class="button-row">
          ${
            isOwner
              ? `<a class="primary-link" href="/works/edit/?id=${work.id}">編集する</a>`
              : ""
          }

          <a class="primary-link" href="/works/">作品一覧へ</a>
        </div>
      </section>

      <section class="card">
        <h2>作品説明</h2>
        ${
          data.description
            ? `<p>${nl2br(data.description)}</p>`
            : `<p>作品説明はまだありません。</p>`
        }
      </section>

      ${
        isShared
          ? `
            <section class="card">
              <h2>参加設定</h2>

              <div class="badge-row">
                <span class="badge">${escapeHtml(getJoinTypeLabel(data.joinType))}</span>
              </div>

              <p>${escapeHtml(getJoinDescription(data.joinType))}</p>

              ${
                data.joinType === "free"
                  ? `
                    <div class="button-row">
                      <a class="primary-link" href="/works/join/?id=${work.id}">
                        この作品に参加する
                      </a>
                    </div>
                  `
                  : ""
              }

              ${
                data.joinType === "approval"
                  ? `
                    <div class="button-row">
                      <a class="primary-link" href="/works/join/?id=${work.id}">
                        参加申請する
                      </a>
                    </div>
                  `
                  : ""
              }
            </section>

            <section class="card">
              <h2>ルール・注意事項</h2>
              ${
                data.rulesText
                  ? `<p>${nl2br(data.rulesText)}</p>`
                  : `<p>ルールはまだ設定されていません。</p>`
              }
            </section>
          `
          : ""
      }

      <section class="card">
  <h2>この作品のキャラクター</h2>

  <p>
    作品に所属するキャラクター一覧は、次のステップで追加します。
  </p>

  <div class="button-row">
    ${
      isOwner
        ? `<a class="primary-link" href="/works/add-character/?id=${work.id}">キャラを追加する</a>`
        : ""
    }

    <a class="primary-link" href="/characters/">
      キャラ一覧を見る
    </a>
  </div>
</section>

      <section class="card">
        <h2>この作品のファンアート</h2>

        <p>
          作品に紐づいたFA一覧は、次のステップで追加します。
        </p>

        <div class="button-row">
          <a class="primary-link" href="/fanarts/">
            FA一覧を見る
          </a>
        </div>
      </section>
    </article>
  `;
}

async function init() {
  if (!workId) {
    renderNotFound();
    return;
  }

  const work = await getWork();

  if (!work) {
    renderNotFound();
    return;
  }

  renderWork(work);
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  init().catch((error) => {
    console.error(error);

    workFile.innerHTML = `
      <section class="card message-card">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  });
});

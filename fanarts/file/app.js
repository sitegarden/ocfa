import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const fanartFile = document.getElementById("fanartFile");

const params = new URLSearchParams(location.search);
const fanartId = params.get("id");

let currentUser = null;
let currentFanart = null;

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

function getFanartImageSrc(data) {
  return data.imageUrl || data.imageData || "";
}

function formatDate(value) {
  if (!value?.toDate) return "";

  const date = value.toDate();

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function renderNotFound() {
  fanartFile.innerHTML = `
    <section class="card message-card">
      <h1>ファンアートが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <a class="primary-link" href="/fanarts/">FA一覧へ</a>
    </section>
  `;
}

async function getFanart() {
  if (!fanartId) return null;

  const fanartRef = doc(db, "v2Fanarts", fanartId);
  const snap = await getDoc(fanartRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getUserName(user) {
  if (!user) return "";

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    return user.displayName || "名前未設定";
  }

  const data = snap.data();

  return data.displayName || user.displayName || "名前未設定";
}

async function loadComments() {
  const commentList = document.getElementById("fanartCommentList");

  if (!commentList || !fanartId) return;

  try {
    const commentsQuery = query(
      collection(db, "v2FanartComments"),
      where("fanartId", "==", fanartId),
      limit(80)
    );

    const snap = await getDocs(commentsQuery);

    if (snap.empty) {
      commentList.innerHTML = `
        <div class="empty-preview">
          まだ感想はありません。
        </div>
      `;
      return;
    }

    const comments = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.isDeleted === true) return;

      comments.push({
        id: docSnap.id,
        data
      });
    });

    if (comments.length === 0) {
      commentList.innerHTML = `
        <div class="empty-preview">
          まだ感想はありません。
        </div>
      `;
      return;
    }

    comments.sort((a, b) => {
      const aTime = a.data.createdAt?.toMillis?.() || 0;
      const bTime = b.data.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    commentList.innerHTML = "";

    comments.forEach((item) => {
      const data = item.data;

      const card = document.createElement("article");
      card.className = "fanart-comment-card";

      card.innerHTML = `
        <div class="fanart-comment-head">
          <strong>${escapeHtml(data.userName || "名前未設定")}</strong>
          ${
            data.createdAt
              ? `<span>${escapeHtml(formatDate(data.createdAt))}</span>`
              : ""
          }
        </div>

        <p>${nl2br(data.body || "")}</p>
      `;

      commentList.appendChild(card);
    });
  } catch (error) {
    console.error("感想読み込みエラー:", error);

    commentList.innerHTML = `
      <div class="empty-preview">
        感想の読み込みに失敗しました。
      </div>
    `;
  }
}

async function submitComment(e) {
  e.preventDefault();

  const commentInput = document.getElementById("fanartCommentInput");
  const message = document.getElementById("fanartCommentMessage");

  if (!currentUser) {
    message.textContent = "感想を書くにはログインしてください。";
    return;
  }

  if (!currentFanart) {
    message.textContent = "ファンアート情報が見つかりません。";
    return;
  }

  const body = commentInput.value.trim();

  if (body.length < 20) {
    message.textContent = "あと少しだけ感想を書いてもらえると嬉しいです。20文字以上でお願いします。";
    return;
  }

  if (body.length > 500) {
    message.textContent = "気持ちはたっぷり届いてます。感想は500文字以内でお願いします。";
    return;
  }

  try {
    message.textContent = "感想を投稿しています...";

    const userName = await getUserName(currentUser);

    await addDoc(collection(db, "v2FanartComments"), {
      fanartId,
      characterId: currentFanart.characterId || "",

      userId: currentUser.uid,
      userName,
      userPhotoURL: currentUser.photoURL || "",

      body,

      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    commentInput.value = "";
    message.textContent = "感想を投稿しました。";

    await loadComments();
  } catch (error) {
    console.error("感想投稿エラー:", error);
    message.textContent = "感想の投稿に失敗しました。時間を置いてもう一度お試しください。";
  }
}

function renderFanart(fanart) {
  const data = fanart.data;
  currentFanart = data;

  const imageSrc = getFanartImageSrc(data);

  fanartFile.innerHTML = `
    <article class="fanart-file-card">
      <section class="card fanart-file-visual">
        ${
          imageSrc
            ? `<img src="${imageSrc}" alt="${escapeHtml(data.characterName || "ファンアート")}">`
            : `<div class="empty-preview">画像がありません。</div>`
        }
      </section>

      <section class="card fanart-file-info">
        <p class="eyebrow">Fan Art</p>

        <h1>${escapeHtml(data.characterName || "キャラ名未設定")}へのFA</h1>

        <div class="badge-row">
          <span class="badge">${data.imageSource === "upload" ? "画像投稿" : "過去のお絵描き投稿"}</span>
          ${
            data.createdAt
              ? `<span class="badge muted">${escapeHtml(formatDate(data.createdAt))}</span>`
              : ""
          }
        </div>

        <p class="fanart-artist">
          by ${escapeHtml(data.artistName || "作者名未設定")}
        </p>

        <section class="mini-section">
          <h2>投稿コメント</h2>
          <p>
            ${data.comment ? nl2br(data.comment) : "コメントはありません。"}
          </p>
        </section>

        <div class="button-row">
          ${
            data.characterId
              ? `<a class="primary-link" href="/characters/file/?id=${escapeHtml(data.characterId)}">この子を見る</a>`
              : ""
          }
          <a class="primary-link" href="/fanarts/">FA一覧へ</a>
        </div>
      </section>

      <section class="card">
        <h2>感想を書く</h2>

        ${
          currentUser
            ? `
              <form id="fanartCommentForm">
                <textarea
                  id="fanartCommentInput"
                  rows="5"
                  minlength="20"
                  maxlength="500"
                  placeholder="描いてくれて嬉しかったところ、好きなところなどを書いてみてください。"
                ></textarea>

                <p class="muted-text">
                  感想は20文字以上、500文字以内で投稿できます。
                </p>

                <div class="button-row">
                  <button type="submit" class="primary-btn">
                    感想を投稿する
                  </button>
                </div>

                <p id="fanartCommentMessage"></p>
              </form>
            `
            : `
              <p>感想を書くにはログインしてください。</p>
            `
        }
      </section>

      <section class="card">
        <h2>感想一覧</h2>

        <div id="fanartCommentList" class="fanart-comment-list">
          <p>感想を読み込み中...</p>
        </div>
      </section>
    </article>
  `;

  const form = document.getElementById("fanartCommentForm");

  if (form) {
    form.addEventListener("submit", submitComment);
  }

  loadComments();
}

async function init() {
  if (!fanartId) {
    renderNotFound();
    return;
  }

  const fanart = await getFanart();

  if (!fanart) {
    renderNotFound();
    return;
  }

  if (fanart.data.isDeleted === true || fanart.data.isPublic !== true) {
    renderNotFound();
    return;
  }

  renderFanart(fanart);
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  init().catch((error) => {
    console.error(error);

    fanartFile.innerHTML = `
      <section class="card message-card">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  });
});

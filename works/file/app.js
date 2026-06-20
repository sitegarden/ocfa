import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const workFile = document.getElementById("workFile");

const params = new URLSearchParams(location.search);
const workId = params.get("id");

let currentUser = null;
let currentWork = null;

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

function getCharacterImageSrc(data) {
  return data?.imageUrl || data?.imageData || "";
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

async function loadWorkCharacters() {
  const characterList = document.getElementById("workCharacterList");

  if (!characterList || !workId) return;

  try {
    const charactersQuery = query(
      collection(db, "v2Characters"),
      where("workId", "==", workId),
      limit(80)
    );

    const snap = await getDocs(charactersQuery);
    const characters = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.isDeleted === true) return;
      if (data.isPublic !== true && data.userId !== currentUser?.uid) return;

      characters.push({
        id: docSnap.id,
        data
      });
    });

    if (characters.length === 0) {
      characterList.innerHTML = `
        <div class="empty-preview">
          まだ表示できるキャラクターはいません。
        </div>
      `;
      return;
    }

    characters.sort((a, b) => {
      const aName = a.data.kana || a.data.name || "";
      const bName = b.data.kana || b.data.name || "";

      return aName.localeCompare(bName, "ja");
    });

    const isOwner =
      currentUser &&
      currentWork &&
      currentWork.data.userId === currentUser.uid;

    characterList.innerHTML = characters
      .map(({ id, data }) => {
        const imageSrc = getCharacterImageSrc(data);

        return `
          <article class="character-card">
            <a
              class="character-link"
              href="/characters/file/?id=${encodeURIComponent(id)}"
            >
              <div class="character-thumb">
                ${
                  imageSrc
                    ? `
                      <img
                        class="character-img"
                        src="${escapeHtml(imageSrc)}"
                        alt="${escapeHtml(data.name || "キャラクター画像")}"
                      >
                    `
                    : `<div class="no-image">No Image</div>`
                }
              </div>

              <div class="character-body">
                <h2>${escapeHtml(data.name || "名前未設定")}</h2>

                ${
                  data.kana
                    ? `<p class="character-kana">${escapeHtml(data.kana)}</p>`
                    : ""
                }

                <p class="character-profile">
                  ${escapeHtml(data.profile || "プロフィールはまだありません。")}
                </p>
              </div>
            </a>

            ${
              isOwner
                ? `
                  <div class="work-character-actions">
                    <button
                      type="button"
                      class="ghost-btn remove-work-character-btn"
                      data-character-id="${escapeHtml(id)}"
                    >
                      作品から外す
                    </button>
                  </div>
                `
                : ""
            }
          </article>
        `;
      })
      .join("");

    document
      .querySelectorAll(".remove-work-character-btn")
      .forEach((button) => {
        button.addEventListener("click", () => {
          removeCharacterFromWork(button.dataset.characterId);
        });
      });
  } catch (error) {
    console.error("作品キャラ読み込みエラー:", error);

    characterList.innerHTML = `
      <div class="empty-preview">
        キャラクターの読み込みに失敗しました。<br>
        ${escapeHtml(error.message || "")}
      </div>
    `;
  }
}

async function loadWorkMembers() {
  const memberList = document.getElementById("workMemberList");

  if (!memberList || !workId) return;

  try {
    const membersQuery = query(
      collection(db, "workMembers"),
      where("workId", "==", workId),
      limit(100)
    );

    const snap = await getDocs(membersQuery);
    const members = [];

    snap.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.isDeleted === true) return;
      if (data.status !== "approved") return;

      members.push({
        id: docSnap.id,
        data
      });
    });

    if (members.length === 0) {
      memberList.innerHTML = `
        <div class="empty-preview">
          まだ参加者はいません。
        </div>
      `;
      return;
    }

    members.sort((a, b) => {
      const aName = a.data.userName || "";
      const bName = b.data.userName || "";

      return aName.localeCompare(bName, "ja");
    });

    memberList.innerHTML = members
      .map(({ data }) => {
        const userName = data.userName || "名前未設定";

        return `
          <article class="member-card compact-member-card">
            <div class="member-main">
              <div class="member-avatar">
                ${
                  data.userPhotoURL
                    ? `
                      <img
                        src="${escapeHtml(data.userPhotoURL)}"
                        alt="${escapeHtml(userName)}のアイコン"
                      >
                    `
                    : `<span>${escapeHtml(userName.slice(0, 1) || "?")}</span>`
                }
              </div>

              <div class="member-info">
                <h3>${escapeHtml(userName)}</h3>

                <div class="badge-row">
                  <span class="badge muted">参加中</span>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  } catch (error) {
    console.error("作品参加者読み込みエラー:", error);

    memberList.innerHTML = `
      <div class="empty-preview">
        参加者の読み込みに失敗しました。<br>
        ${escapeHtml(error.message || "")}
      </div>
    `;
  }
}

async function removeCharacterFromWork(characterId) {
  if (!currentUser || !currentWork) {
    alert("ログイン情報または作品情報が見つかりません。");
    return;
  }

  if (currentWork.data.userId !== currentUser.uid) {
    alert("作品オーナーだけがキャラクターを外せます。");
    return;
  }

  const ok = confirm("このキャラクターを作品から外しますか？");

  if (!ok) return;

  try {
    const characterRef = doc(db, "v2Characters", characterId);
    const characterSnap = await getDoc(characterRef);

    if (!characterSnap.exists()) {
      alert("キャラクターが見つかりませんでした。");
      return;
    }

    const characterData = characterSnap.data();

    if (characterData.workId !== workId) {
      alert("このキャラクターは、この作品に所属していません。");
      return;
    }

    await updateDoc(characterRef, {
      workId: "",
      workTitle: "",
      workOwnerUid: "",
      workType: "",
      updatedAt: serverTimestamp()
    });

    const workRef = doc(db, "works", workId);

    await updateDoc(workRef, {
      characterCount: increment(-1),
      updatedAt: serverTimestamp()
    });

    await loadWorkCharacters();
  } catch (error) {
    console.error("作品からキャラを外すエラー:", error);

    alert(`キャラクターを外せませんでした。${error.message || ""}`);
  }
}

function renderWork(work) {
  const data = work.data;
  currentWork = work;

  if (data.isDeleted === true) {
    renderNotFound();
    return;
  }

  const isOwner =
    currentUser &&
    currentUser.uid === data.userId;

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
            <span class="badge">
              ${escapeHtml(getWorkTypeLabel(data.workType))}
            </span>

            ${
              isShared
                ? `
                  <span class="badge muted">
                    ${escapeHtml(getJoinTypeLabel(data.joinType))}
                  </span>
                `
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
              ? `
                <a
                  class="primary-link"
                  href="/works/edit/?id=${encodeURIComponent(work.id)}"
                >
                  編集する
                </a>
              `
              : ""
          }

          <a class="ghost-btn" href="/works/">
            作品一覧へ
          </a>
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
                <span class="badge">
                  ${escapeHtml(getJoinTypeLabel(data.joinType))}
                </span>
              </div>

              <p>${escapeHtml(getJoinDescription(data.joinType))}</p>

              ${
                data.joinType === "free"
                  ? `
                    <div class="button-row">
                      <a
                        class="primary-link"
                        href="/works/join/?id=${encodeURIComponent(work.id)}"
                      >
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
                      <a
                        class="primary-link"
                        href="/works/join/?id=${encodeURIComponent(work.id)}"
                      >
                        参加申請する
                      </a>
                    </div>
                  `
                  : ""
              }

              ${
                isOwner
                  ? `
                    <div class="button-row">
                      <a
                        class="ghost-btn"
                        href="/works/members/?id=${encodeURIComponent(work.id)}"
                      >
                        参加申請を管理する
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

            <section class="card">
              <h2>参加者</h2>

              ${
                isOwner
                  ? `
                    <div class="button-row">
                      <a
                        class="ghost-btn"
                        href="/works/members/?id=${encodeURIComponent(work.id)}"
                      >
                        参加申請を管理する
                      </a>
                    </div>
                  `
                  : ""
              }

              <div id="workMemberList" class="member-list">
                <p>参加者を読み込み中...</p>
              </div>
            </section>
          `
          : ""
      }

      <section class="card">
        <h2>この作品のキャラクター</h2>

        <div class="button-row">
          ${
            isOwner
              ? `
                <a
                  class="primary-link"
                  href="/works/add-character/?id=${encodeURIComponent(work.id)}"
                >
                  キャラを追加する
                </a>
              `
              : ""
          }

          <a class="ghost-btn" href="/characters/">
            キャラ一覧を見る
          </a>
        </div>

        <div id="workCharacterList" class="character-grid">
          <p>キャラクターを読み込み中...</p>
        </div>
      </section>

      <section class="card">
        <h2>この作品のファンアート</h2>

        <p>
          作品に紐づいたFA一覧は、次のステップで追加します。
        </p>

        <div class="button-row">
          <a class="ghost-btn" href="/fanarts/">
            FA一覧を見る
          </a>
        </div>
      </section>
    </article>
  `;

  loadWorkCharacters();

  if (isShared) {
    loadWorkMembers();
  }
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

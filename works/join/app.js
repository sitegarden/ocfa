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

const params = new URLSearchParams(location.search);
const workId = params.get("id");

const joinContent = document.getElementById("joinContent");

let currentUser = null;
let currentUserData = null;
let currentWork = null;
let existingMember = null;

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

function getJoinTypeLabel(type) {
  if (type === "free") return "自由参加";
  if (type === "approval") return "承認制";

  return "募集なし";
}

function getUserName() {
  return currentUserData?.displayName || "名前未設定";
}

function getUserPhotoUrl() {
  return (
    currentUserData?.iconImageUrl ||
    currentUserData?.iconImageData ||
    currentUserData?.photoURL ||
    currentUserData?.googlePhotoURL ||
    currentUser?.photoURL ||
    ""
  );
}

function renderMessage(title, body, linkHtml = "") {
  joinContent.innerHTML = `
    <section class="panel message-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>

      <div class="button-row">
        ${linkHtml}

        <a class="ghost-btn" href="/works/">
          作品一覧へ
        </a>
      </div>
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

async function getUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getExistingMember(user) {
  const memberQuery = query(
    collection(db, "workMembers"),
    where("workId", "==", workId),
    where("userId", "==", user.uid),
    limit(1)
  );

  const snap = await getDocs(memberQuery);

  if (snap.empty) return null;

  const first = snap.docs[0];

  return {
    id: first.id,
    data: first.data()
  };
}

function renderJoinPage() {
  const data = currentWork.data;
  const isOwner = currentUser && data.userId === currentUser.uid;

  if (isOwner) {
    renderMessage(
      "この作品のオーナーです",
      "オーナーはすでに作品を管理できます。",
      `
        <a
          class="primary-link"
          href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
        >
          作品詳細へ
        </a>
      `
    );
    return;
  }

  if (data.isDeleted === true || data.isPublic !== true) {
    renderMessage(
      "参加できません",
      "この作品は現在参加できません。"
    );
    return;
  }

  if (data.workType !== "shared") {
    renderMessage(
      "参加できません",
      "この作品は共有作品ではありません。",
      `
        <a
          class="primary-link"
          href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
        >
          作品詳細へ
        </a>
      `
    );
    return;
  }

  if (existingMember) {
    const status = existingMember.data.status;

    if (status === "approved") {
      renderMessage(
        "参加済みです",
        "この作品にはすでに参加しています。",
        `
          <a
            class="primary-link"
            href="/works/add-character/?id=${encodeURIComponent(currentWork.id)}"
          >
            キャラを追加する
          </a>

          <a
            class="ghost-btn"
            href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
          >
            作品詳細へ
          </a>
        `
      );
      return;
    }

    if (status === "pending") {
      renderMessage(
        "申請中です",
        "参加申請を送信済みです。オーナーの承認をお待ちください。",
        `
          <a
            class="primary-link"
            href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
          >
            作品詳細へ
          </a>
        `
      );
      return;
    }

    renderMessage(
      "参加できません",
      "この作品への参加状態を確認できませんでした。",
      `
        <a
          class="primary-link"
          href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
        >
          作品詳細へ
        </a>
      `
    );
    return;
  }

  if (data.joinType === "closed") {
    renderMessage(
      "現在は募集していません",
      "この作品は現在、参加募集をしていません。",
      `
        <a
          class="primary-link"
          href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
        >
          作品詳細へ
        </a>
      `
    );
    return;
  }

  joinContent.innerHTML = `
    <section class="panel works-join-card">
      <p class="eyebrow">Join Work</p>

      <h2>${escapeHtml(data.title || "作品名未設定")}</h2>

      <div class="badge-row">
        <span class="badge">共有作品</span>
        <span class="badge muted">
          ${escapeHtml(getJoinTypeLabel(data.joinType))}
        </span>
      </div>

      <p>
        ${
          data.joinType === "free"
            ? "この作品は自由参加です。参加すると、自分のキャラクターを作品に追加できるようになります。"
            : "この作品は承認制です。参加申請を送ると、オーナーが確認できます。"
        }
      </p>

      ${
        data.rulesText
          ? `
            <section class="mini-section">
              <h3>ルール・注意事項</h3>
              <p>${nl2br(data.rulesText)}</p>
            </section>
          `
          : ""
      }

      <div class="button-row">
        <button id="joinButton" type="button" class="primary-btn">
          ${
            data.joinType === "free"
              ? "この作品に参加する"
              : "参加申請を送る"
          }
        </button>

        <a
          class="ghost-btn"
          href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
        >
          作品詳細へ戻る
        </a>
      </div>

      <p id="message" class="form-message"></p>
    </section>
  `;

  document.getElementById("joinButton")?.addEventListener("click", joinWork);
}

async function joinWork() {
  const message = document.getElementById("message");

  if (!currentUser || !currentWork || !message) {
    return;
  }

  const data = currentWork.data;

  try {
    message.textContent = "参加情報を作成しています...";

    const status = data.joinType === "free"
      ? "approved"
      : "pending";

    await addDoc(collection(db, "workMembers"), {
      workId,
      workTitle: data.title || "",
      ownerUid: data.userId || "",

      userId: currentUser.uid,
      userName: getUserName(),
      userPhotoURL: getUserPhotoUrl(),

      status,
      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (status === "approved") {
      message.textContent = "作品に参加しました。";

      setTimeout(() => {
        location.href =
          `/works/add-character/?id=${encodeURIComponent(workId)}`;
      }, 700);

      return;
    }

    message.textContent = "参加申請を送りました。";

    setTimeout(() => {
      location.href =
        `/works/file/?id=${encodeURIComponent(workId)}`;
    }, 700);
  } catch (error) {
    console.error("作品参加エラー:", error);

    message.textContent =
      `参加に失敗しました。${error.message || ""}`;
  }
}

async function init(user) {
  if (!user) {
    renderMessage(
      "ログインが必要です",
      "作品に参加するにはログインしてください。"
    );
    return;
  }

  currentUser = user;

  const [work, userData] = await Promise.all([
    getWork(),
    getUserData(user)
  ]);

  currentUserData = userData;

  if (!work) {
    renderMessage(
      "作品が見つかりません",
      "削除されたか、URLが変わっている可能性があります。"
    );
    return;
  }

  currentWork = work;
  existingMember = await getExistingMember(user);

  renderJoinPage();
}

onAuthStateChanged(auth, (user) => {
  init(user).catch((error) => {
    console.error(error);

    renderMessage(
      "読み込みに失敗しました",
      "ページを再読み込みしてみてください。"
    );
  });
});

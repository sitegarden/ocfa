import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const params = new URLSearchParams(location.search);
const workId = params.get("id");

const memberManageContent = document.getElementById("memberManageContent");

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

function renderMessage(title, body) {
  memberManageContent.innerHTML = `
    <section class="card message-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>

      <div class="button-row">
        <a class="primary-link" href="/works/">
          作品一覧へ
        </a>
      </div>
    </section>
  `;
}

function getStatusLabel(status) {
  if (status === "approved") return "承認済み";
  if (status === "pending") return "申請中";
  if (status === "rejected") return "見送り";
  if (status === "left") return "退出済み";

  return "不明";
}

function formatDate(value) {
  if (!value?.toDate) return "";

  const date = value.toDate();

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
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

async function loadMembers() {
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

      members.push({
        id: docSnap.id,
        data
      });
    });

    members.sort((a, b) => {
      const statusOrder = {
        pending: 1,
        approved: 2,
        rejected: 3,
        left: 4
      };

      const aOrder = statusOrder[a.data.status] || 99;
      const bOrder = statusOrder[b.data.status] || 99;

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      const aTime = a.data.createdAt?.toMillis?.() || 0;
      const bTime = b.data.createdAt?.toMillis?.() || 0;

      return bTime - aTime;
    });

    renderMembers(members);
  } catch (error) {
    console.error("参加申請読み込みエラー:", error);

    memberManageContent.innerHTML = `
      <section class="card message-card">
        <h2>読み込みに失敗しました</h2>
        <p>
          ${escapeHtml(
            error.message || "時間を置いてもう一度お試しください。"
          )}
        </p>
      </section>
    `;
  }
}

function renderMembers(members) {
  const workData = currentWork.data;

  memberManageContent.innerHTML = `
    <section class="card works-members-work-card">
      <p class="eyebrow">Members</p>
      <h2>${escapeHtml(workData.title || "作品名未設定")}</h2>

      <p>
        参加申請と参加者を確認できます。
      </p>

      <div class="button-row">
        <a
          class="ghost-btn"
          href="/works/file/?id=${encodeURIComponent(currentWork.id)}"
        >
          作品詳細へ戻る
        </a>
      </div>
    </section>

    <section class="card">
      <h2>参加申請・参加者</h2>

      <div id="memberList" class="member-list">
        ${
          members.length === 0
            ? `
              <div class="empty-preview">
                まだ参加申請はありません。
              </div>
            `
            : ""
        }
      </div>
    </section>
  `;

  const memberList = document.getElementById("memberList");

  if (!memberList || members.length === 0) return;

  members.forEach((item) => {
    const data = item.data;
    const userName = data.userName || "名前未設定";

    const card = document.createElement("article");
    card.className = "member-card";

    card.innerHTML = `
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
              : `
                <span>
                  ${escapeHtml(userName.slice(0, 1) || "?")}
                </span>
              `
          }
        </div>

        <div class="member-info">
          <h3>${escapeHtml(userName)}</h3>

          <div class="badge-row">
            <span class="badge">
              ${escapeHtml(getStatusLabel(data.status))}
            </span>

            ${
              data.createdAt
                ? `
                  <span class="badge muted">
                    ${escapeHtml(formatDate(data.createdAt))}
                  </span>
                `
                : ""
            }
          </div>
        </div>
      </div>

      <div class="button-row">
        ${
          data.status === "pending"
            ? `
              <button
                type="button"
                class="primary-btn approve-member-btn"
                data-member-id="${escapeHtml(item.id)}"
              >
                承認する
              </button>

              <button
                type="button"
                class="ghost-btn reject-member-btn"
                data-member-id="${escapeHtml(item.id)}"
              >
                見送る
              </button>
            `
            : ""
        }

        ${
          data.status === "approved"
            ? `<span class="badge muted">参加中</span>`
            : ""
        }
      </div>
    `;

    memberList.appendChild(card);
  });

  document.querySelectorAll(".approve-member-btn").forEach((button) => {
    button.addEventListener("click", () => {
      updateMemberStatus(button.dataset.memberId, "approved");
    });
  });

  document.querySelectorAll(".reject-member-btn").forEach((button) => {
    button.addEventListener("click", () => {
      updateMemberStatus(button.dataset.memberId, "rejected");
    });
  });
}

async function updateMemberStatus(memberId, status) {
  if (!currentUser || !currentWork) return;

  if (currentWork.data.userId !== currentUser.uid) {
    alert("作品オーナーだけが操作できます。");
    return;
  }

  const label = status === "approved" ? "承認" : "見送り";

  if (!confirm(`この参加申請を${label}しますか？`)) {
    return;
  }

  try {
    const memberRef = doc(db, "workMembers", memberId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      alert("参加申請が見つかりませんでした。");
      return;
    }

    const memberData = memberSnap.data();

    if (memberData.workId !== workId) {
      alert("この作品の参加申請ではありません。");
      return;
    }

    await updateDoc(memberRef, {
      status,
      updatedAt: serverTimestamp()
    });

    await loadMembers();
  } catch (error) {
    console.error("参加申請更新エラー:", error);
    alert(`更新に失敗しました。${error.message || ""}`);
  }
}

async function init(user) {
  if (!user) {
    renderMessage(
      "ログインが必要です",
      "参加申請を管理するにはログインしてください。"
    );
    return;
  }

  currentUser = user;

  const work = await getWork();

  if (!work || work.data.isDeleted === true) {
    renderMessage(
      "作品が見つかりません",
      "削除されたか、URLが変わっている可能性があります。"
    );
    return;
  }

  currentWork = work;

  if (work.data.userId !== user.uid) {
    renderMessage(
      "管理できません",
      "参加申請を管理できるのは作品オーナーだけです。"
    );
    return;
  }

  if (work.data.workType !== "shared") {
    renderMessage(
      "共有作品ではありません",
      "参加申請管理は共有作品で使えます。"
    );
    return;
  }

  await loadMembers();
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

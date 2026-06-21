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

const workForm = document.getElementById("workForm");
const workTitle = document.getElementById("workTitle");
const workDescription = document.getElementById("workDescription");
const sharedSettings = document.getElementById("sharedSettings");
const rulesText = document.getElementById("rulesText");
const isPublic = document.getElementById("isPublic");
const message = document.getElementById("message");
const pageMessage = document.getElementById("pageMessage");
const saveButton = document.getElementById("saveButton");
const backToWorkLink = document.getElementById("backToWorkLink");

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

function getSelectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function setSelectedValue(name, value) {
  const input = document.querySelector(
    `input[name="${name}"][value="${value}"]`
  );

  if (input) {
    input.checked = true;
  }
}

function updateSharedSettings() {
  const workType = getSelectedValue("workType");

  sharedSettings.hidden = workType !== "shared";
}

function showPageMessage(title, text, linkText = "", linkHref = "") {
  pageMessage.hidden = false;
  workForm.hidden = true;

  pageMessage.innerHTML = `
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(text)}</p>
    ${
      linkText && linkHref
        ? `
          <a class="primary-link" href="${escapeHtml(linkHref)}">
            ${escapeHtml(linkText)}
          </a>
        `
        : ""
    }
  `;
}

function showEditor() {
  pageMessage.hidden = true;
  workForm.hidden = false;
}

function fillForm(data) {
  workTitle.value = data.title || "";
  workDescription.value = data.description || "";

  const workType = data.workType === "shared"
    ? "shared"
    : "personal";

  setSelectedValue("workType", workType);

  const joinType = [
    "free",
    "approval",
    "closed"
  ].includes(data.joinType)
    ? data.joinType
    : "free";

  setSelectedValue("joinType", joinType);

  rulesText.value = data.rulesText || "";
  isPublic.checked = data.isPublic === true;

  updateSharedSettings();
}

async function loadWork() {
  if (!currentUser) return;

  if (!workId) {
    showPageMessage(
      "作品が見つかりません",
      "編集する作品が指定されていません。",
      "作品一覧へ",
      "/works/"
    );
    return;
  }

  try {
    const workRef = doc(db, "works", workId);
    const workSnap = await getDoc(workRef);

    if (!workSnap.exists()) {
      showPageMessage(
        "作品が見つかりません",
        "この作品は削除されたか、存在しないようです。",
        "作品一覧へ",
        "/works/"
      );
      return;
    }

    const workData = workSnap.data();

    if (workData.isDeleted === true) {
      showPageMessage(
        "作品が見つかりません",
        "この作品は削除されたか、存在しないようです。",
        "作品一覧へ",
        "/works/"
      );
      return;
    }

    if (workData.userId !== currentUser.uid) {
      showPageMessage(
        "編集できません",
        "この作品を編集できるのは作成者だけです。",
        "作品ページへ戻る",
        `/works/file/?id=${encodeURIComponent(workId)}`
      );
      return;
    }

    currentWork = {
      id: workSnap.id,
      data: workData
    };

    fillForm(workData);

    backToWorkLink.href = `/works/file/?id=${encodeURIComponent(workId)}`;

    showEditor();
  } catch (error) {
    console.error("作品編集読み込みエラー:", error);

    showPageMessage(
      "読み込みに失敗しました",
      "時間を置いて、もう一度お試しください。",
      "作品一覧へ",
      "/works/"
    );
  }
}

async function saveWork(event) {
  event.preventDefault();

  if (!currentUser || !currentWork || !workId) {
    message.textContent = "作品情報を確認できませんでした。";
    return;
  }

  const title = workTitle.value.trim();
  const description = workDescription.value.trim();
  const workType = getSelectedValue("workType");

  const joinType = workType === "shared"
    ? getSelectedValue("joinType")
    : "closed";

  const rules = workType === "shared"
    ? rulesText.value.trim()
    : "";

  if (!title) {
    message.textContent = "作品名を入力してください。";
    return;
  }

  if (title.length > 60) {
    message.textContent = "作品名は60文字以内でお願いします。";
    return;
  }

  if (description.length > 1000) {
    message.textContent = "作品説明は1000文字以内でお願いします。";
    return;
  }

  if (rules.length > 1000) {
    message.textContent = "ルール・注意事項は1000文字以内でお願いします。";
    return;
  }

  if (!["personal", "shared"].includes(workType)) {
    message.textContent = "作品タイプを選択してください。";
    return;
  }

  if (
    workType === "shared" &&
    !["free", "approval", "closed"].includes(joinType)
  ) {
    message.textContent = "参加設定を選択してください。";
    return;
  }

  try {
    saveButton.disabled = true;
    message.textContent = "変更を保存しています...";

    const workRef = doc(db, "works", workId);

    await updateDoc(workRef, {
      title,
      description,
      workType,
      joinType,
      rulesText: rules,
      isPublic: isPublic.checked,
      updatedAt: serverTimestamp()
    });

    message.textContent = "変更を保存しました。";

    setTimeout(() => {
      location.href = `/works/file/?id=${encodeURIComponent(workId)}`;
    }, 650);
  } catch (error) {
    console.error("作品編集保存エラー:", error);

    message.textContent =
      "変更の保存に失敗しました。時間を置いてもう一度お試しください。";

    saveButton.disabled = false;
  }
}

document.querySelectorAll('input[name="workType"]').forEach((input) => {
  input.addEventListener("change", updateSharedSettings);
});

workForm.addEventListener("submit", saveWork);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    showPageMessage(
      "ログインが必要です",
      "作品を編集するにはログインしてください。",
      "作品一覧へ",
      "/works/"
    );
    return;
  }

  await loadWork();
});

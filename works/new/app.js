import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where
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

const NORMAL_WORK_LIMIT = 3;

let currentUser = null;
let currentUserData = null;

function getSelectedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function updateSharedSettings() {
  const workType = getSelectedValue("workType");

  sharedSettings.hidden = workType !== "shared";
}

function isOfficialUser(userData) {
  return userData?.officialLevel === "official";
}

async function getUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getMyWorkCount(user) {
  const worksQuery = query(
    collection(db, "works"),
    where("userId", "==", user.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(worksQuery);

  return snap.size;
}

function renderLoginRequired() {
  workForm.innerHTML = `
    <section class="card message-card">
      <h1>ログインが必要です</h1>
      <p>作品を作るにはログインしてください。</p>

      <a class="primary-link" href="/works/">
        作品一覧へ
      </a>
    </section>
  `;
}

async function createWork(event) {
  event.preventDefault();

  if (!currentUser) {
    message.textContent = "作品を作るにはログインしてください。";
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

  try {
    const isOfficial = isOfficialUser(currentUserData);

    if (!isOfficial) {
      message.textContent = "作品数を確認しています...";

      const count = await getMyWorkCount(currentUser);

      if (count >= NORMAL_WORK_LIMIT) {
        message.textContent =
          `作品を作れる数は、今のところ1人${NORMAL_WORK_LIMIT}つまでです。`;
        return;
      }
    }

    message.textContent = "作品を作成しています...";

    const ownerName =
      currentUserData?.displayName ||
      "作者名未設定";

    const docRef = await addDoc(collection(db, "works"), {
      userId: currentUser.uid,
      ownerName,

      title,
      description,
      workType,

      joinType,
      rulesText: rules,

      characterCount: 0,
      fanartCount: 0,

      isPublic: isPublic.checked,
      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    message.textContent = "作品を作成しました。";

    setTimeout(() => {
      location.href = `/works/file/?id=${encodeURIComponent(docRef.id)}`;
    }, 700);
  } catch (error) {
    console.error(error);

    message.textContent =
      "作品の作成に失敗しました。時間を置いてもう一度お試しください。";
  }
}

document.querySelectorAll('input[name="workType"]').forEach((input) => {
  input.addEventListener("change", updateSharedSettings);
});

workForm.addEventListener("submit", createWork);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    renderLoginRequired();
    return;
  }

  try {
    currentUserData = await getUserData(user);
  } catch (error) {
    console.error(error);

    currentUserData = null;
  }
});

updateSharedSettings();

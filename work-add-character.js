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

const params = new URLSearchParams(location.search);
const workId = params.get("id");

const workInfo = document.getElementById("workInfo");
const characterSelectList = document.getElementById("characterSelectList");
const message = document.getElementById("message");

let currentUser = null;
let currentWork = null;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCharacterImageSrc(data) {
  return data.imageUrl || data.imageData || "";
}

function renderError(title, body) {
  workInfo.innerHTML = `
    <section class="card message-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      <a class="primary-link" href="/works/">作品一覧へ</a>
    </section>
  `;

  characterSelectList.innerHTML = "";
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

function renderWorkInfo(work) {
  const data = work.data;

  workInfo.innerHTML = `
    <section class="card">
      <p class="eyebrow">Add Character</p>
      <h2>${escapeHtml(data.title || "作品名未設定")}</h2>

      <p>
        ${escapeHtml(data.description || "作品説明はまだありません。")}
      </p>

      <div class="badge-row">
        <span class="badge">${data.workType === "shared" ? "共有作品" : "自分専用"}</span>
        ${
          data.workType === "shared"
            ? `<span class="badge muted">${escapeHtml(data.joinType || "closed")}</span>`
            : ""
        }
      </div>

      <div class="button-row">
        <a class="primary-link" href="/works/file/?id=${work.id}">
          作品詳細へ戻る
        </a>
      </div>
    </section>
  `;
}

async function loadMyCharacters() {
  const charactersQuery = query(
    collection(db, "v2Characters"),
    where("userId", "==", currentUser.uid),
    limit(80)
  );

  const snap = await getDocs(charactersQuery);

  if (snap.empty) {
    characterSelectList.innerHTML = `
      <div class="empty-preview">
        まだ追加できるキャラクターがありません。
      </div>
    `;
    return;
  }

  const characters = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.isDeleted === true) return;

    characters.push({
      id: docSnap.id,
      data
    });
  });

  if (characters.length === 0) {
    characterSelectList.innerHTML = `
      <div class="empty-preview">
        まだ追加できるキャラクターがありません。
      </div>
    `;
    return;
  }

  characterSelectList.innerHTML = "";

  characters.forEach((item) => {
    const data = item.data;
    const imageSrc = getCharacterImageSrc(data);
    const alreadyInThisWork = data.workId === workId;
    const alreadyInOtherWork = data.workId && data.workId !== workId;

    const card = document.createElement("article");
    card.className = "character-card";

    card.innerHTML = `
      <div class="character-thumb">
        ${
          imageSrc
            ? `<img class="character-img" src="${imageSrc}" alt="${escapeHtml(data.name || "キャラクター画像")}">`
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
          ${
            alreadyInThisWork
              ? "この作品に追加済みです。"
              : alreadyInOtherWork
                ? "すでに別の作品に所属しています。"
                : "この作品に追加できます。"
          }
        </p>

        <div class="button-row">
          ${
            alreadyInThisWork
              ? `<span class="badge muted">追加済み</span>`
              : alreadyInOtherWork
                ? `<span class="badge muted">所属済み</span>`
                : `<button type="button" class="primary-link add-character-btn" data-character-id="${item.id}">このキャラを追加</button>`
          }

          <a class="primary-link" href="/characters/file/?id=${item.id}">
            詳細を見る
          </a>
        </div>
      </div>
    `;

    characterSelectList.appendChild(card);
  });

  document.querySelectorAll(".add-character-btn").forEach((button) => {
    button.addEventListener("click", () => {
      addCharacterToWork(button.dataset.characterId);
    });
  });
}

async function addCharacterToWork(characterId) {
  if (!currentUser || !currentWork) {
    message.textContent = "ログイン情報または作品情報が見つかりません。";
    return;
  }

  const workData = currentWork.data;

  if (workData.userId !== currentUser.uid) {
    message.textContent = "今は作品オーナーだけがキャラクターを追加できます。";
    return;
  }

  try {
    message.textContent = "キャラクターを確認しています...";

    const characterRef = doc(db, "v2Characters", characterId);
    const characterSnap = await getDoc(characterRef);

    if (!characterSnap.exists()) {
      message.textContent = "キャラクターが見つかりませんでした。";
      return;
    }

    const characterData = characterSnap.data();

    if (characterData.userId !== currentUser.uid) {
      message.textContent = "自分のキャラクターだけ追加できます。";
      return;
    }

    if (characterData.isDeleted === true) {
      message.textContent = "削除済みのキャラクターは追加できません。";
      return;
    }

    if (characterData.workId === workId) {
      message.textContent = "このキャラクターはすでに作品に追加されています。";
      return;
    }

    if (characterData.workId && characterData.workId !== workId) {
      message.textContent = "このキャラクターはすでに別の作品に所属しています。";
      return;
    }

    message.textContent = "作品に追加しています...";

    await updateDoc(characterRef, {
      workId,
      workTitle: workData.title || "",
      workOwnerUid: workData.userId || "",
      workType: workData.workType || "personal",
      updatedAt: serverTimestamp()
    });

    const workRef = doc(db, "works", workId);

    await updateDoc(workRef, {
      characterCount: increment(1),
      updatedAt: serverTimestamp()
    });

    message.textContent = "キャラクターを作品に追加しました。";

    await loadMyCharacters();
  } catch (error) {
    console.error("キャラ追加エラー:", error);

    message.textContent = `キャラクターの追加に失敗しました。${error.message || ""}`;
  }
}

async function init(user) {
  if (!user) {
    renderError("ログインが必要です", "作品にキャラクターを追加するにはログインしてください。");
    return;
  }

  currentUser = user;

  const work = await getWork();

  if (!work) {
    renderError("作品が見つかりませんでした", "削除されたか、URLが変わっている可能性があります。");
    return;
  }

  currentWork = work;

  if (work.data.isDeleted === true) {
    renderError("作品が見つかりませんでした", "削除されたか、URLが変わっている可能性があります。");
    return;
  }

  if (work.data.userId !== user.uid) {
    renderError("追加できません", "今は作品オーナーだけがキャラクターを追加できます。");
    return;
  }

  renderWorkInfo(work);
  await loadMyCharacters();
}

onAuthStateChanged(auth, (user) => {
  init(user).catch((error) => {
    console.error(error);
    renderError("読み込みに失敗しました", "ページを再読み込みしてみてください。");
  });
});

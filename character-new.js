import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const params = new URLSearchParams(location.search);
const drawingId = params.get("drawing");

const form = document.getElementById("characterForm");
const registerGuide = document.getElementById("registerGuide");
const selectedDrawing = document.getElementById("selectedDrawing");
const message = document.getElementById("message");

const charName = document.getElementById("charName");
const charKana = document.getElementById("charKana");
const charProfile = document.getElementById("charProfile");
const charTags = document.getElementById("charTags");
const faOk = document.getElementById("faOk");
const ngText = document.getElementById("ngText");

let drawingData = null;

function showGuide(html) {
  registerGuide.hidden = false;
  registerGuide.innerHTML = html;
  form.hidden = true;
}

function showForm() {
  registerGuide.hidden = true;
  form.hidden = false;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadDrawing() {
  if (!drawingId) {
    showGuide(`
      <h2>下書きが選ばれていません</h2>
      <p>まずは絵を描いて、保存した下書きから「この絵をキャラにする」を選んでください。</p>
      <div class="actions">
        <a class="primary-btn" href="/draw/">絵を描きに行く</a>
      </div>
    `);
    return;
  }

  const user = auth.currentUser;

  if (!user) {
    showGuide(`
      <h2>ログインが必要です</h2>
      <p>キャラ登録するにはログインしてください。</p>
    `);
    return;
  }

  const drawingRef = doc(db, "v2Drawings", drawingId);
  const snap = await getDoc(drawingRef);

  if (!snap.exists()) {
    showGuide(`
      <h2>下書きが見つかりませんでした</h2>
      <p>削除されたか、URLが変わっている可能性があります。</p>
      <div class="actions">
        <a class="primary-btn" href="/draw/">下書き一覧へ戻る</a>
      </div>
    `);
    return;
  }

  const data = snap.data();

  if (data.userId !== user.uid) {
    showGuide(`
      <h2>この下書きは登録できません</h2>
      <p>自分が保存した下書きだけ、キャラとして登録できます。</p>
    `);
    return;
  }

  if (data.isDeleted === true) {
    showGuide(`
      <h2>この下書きは削除済みです</h2>
      <p>別の下書きを選んでください。</p>
      <div class="actions">
        <a class="primary-btn" href="/draw/">下書き一覧へ戻る</a>
      </div>
    `);
    return;
  }

  if (data.status === "adopted") {
    showGuide(`
      <h2>この下書きは登録済みです</h2>
      <p>すでにキャラクターとして登録されています。</p>
      <div class="actions">
        <a class="primary-btn" href="/characters/">キャラ一覧を見る</a>
        <a class="ghost-btn" href="/draw/">別の下書きを選ぶ</a>
      </div>
    `);
    return;
  }

  drawingData = data;

  selectedDrawing.innerHTML = `
    <img class="selected-drawing-img" src="${data.imageData}" alt="選んだ下書き">
    <p class="mini-info">この絵をキャラクター画像として登録します。</p>
  `;

  showForm();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;

  if (!user) {
    message.textContent = "キャラ登録するにはログインが必要です。";
    return;
  }

  if (!drawingId || !drawingData) {
    message.textContent = "登録する下書きが見つかりません。";
    return;
  }

  const name = charName.value.trim();
  const kana = charKana.value.trim();
  const profile = charProfile.value.trim();
  const tagsText = charTags.value.trim();

  if (!name) {
    message.textContent = "キャラ名を入力してください。";
    return;
  }

  const tags = tagsText
    .split(/[,\s、]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  try {
    message.textContent = "キャラを登録しています...";

    await addDoc(collection(db, "v2Characters"), {
      userId: user.uid,
      ownerName: user.displayName || "",
      ownerPhotoURL: user.photoURL || "",
      drawingId,
      name,
      kana,
      profile,
      tags,
      faOk: faOk.checked,
      ngText: ngText.value.trim(),
      imageData: drawingData.imageData,
      isPublic: true,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await updateDoc(doc(db, "v2Drawings", drawingId), {
      status: "adopted",
      updatedAt: serverTimestamp()
    });

    message.textContent = "キャラ登録が完了しました。";

    setTimeout(() => {
      location.href = "/characters/";
    }, 700);
  } catch (error) {
    console.error(error);
    message.textContent =
      "キャラ登録に失敗しました。少し時間を置いて、もう一度お試しください。";
  }
});

onAuthStateChanged(auth, () => {
  loadDrawing().catch((error) => {
    console.error(error);

    showGuide(`
      <h2>読み込みに失敗しました</h2>
      <p>ページを再読み込みしてみてください。</p>
    `);
  });
});

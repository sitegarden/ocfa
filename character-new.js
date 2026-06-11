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
const message = document.getElementById("message");
const selectedDrawing = document.getElementById("selectedDrawing");

let drawingData = null;

async function loadDrawing() {
  if (!drawingId) {
    selectedDrawing.innerHTML = `
      <p>キャラ登録する絵が選ばれてないぞ。</p>
      <a class="primary-btn" href="/draw/">絵を描きに行く</a>
    `;
    form.hidden = true;
    return;
  }

  const user = auth.currentUser;

  if (!user) {
    selectedDrawing.innerHTML = `<p>ログインしてから登録してくれ。</p>`;
    return;
  }

  const drawingRef = doc(db, "v2Drawings", drawingId);
  const snap = await getDoc(drawingRef);

  if (!snap.exists()) {
    selectedDrawing.innerHTML = `<p>選んだ絵が見つからなかった。</p>`;
    form.hidden = true;
    return;
  }

  const data = snap.data();

  if (data.userId !== user.uid) {
    selectedDrawing.innerHTML = `<p>この絵は自分の下書きじゃないぞ。</p>`;
    form.hidden = true;
    return;
  }

  if (data.isDeleted === true) {
    selectedDrawing.innerHTML = `<p>この絵は削除済みだぞ。</p>`;
    form.hidden = true;
    return;
  }

  if (data.status === "adopted") {
    selectedDrawing.innerHTML = `<p>この絵はすでにキャラ登録済みだぞ。</p>`;
    form.hidden = true;
    return;
  }

  drawingData = data;

  selectedDrawing.innerHTML = `
    <img class="selected-drawing-img" src="${data.imageData}" alt="選んだ絵">
    <p class="mini-info">この絵をキャラクターとして登録します。</p>
  `;

  form.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;

  if (!user) {
    message.textContent = "ログインしてから登録してくれ。";
    return;
  }

  if (!drawingId || !drawingData) {
    message.textContent = "登録する絵がないぞ。";
    return;
  }

  const name = document.getElementById("charName").value.trim();
  const profile = document.getElementById("charProfile").value.trim();
  const tagsText = document.getElementById("charTags").value.trim();
  const faOk = document.getElementById("faOk").checked;
  const ngText = document.getElementById("ngText").value.trim();

  if (!name) {
    message.textContent = "キャラ名は必要だぞ。";
    return;
  }

  const tags = tagsText
    .split(/[,\s、]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  try {
    message.textContent = "登録中...";

    await addDoc(collection(db, "v2Characters"), {
      userId: user.uid,
      ownerName: user.displayName || "",
      ownerPhotoURL: user.photoURL || "",
      drawingId,
      name,
      profile,
      tags,
      faOk,
      ngText,
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

    message.textContent = "キャラ登録できた。いいじゃん。";

    setTimeout(() => {
      location.href = "/characters/";
    }, 800);
  } catch (error) {
    console.error(error);
    message.textContent = "登録に失敗した。Firestoreルールを確認してくれ。";
  }
});

onAuthStateChanged(auth, () => {
  loadDrawing().catch((error) => {
    console.error(error);
    selectedDrawing.innerHTML = `<p>絵の読み込みに失敗した。</p>`;
  });
});

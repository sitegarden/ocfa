import { auth, db, googleProvider } from "/firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const siteHeader = document.getElementById("siteHeader");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getOcfaUserData(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return snap.data();
  }

  const initialData = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role: "user",
    handle: "",
    profileText: "",
    genreText: "",
    linkUrl: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userRef, initialData);

  return initialData;
}

function renderHeader() {
  if (!siteHeader) return;

  siteHeader.innerHTML = `
    <a class="logo" href="/">OCFA</a>

    <nav class="nav">
  <a href="/characters/">キャラ一覧</a>
  <a href="/draw/">描く</a>
  <a href="/events/">イベント</a>
  <a href="/news/">お知らせ</a>
  <a href="/mypage/">マイページ</a>
  <a href="/settings/">設定</a>
</nav>

    <div class="auth-box">
      <span id="userName">確認中...</span>
      <button id="loginBtn" type="button">ログイン</button>
      <button id="logoutBtn" type="button" hidden>ログアウト</button>
    </div>
  `;

  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  loginBtn.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error(error);
      alert("ログインに失敗しました。");
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
      alert("ログアウトに失敗しました。");
    }
  });
}

renderHeader();

onAuthStateChanged(auth, async (user) => {
  const userName = document.getElementById("userName");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!userName || !loginBtn || !logoutBtn) return;

  if (!user) {
    userName.textContent = "未ログイン";
    loginBtn.hidden = false;
    logoutBtn.hidden = true;
    return;
  }

  try {
    const userData = await getOcfaUserData(user);
    const displayName = userData.displayName || user.displayName || "ログイン中";

    userName.textContent = escapeHtml(displayName);
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
  } catch (error) {
    console.error(error);

    userName.textContent = user.displayName || "ログイン中";
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
  }
})

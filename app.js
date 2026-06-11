import { auth, db, googleProvider } from "./firebase.js";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const siteHeader = document.getElementById("siteHeader");

function getRootPath() {
  const path = location.pathname;

  if (path.includes("/characters/new/")) {
    return "../../";
  }

  if (path.includes("/characters/")) {
    return "../";
  }

  return "./";
}

const rootPath = getRootPath();

if (siteHeader) {
  siteHeader.className = "site-header";

  siteHeader.innerHTML = `
    <a class="logo" href="${rootPath}index.html">OCFA</a>

    <nav class="nav">
      <a href="${rootPath}characters/">キャラ一覧</a>
      <a href="${rootPath}characters/new/">キャラ作成</a>
    </nav>

    <div class="auth-box">
      <span id="userName">確認中...</span>
      <button id="loginBtn" type="button">ログイン</button>
      <button id="logoutBtn" type="button" hidden>ログアウト</button>
    </div>
  `;
}

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userName = document.getElementById("userName");

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    await signInWithPopup(auth, googleProvider);
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (userName) userName.textContent = "未ログイン";
    if (loginBtn) loginBtn.hidden = false;
    if (logoutBtn) logoutBtn.hidden = true;
    return;
  }

  if (userName) userName.textContent = user.displayName || "ログイン中";
  if (loginBtn) loginBtn.hidden = true;
  if (logoutBtn) logoutBtn.hidden = false;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      role: "user",
      handle: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
});

import { auth, db, googleProvider } from "/firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const siteHeader = document.getElementById("siteHeader");
const siteFooter = document.getElementById("siteFooter");

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
    const data = snap.data();

    const latestPhotoURL = user.photoURL || "";

    if ((data.photoURL || "") !== latestPhotoURL) {
      await updateDoc(userRef, {
        photoURL: latestPhotoURL,
        updatedAt: serverTimestamp()
      });

      return {
        ...data,
        photoURL: latestPhotoURL
      };
    }

    return data;
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
    <div class="site-header-inner">
      <a class="logo" href="/">OCFA</a>

      <button
        id="menuToggle"
        class="menu-toggle"
        type="button"
        aria-label="メニューを開く"
        aria-expanded="false"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      <div id="headerMenu" class="header-menu">
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
      </div>
    </div>
  `;

  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const menuToggle = document.getElementById("menuToggle");
  const headerMenu = document.getElementById("headerMenu");

  menuToggle.addEventListener("click", () => {
    const isOpen = headerMenu.classList.toggle("is-open");

    menuToggle.classList.toggle("is-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "メニューを閉じる" : "メニューを開く"
    );
  });

  headerMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      headerMenu.classList.remove("is-open");
      menuToggle.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "メニューを開く");
    });
  });

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

function renderFooter() {
  if (!siteFooter) return;

  siteFooter.innerHTML = `
    <div class="site-footer-inner">
      <p class="footer-brand">OCFA</p>

      <nav class="footer-nav">
        <a href="/terms/">利用規約</a>
        <a href="/privacy/">プライバシーポリシー</a>
      </nav>

      <p class="footer-copy">
        © OCFA
      </p>
    </div>
  `;
}

renderHeader();
renderFooter();

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

    userName.textContent = displayName;
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
  } catch (error) {
    console.error(error);

    userName.textContent = user.displayName || "ログイン中";
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
  }
});

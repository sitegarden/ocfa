import { auth, db, googleProvider } from "/firebase.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

    const updateData = {};

    if ((data.photoURL || "") !== latestPhotoURL) {
      updateData.photoURL = latestPhotoURL;
    }

    if (!("uploadAllowed" in data)) {
      updateData.uploadAllowed = false;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = serverTimestamp();
      await updateDoc(userRef, updateData);
      return { ...data, ...updateData };
    }

    return data;
  }

  const emailName = user.email ? user.email.split("@")[0] : "";

  const initialData = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || emailName || "",
    photoURL: user.photoURL || "",
    role: "user",
    uploadAllowed: false,
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
          <a href="/fanarts/">ファンアート一覧</
          <a href="/draw/">描く</a>
          <a href="/events/">イベント</a>
          <a href="/games/">ゲーム</a>
          <a href="/users/">ユーザー一覧</a>
          <a href="/favorites/">お気に入り</a>
          <a href="/notices/">お知らせ</a>
          <a href="/mypage/">マイページ</a>
          <a href="/settings/">設定</a>
        </nav>

        <div class="auth-box">
          <span id="userName">確認中...</span>
          <button id="loginBtn" type="button">ログイン</button>
          <button id="logoutBtn" type="button" hidden>ログアウト</button>

          <div id="loginPanel" class="login-panel" hidden>
            <button id="googleLoginBtn" class="google-login-btn" type="button">
              Googleでログイン
            </button>

            <div class="login-divider">または</div>

            <label>
              メールアドレス
              <input id="emailInput" type="email" autocomplete="email">
            </label>

            <label>
              パスワード
              <input id="passwordInput" type="password" autocomplete="current-password">
            </label>

            <div class="login-actions">
              <button id="emailLoginBtn" type="button">ログイン</button>
              <button id="emailRegisterBtn" type="button">新規登録</button>
            </div>

            <p id="loginMessage" class="login-message"></p>
          </div>
        </div>
      </div>
    </div>
  `;

  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const emailLoginBtn = document.getElementById("emailLoginBtn");
  const emailRegisterBtn = document.getElementById("emailRegisterBtn");
  const emailInput = document.getElementById("emailInput");
  const passwordInput = document.getElementById("passwordInput");
  const loginPanel = document.getElementById("loginPanel");
  const loginMessage = document.getElementById("loginMessage");
  const menuToggle = document.getElementById("menuToggle");
  const headerMenu = document.getElementById("headerMenu");

  menuToggle?.addEventListener("click", () => {
    const isOpen = headerMenu.classList.toggle("is-open");

    menuToggle.classList.toggle("is-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "メニューを閉じる" : "メニューを開く"
    );
  });

  headerMenu?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      headerMenu.classList.remove("is-open");
      menuToggle.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "メニューを開く");
    });
  });

  loginBtn?.addEventListener("click", () => {
    loginPanel.hidden = !loginPanel.hidden;

    if (!loginPanel.hidden) {
      loginMessage.textContent = "";
    }
  });

  googleLoginBtn?.addEventListener("click", async () => {
    try {
      loginMessage.textContent = "Googleでログインしています...";
      await signInWithPopup(auth, googleProvider);
      loginPanel.hidden = true;
    } catch (error) {
      console.error(error);
      loginMessage.textContent = "Googleログインに失敗しました。";
    }
  });

  emailLoginBtn?.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      loginMessage.textContent = "メールアドレスとパスワードを入力してください。";
      return;
    }

    try {
      loginMessage.textContent = "ログインしています...";
      await signInWithEmailAndPassword(auth, email, password);
      loginPanel.hidden = true;
    } catch (error) {
      console.error(error);
      loginMessage.textContent = "メールログインに失敗しました。";
    }
  });

  emailRegisterBtn?.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      loginMessage.textContent = "メールアドレスとパスワードを入力してください。";
      return;
    }

    if (password.length < 6) {
      loginMessage.textContent = "パスワードは6文字以上にしてください。";
      return;
    }

    try {
      loginMessage.textContent = "新規登録しています...";
      await createUserWithEmailAndPassword(auth, email, password);
      loginPanel.hidden = true;

      setTimeout(() => {
        location.href = "/settings/";
      }, 500);
    } catch (error) {
      console.error(error);
      loginMessage.textContent = "新規登録に失敗しました。すでに登録済みの可能性があります。";
    }
  });

  logoutBtn?.addEventListener("click", async () => {
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

  const contactUrl = "https://docs.google.com/forms/d/e/1FAIpQLSesMw6-ymf5_sRUzs_35r_Ml-ztA3Cgh8JAai1XNQH84__SWQ/viewform?usp=header";

  siteFooter.innerHTML = `
    <div class="footer-inner">
      <strong>OCFA</strong>
      <p>不具合報告・ご意見・ご感想などがあれば、フォームから送ってください。</p>

      <div class="footer-links">
        <a href="/terms/">利用規約</a>
        <a href="/privacy/">プライバシーポリシー</a>
        <a href="${contactUrl}" target="_blank" rel="noopener noreferrer">感想・不具合を送る</a>
      </div>

      <small>© OCFA</small>
    </div>
  `;
}

renderHeader();
renderFooter();

onAuthStateChanged(auth, async (user) => {
  const userName = document.getElementById("userName");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const loginPanel = document.getElementById("loginPanel");

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

    if (loginPanel) {
      loginPanel.hidden = true;
    }
  } catch (error) {
    console.error(error);

    userName.textContent = user.displayName || user.email || "ログイン中";
    loginBtn.hidden = true;
    logoutBtn.hidden = false;

    if (loginPanel) {
      loginPanel.hidden = true;
    }
  }
});

import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const app = document.getElementById("battleRoomApp");

const params = new URLSearchParams(location.search);
const roomId = params.get("id");

const STATUS_LABELS = {
  waiting: "参加待ち",
  theme_submit: "お題投稿中",
  theme_check: "お題チェック中",
  drawing: "お絵描き中",
  voting: "投票中",
  result: "結果発表",
  finished: "終了"
};

const HEART_TYPES = {
  pink: {
    emoji: "🩷",
    label: "かわいい"
  },
  blue: {
    emoji: "💙",
    label: "かっこいい"
  },
  yellow: {
    emoji: "💛",
    label: "絵柄が好み"
  },
  green: {
    emoji: "💚",
    label: "クオリティが高い"
  },
  purple: {
    emoji: "💜",
    label: "発想が素晴らしい"
  },
  orange: {
    emoji: "🧡",
    label: "再現率高すぎ"
  }
};

let currentUser = null;
let roomData = null;
let players = [];
let themes = [];
let myPlayer = null;

let unsubscribeRoom = null;
let unsubscribePlayers = null;
let unsubscribeThemes = null;

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setApp(html) {
  if (!app) return;
  app.innerHTML = html;
}

function getGuestId() {
  const key = `odaiBattleGuestId_${roomId}`;
  let guestId = localStorage.getItem(key);

  if (!guestId) {
    guestId = crypto.randomUUID();
    localStorage.setItem(key, guestId);
  }

  return guestId;
}

function getPlayerIdentity() {
  if (currentUser) {
    return {
      userId: currentUser.uid,
      guestId: "",
      isGuest: false
    };
  }

  return {
    userId: "",
    guestId: getGuestId(),
    isGuest: true
  };
}

async function getUserName(user) {
  if (!user) return "";

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();

      if (userData.displayName) return userData.displayName;
      if (userData.name) return userData.name;
      if (userData.nickname) return userData.nickname;
    }
  } catch (error) {
    console.error(error);
  }

  return user.displayName || user.email?.split("@")[0] || "参加者";
}

function getRoomRef() {
  return doc(db, "odaiBattleRooms", roomId);
}

function isOwner() {
  if (!roomData || !currentUser) return false;
  return roomData.ownerId === currentUser.uid;
}

function findMyPlayer() {
  const identity = getPlayerIdentity();

  if (identity.userId) {
    return players.find((player) => player.userId === identity.userId && !player.isLeft) || null;
  }

  return players.find((player) => player.guestId === identity.guestId && !player.isLeft) || null;
}

function canJoin() {
  if (!roomData) return false;
  if (myPlayer) return false;
  if (roomData.status !== "waiting") return false;

  const activePlayers = players.filter((player) => !player.isLeft);
  return activePlayers.length < Number(roomData.maxPlayers || 6);
}

function renderLoading(message = "読み込んでいます...") {
  setApp(`
    <div class="battle-loading-card">
      <p class="battle-kicker">DRAWING GAME</p>
      <h1>${escapeHtml(message)}</h1>
      <p>ルームIDが正しいか確認してください。</p>
    </div>
  `);
}

function renderError(message) {
  setApp(`
    <div class="battle-loading-card">
      <p class="battle-kicker">DRAWING GAME</p>
      <h1>表示できません</h1>
      <p>${escapeHtml(message)}</p>
      <a class="battle-main-btn battle-inline-link" href="/battle/">お題バトルへ戻る</a>
    </div>
  `);
}

function renderPlayers() {
  const activePlayers = players.filter((player) => !player.isLeft);

  if (activePlayers.length === 0) {
    return `<p class="battle-empty">まだ参加者がいません。</p>`;
  }

  return `
    <div class="battle-player-list">
      ${activePlayers.map((player) => `
        <div class="battle-player-card">
          <span class="battle-player-name">
            ${escapeHtml(player.name || "参加者")}
          </span>
          ${player.isOwner ? `<span class="battle-badge">ホスト</span>` : ""}
          ${myPlayer?.id === player.id ? `<span class="battle-badge battle-badge-soft">あなた</span>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderJoinArea() {
  if (myPlayer) {
    return `
      <div class="battle-mini-card">
        <p>あなたは <strong>${escapeHtml(myPlayer.name || "参加者")}</strong> として参加中です。</p>
      </div>
    `;
  }

  if (!canJoin()) {
    if (roomData?.status !== "waiting") {
      return `
        <div class="battle-mini-card">
          <p>この部屋はすでに開始されています。</p>
        </div>
      `;
    }

    return `
      <div class="battle-mini-card">
        <p>この部屋は満員です。</p>
      </div>
    `;
  }

  return `
    <form id="joinBattleForm" class="battle-form battle-join-form">
      <label class="battle-field">
        <span>参加名</span>
        <input
          id="joinName"
          type="text"
          maxlength="20"
          placeholder="名前を入力"
        />
      </label>

      <button class="battle-main-btn" type="submit">
        参加する
      </button>
    </form>
  `;
}

function getThemeStatus(theme) {
  if (theme.isRejected) return "rejected";
  if (theme.isApproved) return "approved";
  return "pending";
}

function renderThemesForHost() {
  if (!isOwner()) return "";

  const themeItems = themes.map((theme) => {
    const status = getThemeStatus(theme);

    return `
      <article class="battle-theme-card battle-theme-${status}">
        <p>${escapeHtml(theme.text)}</p>

        <div class="battle-theme-meta">
          <span>${escapeHtml(theme.playerName || "参加者")}</span>
          ${
            status === "approved"
              ? `<span class="battle-badge">承認済み</span>`
              : status === "rejected"
                ? `<span class="battle-badge battle-badge-danger">却下</span>`
                : `<span class="battle-badge battle-badge-soft">未確認</span>`
          }
        </div>

        <div class="battle-theme-actions">
          <button
            class="battle-small-btn"
            data-action="approve-theme"
            data-theme-id="${theme.id}"
            ${theme.isApproved ? "disabled" : ""}
          >
            承認
          </button>

          <button
            class="battle-small-btn battle-danger-btn"
            data-action="reject-theme"
            data-theme-id="${theme.id}"
            ${theme.isRejected ? "disabled" : ""}
          >
            却下
          </button>
        </div>
      </article>
    `;
  }).join("");

  return `
    <section class="battle-section">
      <h2>ホスト用：お題チェック</h2>

      <p class="battle-note">
        不適切なお題や、描きにくすぎるお題は却下できます。
        承認済みのお題からランダムで1つ選ばれます。
      </p>

      <div class="battle-theme-list">
        ${themeItems || `<p class="battle-empty">まだお題がありません。</p>`}
      </div>

      <div class="battle-host-actions">
        <button id="goThemeSubmitBtn" class="battle-sub-btn" type="button">
          お題投稿を開始
        </button>

        <button id="goThemeCheckBtn" class="battle-sub-btn" type="button">
          お題チェックへ
        </button>

        <button id="selectRandomThemeBtn" class="battle-main-btn" type="button">
          承認済みからランダム決定
        </button>
      </div>
    </section>
  `;
}

function renderThemeSubmitArea() {
  if (!myPlayer) {
    return `
      <section class="battle-section">
        <h2>お題投稿</h2>
        <p class="battle-note">参加するとお題を投稿できます。</p>
      </section>
    `;
  }

  const myThemes = themes.filter((theme) => theme.playerId === myPlayer.id);

  return `
    <section class="battle-section">
      <h2>お題投稿</h2>

      <p class="battle-note">
        描いて楽しそうなお題を書いてください。
        不適切なお題はホストが除外できます。
      </p>

      ${
        roomData.status === "theme_submit" || roomData.status === "waiting"
          ? `
            <form id="themeSubmitForm" class="battle-form">
              <label class="battle-field">
                <span>お題</span>
                <input
                  id="themeText"
                  type="text"
                  maxlength="40"
                  placeholder="例：魔法使いの猫"
                />
              </label>

              <button class="battle-main-btn" type="submit">
                お題を投稿
              </button>
            </form>
          `
          : `<p class="battle-note">現在はお題投稿できません。</p>`
      }

      <div class="battle-theme-list">
        ${
          myThemes.length
            ? myThemes.map((theme) => {
              const status = getThemeStatus(theme);

              return `
                <article class="battle-theme-card battle-theme-${status}">
                  <p>${escapeHtml(theme.text)}</p>
                  <div class="battle-theme-meta">
                    ${
                      status === "approved"
                        ? `<span class="battle-badge">承認済み</span>`
                        : status === "rejected"
                          ? `<span class="battle-badge battle-badge-danger">却下</span>`
                          : `<span class="battle-badge battle-badge-soft">確認待ち</span>`
                    }
                  </div>
                </article>
              `;
            }).join("")
            : `<p class="battle-empty">まだ自分のお題はありません。</p>`
        }
      </div>
    </section>
  `;
}

function renderSelectedTheme() {
  if (!roomData?.selectedThemeText) return "";

  return `
    <section class="battle-section battle-selected-theme">
      <p class="battle-kicker">SELECTED THEME</p>
      <h2>今回のお題</h2>
      <p class="battle-big-theme">${escapeHtml(roomData.selectedThemeText)}</p>
    </section>
  `;
}

function renderWaitingControls() {
  if (!isOwner()) return "";

  return `
    <section class="battle-section">
      <h2>ホスト操作</h2>

      <div class="battle-host-actions">
        <button id="goThemeSubmitBtn" class="battle-main-btn" type="button">
          お題投稿を開始
        </button>
      </div>
    </section>
  `;
}

function renderDrawingPlaceholder() {
  if (roomData.status !== "drawing") return "";

  return `
    <section class="battle-section">
      <h2>お絵描き</h2>
      <p class="battle-note">
        次の段階でキャンバスをここに追加します。
      </p>
    </section>
  `;
}

function renderMain() {
  if (!roomData) {
    renderLoading();
    return;
  }

  myPlayer = findMyPlayer();

  const activePlayers = players.filter((player) => !player.isLeft);
  const roomUrl = `${location.origin}/battle/room/?id=${encodeURIComponent(roomId)}`;

  setApp(`
    <div class="battle-room-layout">
      <section class="battle-room-header">
        <div>
          <p class="battle-kicker">お題バトル</p>
          <h1>${escapeHtml(roomData.title || "お題バトル")}</h1>
          <p class="battle-note">
            状態：<strong>${escapeHtml(STATUS_LABELS[roomData.status] || roomData.status)}</strong>
            ／ 参加者：${activePlayers.length}/${Number(roomData.maxPlayers || 6)}人
          </p>
        </div>

        <div class="battle-share-box">
          <p>共有URL</p>
          <input id="roomUrlInput" type="text" value="${escapeHtml(roomUrl)}" readonly />
          <button id="copyRoomUrlBtn" class="battle-small-btn" type="button">
            コピー
          </button>
        </div>
      </section>

      ${renderSelectedTheme()}

      <section class="battle-section">
        <h2>参加者</h2>
        ${renderPlayers()}
        ${renderJoinArea()}
      </section>

      ${roomData.status === "waiting" ? renderWaitingControls() : ""}

      ${
        roomData.status === "waiting" ||
        roomData.status === "theme_submit" ||
        roomData.status === "theme_check"
          ? renderThemeSubmitArea()
          : ""
      }

      ${
        roomData.status === "theme_submit" ||
        roomData.status === "theme_check"
          ? renderThemesForHost()
          : ""
      }

      ${renderDrawingPlaceholder()}
    </div>
  `);

  bindRenderedEvents();
}

function bindRenderedEvents() {
  const copyRoomUrlBtn = document.getElementById("copyRoomUrlBtn");
  const roomUrlInput = document.getElementById("roomUrlInput");

  if (copyRoomUrlBtn && roomUrlInput) {
    copyRoomUrlBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(roomUrlInput.value);
        copyRoomUrlBtn.textContent = "コピー済み";
      } catch (error) {
        console.error(error);
        roomUrlInput.select();
        document.execCommand("copy");
        copyRoomUrlBtn.textContent = "コピー済み";
      }
    });
  }

  const joinBattleForm = document.getElementById("joinBattleForm");

  if (joinBattleForm) {
    joinBattleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await joinRoom();
    });
  }

  const themeSubmitForm = document.getElementById("themeSubmitForm");

  if (themeSubmitForm) {
    themeSubmitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitTheme();
    });
  }

  const goThemeSubmitBtn = document.getElementById("goThemeSubmitBtn");

  if (goThemeSubmitBtn) {
    goThemeSubmitBtn.addEventListener("click", async () => {
      await updateRoomStatus("theme_submit", {
        themeStartedAt: serverTimestamp()
      });
    });
  }

  const goThemeCheckBtn = document.getElementById("goThemeCheckBtn");

  if (goThemeCheckBtn) {
    goThemeCheckBtn.addEventListener("click", async () => {
      await updateRoomStatus("theme_check");
    });
  }

  const selectRandomThemeBtn = document.getElementById("selectRandomThemeBtn");

  if (selectRandomThemeBtn) {
    selectRandomThemeBtn.addEventListener("click", async () => {
      await selectRandomTheme();
    });
  }

  const themeActionButtons = app.querySelectorAll("[data-action][data-theme-id]");

  themeActionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const themeId = button.dataset.themeId;

      if (action === "approve-theme") {
        await setThemeStatus(themeId, true);
      }

      if (action === "reject-theme") {
        await setThemeStatus(themeId, false);
      }
    });
  });
}

async function joinRoom() {
  if (!roomData) return;

  const joinNameInput = document.getElementById("joinName");
  const typedName = joinNameInput?.value.trim();

  let name = typedName;

  if (!name && currentUser) {
    name = await getUserName(currentUser);
  }

  if (!name) {
    alert("参加名を入力してください。");
    return;
  }

  if (name.length > 20) {
    alert("参加名は20文字以内にしてください。");
    return;
  }

  const activePlayers = players.filter((player) => !player.isLeft);

  if (activePlayers.length >= Number(roomData.maxPlayers || 6)) {
    alert("この部屋は満員です。");
    return;
  }

  if (roomData.status !== "waiting") {
    alert("この部屋はすでに開始されています。");
    return;
  }

  const identity = getPlayerIdentity();

  await addDoc(collection(db, "odaiBattlePlayers"), {
    roomId,

    userId: identity.userId,
    guestId: identity.guestId,

    name,

    isGuest: identity.isGuest,
    isOwner: false,
    order: activePlayers.length,
    isLeft: false,

    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function submitTheme() {
  if (!myPlayer) {
    alert("参加してからお題を投稿してください。");
    return;
  }

  if (!["waiting", "theme_submit"].includes(roomData.status)) {
    alert("現在はお題を投稿できません。");
    return;
  }

  const themeTextInput = document.getElementById("themeText");
  const text = themeTextInput?.value.trim();

  if (!text) {
    alert("お題を入力してください。");
    return;
  }

  if (text.length > 40) {
    alert("お題は40文字以内にしてください。");
    return;
  }

  await addDoc(collection(db, "odaiBattleThemes"), {
    roomId,

    playerId: myPlayer.id,
    playerName: myPlayer.name || "参加者",

    text,

    isApproved: false,
    isRejected: false,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  if (themeTextInput) {
    themeTextInput.value = "";
  }
}

async function updateRoomStatus(status, extraData = {}) {
  if (!isOwner()) {
    alert("ホストのみ操作できます。");
    return;
  }

  await updateDoc(getRoomRef(), {
    status,
    ...extraData,
    updatedAt: serverTimestamp()
  });
}

async function setThemeStatus(themeId, approved) {
  if (!isOwner()) {
    alert("ホストのみ操作できます。");
    return;
  }

  const themeRef = doc(db, "odaiBattleThemes", themeId);

  await updateDoc(themeRef, {
    isApproved: approved,
    isRejected: !approved,
    updatedAt: serverTimestamp()
  });
}

async function selectRandomTheme() {
  if (!isOwner()) {
    alert("ホストのみ操作できます。");
    return;
  }

  const approvedThemes = themes.filter((theme) => theme.isApproved && !theme.isRejected);

  if (approvedThemes.length === 0) {
    alert("承認済みのお題がありません。");
    return;
  }

  const selectedTheme = approvedThemes[Math.floor(Math.random() * approvedThemes.length)];

  await updateDoc(getRoomRef(), {
    status: "drawing",
    selectedThemeId: selectedTheme.id,
    selectedThemeText: selectedTheme.text,
    drawingStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function subscribeRoom() {
  if (!roomId) {
    renderError("ルームIDがありません。");
    return;
  }

  unsubscribeRoom = onSnapshot(
    getRoomRef(),
    (roomSnap) => {
      if (!roomSnap.exists()) {
        renderError("ルームが見つかりませんでした。");
        return;
      }

      roomData = {
        id: roomSnap.id,
        ...roomSnap.data()
      };

      if (roomData.isDeleted) {
        renderError("このルームは削除されています。");
        return;
      }

      renderMain();
    },
    (error) => {
      console.error(error);
      renderError("ルームの読み込みに失敗しました。");
    }
  );
}

function subscribePlayers() {
  const playersQuery = query(
    collection(db, "odaiBattlePlayers"),
    where("roomId", "==", roomId),
    orderBy("order", "asc")
  );

  unsubscribePlayers = onSnapshot(
    playersQuery,
    (snapshot) => {
      players = snapshot.docs.map((playerDoc) => ({
        id: playerDoc.id,
        ...playerDoc.data()
      }));

      renderMain();
    },
    (error) => {
      console.error(error);
    }
  );
}

function subscribeThemes() {
  const themesQuery = query(
    collection(db, "odaiBattleThemes"),
    where("roomId", "==", roomId),
    orderBy("createdAt", "asc")
  );

  unsubscribeThemes = onSnapshot(
    themesQuery,
    (snapshot) => {
      themes = snapshot.docs.map((themeDoc) => ({
        id: themeDoc.id,
        ...themeDoc.data()
      }));

      renderMain();
    },
    (error) => {
      console.error(error);
    }
  );
}

function cleanup() {
  if (unsubscribeRoom) unsubscribeRoom();
  if (unsubscribePlayers) unsubscribePlayers();
  if (unsubscribeThemes) unsubscribeThemes();
}

window.addEventListener("beforeunload", cleanup);

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!roomId) {
    renderError("ルームIDがありません。");
    return;
  }

  cleanup();

  renderLoading();

  subscribeRoom();
  subscribePlayers();
  subscribeThemes();
});

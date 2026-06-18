import { auth, db, storage } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getDownloadURL,
  ref,
  uploadString
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

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
let works = [];
let votes = [];
let myPlayer = null;

let unsubscribeRoom = null;
let unsubscribePlayers = null;
let unsubscribeThemes = null;
let unsubscribeWorks = null;
let unsubscribeVotes = null;

let drawingTimerId = null;
let canvasReady = false;
let isDrawing = false;
let lastPoint = null;

let currentTool = "pen";
let currentColor = "#222222";
let currentSize = 8;

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

function timestampToMillis(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value.seconds) {
    return value.seconds * 1000;
  }

  return 0;
}

function sortByCreatedAt(items) {
  return [...items].sort((a, b) => {
    const aTime = timestampToMillis(a.createdAt || a.joinedAt);
    const bTime = timestampToMillis(b.createdAt || b.joinedAt);
    return aTime - bTime;
  });
}

function sortPlayers(items) {
  return [...items].sort((a, b) => {
    const aOrder = Number(a.order ?? 9999);
    const bOrder = Number(b.order ?? 9999);

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    const aTime = timestampToMillis(a.joinedAt);
    const bTime = timestampToMillis(b.joinedAt);

    return aTime - bTime;
  });
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
    return players.find((player) => {
      return player.userId === identity.userId && !player.isLeft;
    }) || null;
  }

  return players.find((player) => {
    return player.guestId === identity.guestId && !player.isLeft;
  }) || null;
}

function getMyWork() {
  if (!myPlayer) return null;

  return works.find((work) => {
    return work.playerId === myPlayer.id && !work.isDeleted;
  }) || null;
}

function getPlayerNameById(playerId) {
  const player = players.find((item) => item.id === playerId);
  return player?.name || "参加者";
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

function getDrawingRemainingSeconds() {
  if (!roomData?.drawingStartedAt) {
    return Number(roomData?.drawSeconds || 600);
  }

  const startedAt = timestampToMillis(roomData.drawingStartedAt);

  if (!startedAt) {
    return Number(roomData?.drawSeconds || 600);
  }

  const limit = Number(roomData.drawSeconds || 600);
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);

  return Math.max(0, limit - elapsed);
}

function formatSeconds(seconds) {
  const minute = Math.floor(seconds / 60);
  const second = seconds % 60;

  return `${minute}:${String(second).padStart(2, "0")}`;
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

          ${myPlayer?.id === player.id ? `
            <span class="battle-badge battle-badge-soft">あなた</span>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderJoinArea() {
  if (myPlayer) {
    return `
      <div class="battle-mini-card">
        <p>
          あなたは
          <strong>${escapeHtml(myPlayer.name || "参加者")}</strong>
          として参加中です。
        </p>
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
      <p class="battle-kicker">今回のお題</p>
      <h2>${escapeHtml(roomData.selectedThemeText)}</h2>
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

function renderDrawingArea() {
  if (roomData.status !== "drawing") return "";

  if (!myPlayer) {
    return `
      <section class="battle-section">
        <h2>お絵描き</h2>
        <p class="battle-note">
          参加者のみ絵を描けます。
        </p>
      </section>
    `;
  }

  const myWork = getMyWork();

  return `
    <section class="battle-section battle-drawing-section">
      <div class="battle-drawing-head">
        <div>
          <h2>お絵描き</h2>
          <p class="battle-note">
            残り時間：
            <strong id="drawingTimer">${formatSeconds(getDrawingRemainingSeconds())}</strong>
          </p>
        </div>

        ${
          isOwner()
            ? `
              <button id="startVotingBtn" class="battle-main-btn" type="button">
                投票へ進む
              </button>
            `
            : ""
        }
      </div>

      ${
        myWork
          ? `
            <div class="battle-submitted-card">
              <h3>提出済み</h3>
              <p>あなたの作品は提出されています。</p>
              <img src="${escapeHtml(myWork.imageUrl)}" alt="提出した作品" />
            </div>
          `
          : `
            <div class="battle-tool-bar">
              <label>
                色
                <input id="penColor" type="color" value="#222222" />
              </label>

              <label>
                太さ
                <input id="penSize" type="range" min="2" max="40" value="8" />
              </label>

              <button id="penToolBtn" class="battle-small-btn is-active" type="button">
                ペン
              </button>

              <button id="eraserToolBtn" class="battle-small-btn" type="button">
                消しゴム
              </button>

              <button id="clearCanvasBtn" class="battle-small-btn battle-danger-btn" type="button">
                全消し
              </button>
            </div>

            <div class="battle-canvas-wrap">
              <canvas id="drawingCanvas" width="900" height="650"></canvas>
            </div>

            <div class="battle-submit-area">
              <button id="submitWorkBtn" class="battle-main-btn" type="button">
                作品を提出
              </button>

              <p class="battle-note">
                提出後は今のところ描き直しできません。
              </p>
            </div>
          `
      }
    </section>
  `;
}

function getMyVoteForWork(workId) {
  if (!myPlayer) return null;

  return votes.find((vote) => {
    return vote.voterPlayerId === myPlayer.id && vote.workId === workId;
  }) || null;
}

function renderHeartButtons(work) {
  const myVote = getMyVoteForWork(work.id);

  return `
    <div class="battle-heart-buttons">
      ${Object.entries(HEART_TYPES).map(([heartKey, heart]) => {
        const isSelected = myVote?.heart === heartKey;

        return `
          <button
            class="battle-heart-btn ${isSelected ? "is-selected" : ""}"
            type="button"
            data-action="vote-heart"
            data-work-id="${work.id}"
            data-heart="${heartKey}"
          >
            <span>${heart.emoji}</span>
            <small>${escapeHtml(heart.label)}</small>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderVotingArea() {
  if (roomData.status !== "voting") return "";

  const activeWorks = works.filter((work) => !work.isDeleted);

  return `
    <section class="battle-section">
      <div class="battle-drawing-head">
        <div>
          <h2>投票</h2>
          <p class="battle-note">
            1つの作品につき、送れるハートは1種類だけです。
            ハートを押し直すと変更できます。
          </p>
        </div>

        ${
          isOwner()
            ? `
              <button id="finishVotingBtn" class="battle-main-btn" type="button">
                結果発表へ
              </button>
            `
            : ""
        }
      </div>

      ${
        !myPlayer
          ? `<p class="battle-note">参加者のみ投票できます。</p>`
          : ""
      }

      <div class="battle-work-grid">
        ${
          activeWorks.length
            ? activeWorks.map((work, index) => {
              const isMine = myPlayer?.id === work.playerId;

              return `
                <article class="battle-work-card">
                  <div class="battle-work-number">作品 ${index + 1}</div>
                  <img src="${escapeHtml(work.imageUrl)}" alt="投稿作品" />

                  ${
                    isMine
                      ? `<p class="battle-note">自分の作品には投票できません。</p>`
                      : myPlayer
                        ? renderHeartButtons(work)
                        : `<p class="battle-note">参加すると投票できます。</p>`
                  }
                </article>
              `;
            }).join("")
            : `<p class="battle-empty">まだ提出作品がありません。</p>`
        }
      </div>
    </section>
  `;
}

function buildVoteSummary() {
  const activeWorks = works.filter((work) => !work.isDeleted);

  const summary = activeWorks.map((work) => {
    const workVotes = votes.filter((vote) => vote.workId === work.id);

    const heartCounts = {};

    Object.keys(HEART_TYPES).forEach((heartKey) => {
      heartCounts[heartKey] = workVotes.filter((vote) => vote.heart === heartKey).length;
    });

    const total = workVotes.length;

    return {
      work,
      heartCounts,
      total
    };
  });

  return summary;
}

function sortRankingByHeart(summary, heartKey) {
  return [...summary]
    .filter((item) => item.heartCounts[heartKey] > 0)
    .sort((a, b) => {
      const diff = b.heartCounts[heartKey] - a.heartCounts[heartKey];

      if (diff !== 0) return diff;

      return b.total - a.total;
    })
    .slice(0, 3);
}

function sortRankingByTotal(summary) {
  return [...summary]
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
}

function renderRankingItem(item, rank, heartKey = "") {
  const count = heartKey ? item.heartCounts[heartKey] : item.total;
  const playerName = getPlayerNameById(item.work.playerId);

  return `
    <article class="battle-result-item">
      <div class="battle-rank">#${rank}</div>

      <img src="${escapeHtml(item.work.imageUrl)}" alt="入賞作品" />

      <div>
        <h4>${escapeHtml(playerName)}</h4>
        <p>${count}票</p>
      </div>
    </article>
  `;
}

function renderResultsArea() {
  if (roomData.status !== "result" && roomData.status !== "finished") return "";

  const summary = buildVoteSummary();
  const totalRanking = sortRankingByTotal(summary);

  return `
    <section class="battle-section">
      <div class="battle-drawing-head">
        <div>
          <h2>結果発表</h2>
          <p class="battle-note">
            部門別に上位3名まで表示されます。
          </p>
        </div>

        ${
          isOwner() && roomData.status !== "finished"
            ? `
              <button id="finishRoomBtn" class="battle-sub-btn" type="button">
                終了する
              </button>
            `
            : ""
        }
      </div>

      <div class="battle-result-block">
        <h3>総合ハート数 TOP3</h3>

        ${
          totalRanking.length
            ? totalRanking.map((item, index) => {
              return renderRankingItem(item, index + 1);
            }).join("")
            : `<p class="battle-empty">まだ投票がありません。</p>`
        }
      </div>

      <div class="battle-result-grid">
        ${Object.entries(HEART_TYPES).map(([heartKey, heart]) => {
          const ranking = sortRankingByHeart(summary, heartKey);

          return `
            <section class="battle-result-block">
              <h3>${heart.emoji} ${escapeHtml(heart.label)} TOP3</h3>

              ${
                ranking.length
                  ? ranking.map((item, index) => {
                    return renderRankingItem(item, index + 1, heartKey);
                  }).join("")
                  : `<p class="battle-empty">この部門の投票はまだありません。</p>`
              }
            </section>
          `;
        }).join("")}
      </div>

      <div class="battle-work-grid">
        ${summary.map((item, index) => {
          const playerName = getPlayerNameById(item.work.playerId);

          return `
            <article class="battle-work-card">
              <div class="battle-work-number">作品 ${index + 1}</div>
              <img src="${escapeHtml(item.work.imageUrl)}" alt="投稿作品" />

              <h3>${escapeHtml(playerName)}</h3>

              <div class="battle-heart-counts">
                ${Object.entries(HEART_TYPES).map(([heartKey, heart]) => `
                  <span>
                    ${heart.emoji}
                    ${item.heartCounts[heartKey]}
                  </span>
                `).join("")}
              </div>

              <p class="battle-note">合計：${item.total}票</p>
            </article>
          `;
        }).join("")}
      </div>
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
            状態：
            <strong>${escapeHtml(STATUS_LABELS[roomData.status] || roomData.status)}</strong>
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

      ${renderDrawingArea()}
      ${renderVotingArea()}
      ${renderResultsArea()}
    </div>
  `);

  canvasReady = false;
  bindRenderedEvents();

  if (roomData.status === "drawing") {
    setupCanvas();
    startDrawingTimer();
  } else {
    stopDrawingTimer();
  }
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

  const startVotingBtn = document.getElementById("startVotingBtn");

  if (startVotingBtn) {
    startVotingBtn.addEventListener("click", async () => {
      await startVoting();
    });
  }

  const finishVotingBtn = document.getElementById("finishVotingBtn");

  if (finishVotingBtn) {
    finishVotingBtn.addEventListener("click", async () => {
      await finishVoting();
    });
  }

  const finishRoomBtn = document.getElementById("finishRoomBtn");

  if (finishRoomBtn) {
    finishRoomBtn.addEventListener("click", async () => {
      await finishRoom();
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

  const voteButtons = app.querySelectorAll('[data-action="vote-heart"]');

  voteButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const workId = button.dataset.workId;
      const heart = button.dataset.heart;

      await voteWork(workId, heart);
    });
  });
}

function setupCanvas() {
  const canvas = document.getElementById("drawingCanvas");

  if (!canvas || canvasReady || getMyWork()) return;

  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.lineCap = "round";
  context.lineJoin = "round";

  canvas.style.touchAction = "none";

  const penColor = document.getElementById("penColor");
  const penSize = document.getElementById("penSize");
  const penToolBtn = document.getElementById("penToolBtn");
  const eraserToolBtn = document.getElementById("eraserToolBtn");
  const clearCanvasBtn = document.getElementById("clearCanvasBtn");
  const submitWorkBtn = document.getElementById("submitWorkBtn");

  if (penColor) {
    penColor.addEventListener("input", () => {
      currentColor = penColor.value;
      currentTool = "pen";
      updateToolButtons();
    });
  }

  if (penSize) {
    penSize.addEventListener("input", () => {
      currentSize = Number(penSize.value);
    });
  }

  if (penToolBtn) {
    penToolBtn.addEventListener("click", () => {
      currentTool = "pen";
      updateToolButtons();
    });
  }

  if (eraserToolBtn) {
    eraserToolBtn.addEventListener("click", () => {
      currentTool = "eraser";
      updateToolButtons();
    });
  }

  if (clearCanvasBtn) {
    clearCanvasBtn.addEventListener("click", () => {
      const ok = confirm("キャンバスを全消ししますか？");

      if (!ok) return;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    });
  }

  if (submitWorkBtn) {
    submitWorkBtn.addEventListener("click", async () => {
      await submitWork();
    });
  }

  canvas.addEventListener("pointerdown", startDraw);
  canvas.addEventListener("pointermove", moveDraw);
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointerleave", endDraw);
  canvas.addEventListener("pointercancel", endDraw);

  canvasReady = true;
}

function updateToolButtons() {
  const penToolBtn = document.getElementById("penToolBtn");
  const eraserToolBtn = document.getElementById("eraserToolBtn");

  if (penToolBtn) {
    penToolBtn.classList.toggle("is-active", currentTool === "pen");
  }

  if (eraserToolBtn) {
    eraserToolBtn.classList.toggle("is-active", currentTool === "eraser");
  }
}

function getCanvasPoint(event) {
  const canvas = document.getElementById("drawingCanvas");
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function startDraw(event) {
  const canvas = document.getElementById("drawingCanvas");

  if (!canvas) return;

  event.preventDefault();

  isDrawing = true;
  lastPoint = getCanvasPoint(event);

  canvas.setPointerCapture(event.pointerId);
}

function moveDraw(event) {
  if (!isDrawing || !lastPoint) return;

  const canvas = document.getElementById("drawingCanvas");
  const context = canvas.getContext("2d");
  const nextPoint = getCanvasPoint(event);

  event.preventDefault();

  context.beginPath();
  context.moveTo(lastPoint.x, lastPoint.y);
  context.lineTo(nextPoint.x, nextPoint.y);

  context.lineWidth = currentSize;
  context.globalCompositeOperation = "source-over";

  if (currentTool === "eraser") {
    context.strokeStyle = "#ffffff";
  } else {
    context.strokeStyle = currentColor;
  }

  context.stroke();

  lastPoint = nextPoint;
}

function endDraw(event) {
  if (!isDrawing) return;

  const canvas = document.getElementById("drawingCanvas");

  if (canvas && event.pointerId !== undefined) {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // 無視
    }
  }

  isDrawing = false;
  lastPoint = null;
}

function startDrawingTimer() {
  stopDrawingTimer();

  const timerElement = document.getElementById("drawingTimer");

  if (!timerElement) return;

  const updateTimer = () => {
    const remaining = getDrawingRemainingSeconds();
    timerElement.textContent = formatSeconds(remaining);

    if (remaining <= 0) {
      timerElement.textContent = "0:00";
      stopDrawingTimer();
    }
  };

  updateTimer();
  drawingTimerId = setInterval(updateTimer, 1000);
}

function stopDrawingTimer() {
  if (drawingTimerId) {
    clearInterval(drawingTimerId);
    drawingTimerId = null;
  }
}

async function submitWork() {
  if (!myPlayer) {
    alert("参加してから提出してください。");
    return;
  }

  if (roomData.status !== "drawing") {
    alert("現在は提出できません。");
    return;
  }

  if (getMyWork()) {
    alert("すでに提出済みです。");
    return;
  }

  const canvas = document.getElementById("drawingCanvas");

  if (!canvas) {
    alert("キャンバスが見つかりません。");
    return;
  }

  const ok = confirm("この作品を提出しますか？");

  if (!ok) return;

  const submitWorkBtn = document.getElementById("submitWorkBtn");

  if (submitWorkBtn) {
    submitWorkBtn.disabled = true;
    submitWorkBtn.textContent = "提出中...";
  }

  try {
    const imageData = canvas.toDataURL("image/png");
    const filePath = `odai-battle/${roomId}/${myPlayer.id}_${Date.now()}.png`;
    const imageRef = ref(storage, filePath);

    await uploadString(imageRef, imageData, "data_url");

    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "odaiBattleWorks"), {
      roomId,

      playerId: myPlayer.id,
      playerName: myPlayer.name || "参加者",

      imageUrl,
      storagePath: filePath,

      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    alert("提出しました。");
  } catch (error) {
    console.error(error);
    alert("提出に失敗しました。");

    if (submitWorkBtn) {
      submitWorkBtn.disabled = false;
      submitWorkBtn.textContent = "作品を提出";
    }
  }
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

  const approvedThemes = themes.filter((theme) => {
    return theme.isApproved && !theme.isRejected;
  });

  if (approvedThemes.length === 0) {
    alert("承認済みのお題がありません。");
    return;
  }

  const selectedTheme = approvedThemes[
    Math.floor(Math.random() * approvedThemes.length)
  ];

  await updateDoc(getRoomRef(), {
    status: "drawing",
    selectedThemeId: selectedTheme.id,
    selectedThemeText: selectedTheme.text,
    drawingStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function startVoting() {
  if (!isOwner()) {
    alert("ホストのみ操作できます。");
    return;
  }

  const activeWorks = works.filter((work) => !work.isDeleted);

  if (activeWorks.length === 0) {
    const ok = confirm("提出作品がまだありません。このまま投票へ進みますか？");

    if (!ok) return;
  }

  await updateDoc(getRoomRef(), {
    status: "voting",
    votingStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function voteWork(workId, heart) {
  if (!myPlayer) {
    alert("参加者のみ投票できます。");
    return;
  }

  if (roomData.status !== "voting") {
    alert("現在は投票できません。");
    return;
  }

  if (!HEART_TYPES[heart]) {
    alert("ハートの種類が正しくありません。");
    return;
  }

  const work = works.find((item) => item.id === workId && !item.isDeleted);

  if (!work) {
    alert("作品が見つかりません。");
    return;
  }

  if (work.playerId === myPlayer.id) {
    alert("自分の作品には投票できません。");
    return;
  }

  const voteId = `${roomId}_${myPlayer.id}_${workId}`;
  const voteRef = doc(db, "odaiBattleVotes", voteId);

  await setDoc(voteRef, {
    roomId,

    voterPlayerId: myPlayer.id,
    voterName: myPlayer.name || "参加者",

    workId,
    workPlayerId: work.playerId,

    heart,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, {
    merge: true
  });
}

async function finishVoting() {
  if (!isOwner()) {
    alert("ホストのみ操作できます。");
    return;
  }

  await updateDoc(getRoomRef(), {
    status: "result",
    resultStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function finishRoom() {
  if (!isOwner()) {
    alert("ホストのみ操作できます。");
    return;
  }

  await updateDoc(getRoomRef(), {
    status: "finished",
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
    where("roomId", "==", roomId)
  );

  unsubscribePlayers = onSnapshot(
    playersQuery,
    (snapshot) => {
      players = sortPlayers(
        snapshot.docs.map((playerDoc) => ({
          id: playerDoc.id,
          ...playerDoc.data()
        }))
      );

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
    where("roomId", "==", roomId)
  );

  unsubscribeThemes = onSnapshot(
    themesQuery,
    (snapshot) => {
      themes = sortByCreatedAt(
        snapshot.docs.map((themeDoc) => ({
          id: themeDoc.id,
          ...themeDoc.data()
        }))
      );

      renderMain();
    },
    (error) => {
      console.error(error);
    }
  );
}

function subscribeWorks() {
  const worksQuery = query(
    collection(db, "odaiBattleWorks"),
    where("roomId", "==", roomId)
  );

  unsubscribeWorks = onSnapshot(
    worksQuery,
    (snapshot) => {
      works = sortByCreatedAt(
        snapshot.docs.map((workDoc) => ({
          id: workDoc.id,
          ...workDoc.data()
        }))
      );

      renderMain();
    },
    (error) => {
      console.error(error);
    }
  );
}

function subscribeVotes() {
  const votesQuery = query(
    collection(db, "odaiBattleVotes"),
    where("roomId", "==", roomId)
  );

  unsubscribeVotes = onSnapshot(
    votesQuery,
    (snapshot) => {
      votes = sortByCreatedAt(
        snapshot.docs.map((voteDoc) => ({
          id: voteDoc.id,
          ...voteDoc.data()
        }))
      );

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
  if (unsubscribeWorks) unsubscribeWorks();
  if (unsubscribeVotes) unsubscribeVotes();

  stopDrawingTimer();

  unsubscribeRoom = null;
  unsubscribePlayers = null;
  unsubscribeThemes = null;
  unsubscribeWorks = null;
  unsubscribeVotes = null;
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
  subscribeWorks();
  subscribeVotes();
});

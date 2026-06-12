import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const gameRoomContent = document.getElementById("gameRoomContent");

const params = new URLSearchParams(location.search);
const roomId = params.get("id");

let currentUser = null;
let currentRoom = null;
let currentPlayers = [];
let currentOriginals = [];
let currentFanarts = [];

let unsubscribeRoom = null;
let unsubscribePlayers = null;
let unsubscribeOriginals = null;
let unsubscribeFanarts = null;
let hasStartedListening = false;

let advancingToFa = false;

let gameCanvas = null;
let gameCtx = null;
let gameDrawing = false;
let gameLastX = 0;
let gameLastY = 0;
let gameHasDrawn = false;

let layerCanvases = [];
let layerContexts = [];
let activeLayerIndex = 0;
let layerVisible = [true, true];

let originalTimerId = null;
let submittingOriginal = false;
let submittingFanart = false;
let advancingRound = false;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getGuestId() {
  const key = `ocfa_game_guest_${roomId}`;
  let guestId = localStorage.getItem(key);

  if (!guestId) {
    guestId = crypto.randomUUID();
    localStorage.setItem(key, guestId);
  }

  return guestId;
}

function getStatusLabel(status) {
  if (status === "waiting") return "待機中";
  if (status === "drawing_oc") return "OC作成中";
  if (status === "drawing_fa") return "FA作成中";
  if (status === "reveal") return "公開中";
  if (status === "finished") return "終了";
  return "不明";
}

function getMyPlayer() {
  if (currentUser) {
    return currentPlayers.find((player) => {
      return player.data.userId === currentUser.uid && player.data.isLeft !== true;
    });
  }

  const guestId = getGuestId();

  return currentPlayers.find((player) => {
    return player.data.guestId === guestId && player.data.isLeft !== true;
  });
}

function isOwner() {
  return currentUser && currentRoom?.data?.ownerId === currentUser.uid;
}

async function getRoom() {
  if (!roomId) return null;

  const roomRef = doc(db, "ocGameRooms", roomId);
  const snap = await getDoc(roomRef);

  if (!snap.exists()) return null;

  const data = snap.data();

  if (data.isDeleted === true) return null;

  return {
    id: snap.id,
    data
  };
}

async function getPlayers() {
  if (!roomId) return [];

  const q = query(
    collection(db, "ocGamePlayers"),
    where("roomId", "==", roomId),
    where("isLeft", "==", false)
  );

  const snap = await getDocs(q);

  const players = [];

  snap.forEach((docSnap) => {
    players.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  players.sort((a, b) => {
    const aOrder = typeof a.data.order === "number" ? a.data.order : 999;
    const bOrder = typeof b.data.order === "number" ? b.data.order : 999;

    if (aOrder !== bOrder) return aOrder - bOrder;

    const aTime = a.data.joinedAt?.seconds || 0;
    const bTime = b.data.joinedAt?.seconds || 0;

    return aTime - bTime;
  });

  return players;
}

async function getMyOriginal(playerId) {
  if (!roomId || !playerId) return null;

  const q = query(
    collection(db, "ocGameOriginals"),
    where("roomId", "==", roomId),
    where("playerId", "==", playerId),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  if (snap.empty) return null;

  let result = null;

  snap.forEach((docSnap) => {
    result = {
      id: docSnap.id,
      data: docSnap.data()
    };
  });

  return result;
}

function getAutoGuestName() {
  const guestCount = currentPlayers.filter((player) => {
    return player.data.isGuest === true;
  }).length + 1;

  return `匿名${String(guestCount).padStart(3, "0")}`;
}

function getSubmittedOriginalByPlayerId(playerId) {
  return currentOriginals.find((original) => {
    return original.data.playerId === playerId;
  });
}

function getTargetPlayerForCurrentRound(myPlayer) {
  if (!myPlayer) return null;
  if (!currentPlayers.length) return null;

  const round = Number(currentRoom?.data?.currentRound || 0);

  const myIndex = currentPlayers.findIndex((player) => {
    return player.id === myPlayer.id;
  });

  if (myIndex < 0) return null;

  const targetIndex = (myIndex + round) % currentPlayers.length;

  return currentPlayers[targetIndex];
}

function getOriginalByPlayerId(playerId) {
  return currentOriginals.find((original) => {
    return original.data.playerId === playerId;
  });
}

function getMyFanartForCurrentRound(myPlayer, targetPlayer) {
  if (!myPlayer || !targetPlayer) return null;

  const round = Number(currentRoom?.data?.currentRound || 0);

  return currentFanarts.find((fanart) => {
    return fanart.data.round === round
      && fanart.data.artistPlayerId === myPlayer.id
      && fanart.data.targetPlayerId === targetPlayer.id
      && fanart.data.isDeleted !== true;
  });
}

async function checkAllOriginalsSubmitted() {
  if (!currentRoom) return;
  if (currentRoom.data.status !== "drawing_oc") return;
  if (!isOwner()) return;
  if (advancingToFa) return;
  if (currentPlayers.length < 2) return;

  const allSubmitted = currentPlayers.every((player) => {
    return getSubmittedOriginalByPlayerId(player.id);
  });

  if (!allSubmitted) return;

  try {
    advancingToFa = true;

    await updateDoc(doc(db, "ocGameRooms", roomId), {
      status: "drawing_fa",
      currentRound: 0,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    advancingToFa = false;
  }
}

function getFanartsForCurrentRound() {
  const round = Number(currentRoom?.data?.currentRound || 0);

  return currentFanarts.filter((fanart) => {
    return fanart.data.round === round
      && fanart.data.isDeleted !== true;
  });
}

function hasPlayerSubmittedFanartThisRound(player) {
  const round = Number(currentRoom?.data?.currentRound || 0);

  return currentFanarts.some((fanart) => {
    return fanart.data.round === round
      && fanart.data.artistPlayerId === player.id
      && fanart.data.isDeleted !== true;
  });
}

async function checkAllFanartsSubmitted() {
  if (!currentRoom) return;
  if (currentRoom.data.status !== "drawing_fa") return;
  if (!isOwner()) return;
  if (advancingRound) return;
  if (currentPlayers.length < 2) return;

  const allSubmitted = currentPlayers.every((player) => {
    return hasPlayerSubmittedFanartThisRound(player);
  });

  if (!allSubmitted) return;

  const currentRound = Number(currentRoom.data.currentRound || 0);
  const nextRound = currentRound + 1;
  const lastRoundIndex = currentPlayers.length - 1;

  try {
    advancingRound = true;

    if (nextRound > lastRoundIndex) {
      await updateDoc(doc(db, "ocGameRooms", roomId), {
        status: "reveal",
        revealedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return;
    }

    await updateDoc(doc(db, "ocGameRooms", roomId), {
      currentRound: nextRound,
      updatedAt: serverTimestamp()
    });

    advancingRound = false;
  } catch (error) {
    console.error(error);
    advancingRound = false;
  }
}

async function joinAsGuest() {
  const nameInput = document.getElementById("guestName");
  const message = document.getElementById("roomMessage");

  const alreadyJoined = getMyPlayer();

  if (alreadyJoined) {
    if (message) message.textContent = "すでに参加しています。";
    return;
  }

  if (currentPlayers.length >= currentRoom.data.maxPlayers) {
    if (message) message.textContent = "この部屋は満員です。";
    return;
  }

  const name = nameInput.value.trim() || getAutoGuestName();
  const guestId = getGuestId();

  try {
    if (message) message.textContent = "参加しています...";

    await addDoc(collection(db, "ocGamePlayers"), {
      roomId,
      userId: "",
      guestId,
      name,
      isGuest: true,
      isOwner: false,
      order: currentPlayers.length,
      isLeft: false,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (message) message.textContent = "参加しました。";
  } catch (error) {
    console.error(error);
    if (message) message.textContent = "参加に失敗しました。";
  }
}

async function joinAsLoginUser() {
  const message = document.getElementById("roomMessage");

  if (!currentUser) {
    if (message) message.textContent = "ログインしていません。";
    return;
  }

  const alreadyJoined = getMyPlayer();

  if (alreadyJoined) {
    if (message) message.textContent = "すでに参加しています。";
    return;
  }

  if (currentPlayers.length >= currentRoom.data.maxPlayers) {
    if (message) message.textContent = "この部屋は満員です。";
    return;
  }

  const name =
    currentUser.displayName ||
    currentUser.email?.split("@")[0] ||
    "参加者";

  try {
    if (message) message.textContent = "参加しています...";

    await addDoc(collection(db, "ocGamePlayers"), {
      roomId,
      userId: currentUser.uid,
      guestId: "",
      name,
      isGuest: false,
      isOwner: currentRoom.data.ownerId === currentUser.uid,
      order: currentPlayers.length,
      isLeft: false,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (message) message.textContent = "参加しました。";
  } catch (error) {
    console.error(error);
    if (message) message.textContent = "参加に失敗しました。";
  }
}

async function startGame() {
  const message = document.getElementById("roomMessage");

  if (!isOwner()) {
    if (message) message.textContent = "ゲーム開始はオーナーのみできます。";
    return;
  }

  if (currentPlayers.length < 2) {
    if (message) message.textContent = "2人以上集まると開始できます。";
    return;
  }

  try {
    if (message) message.textContent = "ゲームを開始しています...";

    await updateDoc(doc(db, "ocGameRooms", roomId), {
      status: "drawing_oc",
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    if (message) message.textContent = "ゲーム開始に失敗しました。";
  }
}

function renderPlayers() {
  if (currentPlayers.length === 0) {
    return `
      <div class="panel-soft">
        <p>まだ参加者はいません。</p>
      </div>
    `;
  }

  return `
    <div class="player-list">
      ${currentPlayers
        .map((player) => {
          const data = player.data;

          return `
            <article class="player-card">
              <div>
                <strong>${escapeHtml(data.name || "匿名")}</strong>
                <p class="mini-info">
                  ${
                    data.isOwner
                      ? "オーナー"
                      : data.isGuest
                        ? "ゲスト"
                        : "ログイン参加"
                  }
                </p>
              </div>

              <span>#${Number(data.order || 0) + 1}</span>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderJoinArea() {
  const myPlayer = getMyPlayer();

  if (currentRoom.data.status !== "waiting") {
    return `
      <section class="panel">
        <h2>参加受付は終了しました</h2>
        <p>この部屋はすでに開始されています。</p>
      </section>
    `;
  }

  if (myPlayer) {
    return `
      <section class="panel-soft">
        <p>あなたはこの部屋に参加中です。</p>
      </section>
    `;
  }

  if (currentPlayers.length >= currentRoom.data.maxPlayers) {
    return `
      <section class="panel-soft">
        <p>この部屋は満員です。</p>
      </section>
    `;
  }

  return `
    <section class="panel guest-join-box">
      <p class="eyebrow">Join</p>
      <h2>参加する</h2>

      ${
        currentUser
          ? `
            <p>ログイン中の名前で参加できます。</p>

            <div class="actions">
              <button id="loginJoinBtn" class="primary-btn" type="button">
                ログイン名で参加する
              </button>
            </div>
          `
          : `
            <p>ゲスト参加できます。名前なしの場合は匿名名になります。</p>

            <label>
              参加名
              <input
                id="guestName"
                type="text"
                maxlength="20"
                placeholder="例：ゼロ"
              >
            </label>

            <div class="actions">
              <button id="guestJoinBtn" class="primary-btn" type="button">
                ゲスト参加する
              </button>
            </div>
          `
      }
    </section>
  `;
}

function renderOwnerArea() {
  if (!isOwner()) return "";

  if (currentRoom.data.status !== "waiting") {
    return `
      <section class="panel-soft">
        <p>ゲームは開始されています。</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <p class="eyebrow">Owner</p>
      <h2>オーナー操作</h2>
      <p>参加者が集まったらゲームを開始できます。</p>

      <div class="actions">
        <button id="startGameBtn" class="primary-btn" type="button">
          ゲーム開始
        </button>
      </div>
    </section>
  `;
}

function renderLayerTools() {
  return `
    <div class="game-draw-tools">
      <label class="game-color-tool">
        色
        <input id="gamePenColor" type="color" value="#2b2430">
      </label>

      <label class="game-size-tool">
        太さ
        <input id="gamePenSize" type="range" min="1" max="24" value="5">
        <span id="gamePenSizeText">5</span>
      </label>
    </div>

    <div class="game-layer-tools">
      <button id="layerBtn0" type="button" class="layer-btn is-active">
        レイヤー1
      </button>

      <button id="layerBtn1" type="button" class="layer-btn">
        レイヤー2
      </button>

      <button id="toggleLayerBtn" type="button">
        表示/非表示
      </button>

      <button id="clearLayerBtn" type="button" class="danger-btn">
        このレイヤーを消す
      </button>
    </div>

    <p id="layerStatusText" class="mini-info">
      現在：レイヤー1
    </p>
  `;
}

async function renderGameStageArea() {
  if (!currentRoom) {
    return "";
  }

  if (currentRoom.data.status === "reveal") {
    return `
      <section class="panel">
        <p class="eyebrow">Result</p>
        <h2>結果発表</h2>
        <p>
          全ラウンドが終了しました。
          次はキャラごとに、みんなのFAを表示する結果画面を作ります。
        </p>
      </section>
    `;
  }

  if (currentRoom.data.status === "drawing_fa") {
    const myPlayer = getMyPlayer();

    if (!myPlayer) {
      return `
        <section class="panel-soft">
          <p>FAターン中です。参加者のみ描画できます。</p>
        </section>
      `;
    }

    const targetPlayer = getTargetPlayerForCurrentRound(myPlayer);
    const targetOriginal = targetPlayer
      ? getOriginalByPlayerId(targetPlayer.id)
      : null;

    if (!targetPlayer || !targetOriginal) {
      return `
        <section class="panel">
          <p class="eyebrow">Fan Art Turn</p>
          <h2>FAターン準備中</h2>
          <p>描く相手のOCを準備しています。</p>
        </section>
      `;
    }

    const submittedFanart = getMyFanartForCurrentRound(myPlayer, targetPlayer);

    if (submittedFanart) {
      return `
        <section class="panel">
          <p class="eyebrow">Fan Art Turn</p>
          <h2>FA提出済み</h2>

          <p>
            ${escapeHtml(targetPlayer.data.name || "匿名")}さんのOCへのFAを提出しました。
            ほかの人の提出を待っています。
          </p>

          <div class="submitted-oc-preview">
            <img src="${submittedFanart.data.imageData}" alt="提出したFA">
          </div>
        </section>
      `;
    }

    return `
      <section class="panel game-fa-panel">
        <p class="eyebrow">Fan Art Turn</p>
        <h2>${escapeHtml(targetPlayer.data.name || "匿名")}さんのOCを描く</h2>

        <p class="mini-info">
          Round ${Number(currentRoom.data.currentRound || 0) + 1} / ${currentPlayers.length}
        </p>

        <div class="game-target-oc">
          <img
            src="${targetOriginal.data.imageData}"
            alt="${escapeHtml(targetPlayer.data.name || "OC")}のOC"
          >
        </div>

        <p>
          上のOCを見ながら、ファンアートを描いてください。
        </p>

        ${renderLayerTools()}

        <canvas
          id="gameCanvas"
          class="game-canvas"
          width="768"
          height="768"
        ></canvas>

        <div class="actions">
          <button id="submitFanartBtn" class="primary-btn" type="button">
            FAを提出する
          </button>
        </div>
      </section>
    `;
  }

  if (currentRoom.data.status !== "drawing_oc") {
    return "";
  }

  const myPlayer = getMyPlayer();

  if (!myPlayer) {
    return `
      <section class="panel-soft">
        <p>ゲームは開始されています。参加者のみ描画できます。</p>
      </section>
    `;
  }

  const submitted = await getMyOriginal(myPlayer.id);

  if (submitted) {
    return `
      <section class="panel">
        <p class="eyebrow">Your OC</p>
        <h2>OC提出済み</h2>
        <p>あなたのOCは提出済みです。全員の提出が終わるまで待ってください。</p>

        <div class="submitted-oc-preview">
          <img src="${submitted.data.imageData}" alt="提出したOC">
        </div>
      </section>
    `;
  }

  return `
    <section class="panel game-draw-panel">
      <p class="eyebrow">Draw Your OC</p>
      <h2>自分のOCを描く</h2>

      <p>
        まずは自分のOCを描いて提出してください。
        この絵が、ほかの参加者がファンアートを描く元になります。
      </p>

      <div class="game-timer-box">
        <p id="originalTimerText" class="game-timer">残り時間：--:--</p>

        <div class="game-timer-meter">
          <span id="originalTimerBar"></span>
        </div>
      </div>

      ${renderLayerTools()}

      <canvas
        id="gameCanvas"
        class="game-canvas"
        width="768"
        height="768"
      ></canvas>

      <div class="actions">
        <button id="submitOriginalBtn" class="primary-btn" type="button">
          OCを提出する
        </button>
      </div>
    </section>
  `;
}

async function renderRoom() {
  if (!currentRoom) return;

  const room = currentRoom.data;

  gameRoomContent.innerHTML = `
    <section class="panel game-room-head">
      <p class="eyebrow">OC Drawing Game</p>
      <h1>${escapeHtml(room.title || "OC描き合いゲーム")}</h1>

      <span class="game-status-badge">
        ${escapeHtml(getStatusLabel(room.status))}
      </span>

      <p class="mini-info">
        参加者 ${currentPlayers.length} / ${room.maxPlayers}人　
        1ターン ${Math.floor(room.turnSeconds / 60)}分
      </p>

            <p class="mini-info">
        OC提出 ${currentOriginals.length} / ${currentPlayers.length}人
      </p>

      ${
        room.status === "drawing_fa"
          ? `
            <p class="mini-info">
              現在のFA提出 ${getFanartsForCurrentRound().length} / ${currentPlayers.length}人
            </p>
          `
          : ""
      }

      <p class="mini-info">
        部屋URLを共有すると、ゲストも参加できます。
      </p>

      <div class="actions">
        <button id="copyRoomUrlBtn" class="ghost-btn" type="button">
          部屋URLをコピー
        </button>
        <a class="ghost-btn" href="/games/">ゲームトップへ戻る</a>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Players</p>
          <h2>参加者</h2>
        </div>
      </div>

      ${renderPlayers()}
    </section>

    ${await renderGameStageArea()}

    ${renderJoinArea()}

    ${renderOwnerArea()}

    <p id="roomMessage" class="mini-info"></p>
  `;

  const copyRoomUrlBtn = document.getElementById("copyRoomUrlBtn");
  const guestJoinBtn = document.getElementById("guestJoinBtn");
  const loginJoinBtn = document.getElementById("loginJoinBtn");
  const startGameBtn = document.getElementById("startGameBtn");
  const submitOriginalBtn = document.getElementById("submitOriginalBtn");
  const submitFanartBtn = document.getElementById("submitFanartBtn");
  const roomMessage = document.getElementById("roomMessage");

  if (copyRoomUrlBtn) {
    copyRoomUrlBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        if (roomMessage) roomMessage.textContent = "部屋URLをコピーしました。";
      } catch (error) {
        console.error(error);
        if (roomMessage) roomMessage.textContent = "コピーに失敗しました。";
      }
    });
  }

  if (guestJoinBtn) {
    guestJoinBtn.addEventListener("click", joinAsGuest);
  }

  if (loginJoinBtn) {
    loginJoinBtn.addEventListener("click", joinAsLoginUser);
  }

  if (startGameBtn) {
    startGameBtn.addEventListener("click", startGame);
  }

  if (submitOriginalBtn) {
    submittingOriginal = false;

    initGameCanvas();
    startOriginalAutoSubmitTimer();

    submitOriginalBtn.addEventListener("click", () => {
      submitOriginalOc(false);
    });
  } else {
    clearOriginalTimer();
  }

  if (submitFanartBtn) {
    submittingFanart = false;

    initGameCanvas();

    submitFanartBtn.addEventListener("click", submitFanart);
  }
}

function renderNoRoomId() {
  gameRoomContent.innerHTML = `
    <section class="panel">
      <h1>部屋が選ばれていません</h1>
      <p>URLが正しいか確認してください。</p>

      <div class="actions">
        <a class="ghost-btn" href="/games/">ゲームトップへ戻る</a>
      </div>
    </section>
  `;
}

function renderNotFound() {
  gameRoomContent.innerHTML = `
    <section class="panel">
      <h1>部屋が見つかりませんでした</h1>
      <p>削除されたか、URLが間違っている可能性があります。</p>

      <div class="actions">
        <a class="ghost-btn" href="/games/">ゲームトップへ戻る</a>
      </div>
    </section>
  `;
}

function renderError(error) {
  console.error(error);

  gameRoomContent.innerHTML = `
    <section class="panel">
      <h1>読み込みに失敗しました</h1>
      <p>ページを再読み込みしてみてください。</p>
    </section>
  `;
}

function startRealtimeListeners() {
  if (!roomId || hasStartedListening) return;

  hasStartedListening = true;

  const roomRef = doc(db, "ocGameRooms", roomId);

  unsubscribeRoom = onSnapshot(
    roomRef,
    async (snap) => {
      if (!snap.exists()) {
        renderNotFound();
        return;
      }

      const data = snap.data();

      if (data.isDeleted === true) {
        renderNotFound();
        return;
      }

      currentRoom = {
        id: snap.id,
        data
      };

      await checkAllOriginalsSubmitted();
      await checkAllFanartsSubmitted();

      await renderRoom();
    },
    (error) => {
      renderError(error);
    }
  );

  const playersQuery = query(
    collection(db, "ocGamePlayers"),
    where("roomId", "==", roomId),
    where("isLeft", "==", false)
  );

  unsubscribePlayers = onSnapshot(
    playersQuery,
    async (snap) => {
      const players = [];

      snap.forEach((docSnap) => {
        players.push({
          id: docSnap.id,
          data: docSnap.data()
        });
      });

      players.sort((a, b) => {
        const aOrder = typeof a.data.order === "number" ? a.data.order : 999;
        const bOrder = typeof b.data.order === "number" ? b.data.order : 999;

        if (aOrder !== bOrder) return aOrder - bOrder;

        const aTime = a.data.joinedAt?.seconds || 0;
        const bTime = b.data.joinedAt?.seconds || 0;

        return aTime - bTime;
      });

      currentPlayers = players;

      await checkAllOriginalsSubmitted();
      await checkAllFanartsSubmitted();

      if (currentRoom) {
        await renderRoom();
      }
    },
    (error) => {
      renderError(error);
    }
  );

  const originalsQuery = query(
    collection(db, "ocGameOriginals"),
    where("roomId", "==", roomId),
    where("isDeleted", "==", false)
  );

  unsubscribeOriginals = onSnapshot(
    originalsQuery,
    async (snap) => {
      const originals = [];

      snap.forEach((docSnap) => {
        originals.push({
          id: docSnap.id,
          data: docSnap.data()
        });
      });

      currentOriginals = originals;

      await checkAllOriginalsSubmitted();
      await checkAllFanartsSubmitted();

      if (currentRoom) {
        await renderRoom();
      }
    },
    (error) => {
      renderError(error);
    }
  );

  const fanartsQuery = query(
    collection(db, "ocGameFanarts"),
    where("roomId", "==", roomId),
    where("isDeleted", "==", false)
  );

  unsubscribeFanarts = onSnapshot(
    fanartsQuery,
    async (snap) => {
      const fanarts = [];

      snap.forEach((docSnap) => {
        fanarts.push({
          id: docSnap.id,
          data: docSnap.data()
        });
      });

      currentFanarts = fanarts;

      await checkAllFanartsSubmitted();

      if (currentRoom) {
        await renderRoom();
      }
    },
    (error) => {
      renderError(error);
    }
  );
}

function getGamePoint(e) {
  const rect = gameCanvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;

  return {
    x: ((touch.clientX - rect.left) / rect.width) * gameCanvas.width,
    y: ((touch.clientY - rect.top) / rect.height) * gameCanvas.height
  };
}

function createLayerCanvas() {
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = gameCanvas.width;
  layerCanvas.height = gameCanvas.height;

  const layerCtx = layerCanvas.getContext("2d");

  return {
    canvas: layerCanvas,
    ctx: layerCtx
  };
}

function initGameLayers() {
  layerCanvases = [];
  layerContexts = [];
  activeLayerIndex = 0;
  layerVisible = [true, true];

  for (let i = 0; i < 2; i++) {
    const layer = createLayerCanvas();
    layerCanvases.push(layer.canvas);
    layerContexts.push(layer.ctx);
  }

  redrawGameCanvas();
  updateLayerUi();
}

function redrawGameCanvas() {
  if (!gameCtx || !gameCanvas) return;

  gameCtx.fillStyle = "#fffdf8";
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  layerCanvases.forEach((layerCanvas, index) => {
    if (!layerVisible[index]) return;
    gameCtx.drawImage(layerCanvas, 0, 0);
  });
}

function getActiveLayerCtx() {
  return layerContexts[activeLayerIndex] || null;
}

function updateLayerUi() {
  const layerBtn0 = document.getElementById("layerBtn0");
  const layerBtn1 = document.getElementById("layerBtn1");
  const layerStatusText = document.getElementById("layerStatusText");

  if (layerBtn0) {
    layerBtn0.classList.toggle("is-active", activeLayerIndex === 0);
    layerBtn0.classList.toggle("is-hidden-layer", layerVisible[0] === false);
  }

  if (layerBtn1) {
    layerBtn1.classList.toggle("is-active", activeLayerIndex === 1);
    layerBtn1.classList.toggle("is-hidden-layer", layerVisible[1] === false);
  }

  if (layerStatusText) {
    const visibleText = layerVisible[activeLayerIndex] ? "表示中" : "非表示";
    layerStatusText.textContent = `現在：レイヤー${activeLayerIndex + 1}（${visibleText}）`;
  }
}

function setupLayerButtons() {
  const layerBtn0 = document.getElementById("layerBtn0");
  const layerBtn1 = document.getElementById("layerBtn1");
  const toggleLayerBtn = document.getElementById("toggleLayerBtn");
  const clearLayerBtn = document.getElementById("clearLayerBtn");
  const gamePenSize = document.getElementById("gamePenSize");
const gamePenSizeText = document.getElementById("gamePenSizeText");

  if (layerBtn0) {
    layerBtn0.addEventListener("click", () => {
      activeLayerIndex = 0;
      updateLayerUi();
    });
  }

  if (layerBtn1) {
    layerBtn1.addEventListener("click", () => {
      activeLayerIndex = 1;
      updateLayerUi();
    });
  }

  if (toggleLayerBtn) {
    toggleLayerBtn.addEventListener("click", () => {
      layerVisible[activeLayerIndex] = !layerVisible[activeLayerIndex];
      redrawGameCanvas();
      updateLayerUi();
    });
  }

  if (clearLayerBtn) {
    clearLayerBtn.addEventListener("click", () => {
      if (!confirm(`レイヤー${activeLayerIndex + 1}を消しますか？`)) return;

      const targetCtx = getActiveLayerCtx();

      if (!targetCtx) return;

      targetCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
      redrawGameCanvas();
      updateLayerUi();
    });
  }

  if (gamePenSize && gamePenSizeText) {
  gamePenSizeText.textContent = gamePenSize.value;

  gamePenSize.addEventListener("input", () => {
    gamePenSizeText.textContent = gamePenSize.value;
  });
}
}

function initGameCanvas() {
  gameCanvas = document.getElementById("gameCanvas");

  if (!gameCanvas) return;

  gameCtx = gameCanvas.getContext("2d");

  gameDrawing = false;
  gameHasDrawn = false;

  initGameLayers();

  gameCanvas.addEventListener("mousedown", startGameDraw);
  gameCanvas.addEventListener("mousemove", drawGameCanvas);
  gameCanvas.addEventListener("mouseup", stopGameDraw);
  gameCanvas.addEventListener("mouseleave", stopGameDraw);

  gameCanvas.addEventListener("touchstart", startGameDraw, { passive: false });
  gameCanvas.addEventListener("touchmove", drawGameCanvas, { passive: false });
  gameCanvas.addEventListener("touchend", stopGameDraw);

  setupLayerButtons();
}

function startGameDraw(e) {
  e.preventDefault();

  if (!layerVisible[activeLayerIndex]) {
    const roomMessage = document.getElementById("roomMessage");

    if (roomMessage) {
      roomMessage.textContent = "非表示中のレイヤーには描けません。";
    }

    return;
  }

  const point = getGamePoint(e);

  gameDrawing = true;
  gameLastX = point.x;
  gameLastY = point.y;
}

function drawGameCanvas(e) {
  if (!gameDrawing) return;

  e.preventDefault();

  const point = getGamePoint(e);
  const targetCtx = getActiveLayerCtx();

  const gamePenColor = document.getElementById("gamePenColor");
  const gamePenSize = document.getElementById("gamePenSize");

  if (!targetCtx) return;

  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.strokeStyle = gamePenColor?.value || "#2b2430";
  targetCtx.lineWidth = Number(gamePenSize?.value || 5);

  targetCtx.beginPath();
  targetCtx.moveTo(gameLastX, gameLastY);
  targetCtx.lineTo(point.x, point.y);
  targetCtx.stroke();

  gameLastX = point.x;
  gameLastY = point.y;
  gameHasDrawn = true;

  redrawGameCanvas();
}

function stopGameDraw() {
  if (!gameDrawing) return;
  gameDrawing = false;
}

function addWatermarkToGameCanvas(name) {
  if (!gameCtx || !gameCanvas) return;

  gameCtx.save();

  gameCtx.globalAlpha = 0.72;
  gameCtx.fillStyle = "#2b2430";
  gameCtx.font = "bold 24px sans-serif";
  gameCtx.textAlign = "right";
  gameCtx.textBaseline = "bottom";

  gameCtx.fillText(`by ${name}`, gameCanvas.width - 22, gameCanvas.height - 18);

  gameCtx.restore();
}

function getGameCanvasImageData() {
  return gameCanvas.toDataURL("image/jpeg", 0.82);
}

function clearOriginalTimer() {
  if (originalTimerId) {
    clearInterval(originalTimerId);
    originalTimerId = null;
  }
}

function getRoomStartedMs() {
  const startedAt = currentRoom?.data?.startedAt;

  if (!startedAt) return Date.now();

  if (typeof startedAt.toMillis === "function") {
    return startedAt.toMillis();
  }

  if (startedAt.seconds) {
    return startedAt.seconds * 1000;
  }

  return Date.now();
}

function getOriginalRemainingSeconds() {
  const startedMs = getRoomStartedMs();
  const turnSeconds = Number(currentRoom?.data?.turnSeconds || 120);
  const endMs = startedMs + turnSeconds * 1000;

  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

function formatTimer(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;

  return `${min}:${String(sec).padStart(2, "0")}`;
}

function drawTimeUpCard(name) {
  if (!gameCtx || !gameCanvas) return;

  layerCanvases.forEach((layerCanvas) => {
    const ctx = layerCanvas.getContext("2d");
    ctx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  });

  redrawGameCanvas();

  gameCtx.save();

  gameCtx.fillStyle = "#fffdf8";
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  gameCtx.fillStyle = "#2b2430";
  gameCtx.textAlign = "center";
  gameCtx.textBaseline = "middle";

  gameCtx.font = "bold 46px sans-serif";
  gameCtx.fillText("時間切れ", gameCanvas.width / 2, gameCanvas.height / 2 - 28);

  gameCtx.font = "bold 24px sans-serif";
  gameCtx.fillText(`${name || "匿名"} のOC`, gameCanvas.width / 2, gameCanvas.height / 2 + 28);

  gameCtx.restore();
}

function startOriginalAutoSubmitTimer() {
  clearOriginalTimer();

  const timerText = document.getElementById("originalTimerText");
  const timerBar = document.getElementById("originalTimerBar");

  async function tick() {
    const remaining = getOriginalRemainingSeconds();
    const turnSeconds = Number(currentRoom?.data?.turnSeconds || 120);

    const percent =
      turnSeconds > 0
        ? Math.max(0, Math.min(100, (remaining / turnSeconds) * 100))
        : 0;

    if (timerText) {
      timerText.textContent = `残り時間：${formatTimer(remaining)}`;
    }

    if (timerBar) {
      timerBar.style.width = `${percent}%`;

      timerBar.classList.toggle("is-danger", remaining <= 10);
      timerBar.classList.toggle("is-warning", remaining <= 30 && remaining > 10);
    }

    if (remaining <= 0) {
      clearOriginalTimer();

      if (!submittingOriginal) {
        await submitOriginalOc(true);
      }
    }
  }

  tick();

  originalTimerId = setInterval(() => {
    tick();
  }, 1000);
}

async function submitOriginalOc(isAutoSubmit = false) {
  const message = document.getElementById("roomMessage");
  const submitOriginalBtn = document.getElementById("submitOriginalBtn");
  const myPlayer = getMyPlayer();

  if (submittingOriginal) return;

  if (!myPlayer) {
    if (message) message.textContent = "参加してから提出してください。";
    return;
  }

  if (!gameHasDrawn && !isAutoSubmit) {
    if (message) message.textContent = "提出する前にOCを描いてください。";
    return;
  }

  try {
    submittingOriginal = true;

    if (submitOriginalBtn) {
      submitOriginalBtn.disabled = true;
    }

    const alreadySubmitted = await getMyOriginal(myPlayer.id);

    if (alreadySubmitted) {
      clearOriginalTimer();

      if (message) message.textContent = "すでにOCを提出済みです。";

      await renderRoom();
      return;
    }

    if (message) {
      message.textContent = isAutoSubmit
        ? "時間になったため、自動提出しています..."
        : "OCを提出しています...";
    }

    if (isAutoSubmit && !gameHasDrawn) {
      drawTimeUpCard(myPlayer.data.name || "匿名");
    } else {
      redrawGameCanvas();
    }

    addWatermarkToGameCanvas(myPlayer.data.name || "匿名");

    const imageData = getGameCanvasImageData();

    await addDoc(collection(db, "ocGameOriginals"), {
      roomId,
      playerId: myPlayer.id,
      playerName: myPlayer.data.name || "匿名",
      userId: myPlayer.data.userId || "",
      guestId: myPlayer.data.guestId || "",
      imageData,
      hasDrawn: gameHasDrawn,
      isAutoSubmit,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    clearOriginalTimer();

    if (message) {
      message.textContent = isAutoSubmit
        ? "時間切れのため、自動提出しました。"
        : "OCを提出しました。全員の提出が終わるまで待ってください。";
    }

    await renderRoom();
  } catch (error) {
    console.error(error);

    submittingOriginal = false;

    if (submitOriginalBtn) {
      submitOriginalBtn.disabled = false;
    }

    if (message) {
      message.textContent = "OCの提出に失敗しました。";
    }
  }
}

async function submitFanart() {
  const message = document.getElementById("roomMessage");
  const submitFanartBtn = document.getElementById("submitFanartBtn");

  const myPlayer = getMyPlayer();

  if (submittingFanart) return;

  if (!myPlayer) {
    if (message) message.textContent = "参加してから提出してください。";
    return;
  }

  const targetPlayer = getTargetPlayerForCurrentRound(myPlayer);

  if (!targetPlayer) {
    if (message) message.textContent = "描く相手が見つかりません。";
    return;
  }

  if (!gameHasDrawn) {
    if (message) message.textContent = "提出する前にFAを描いてください。";
    return;
  }

  const alreadySubmitted = getMyFanartForCurrentRound(myPlayer, targetPlayer);

  if (alreadySubmitted) {
    if (message) message.textContent = "このターンのFAは提出済みです。";
    return;
  }

  try {
    submittingFanart = true;

    if (submitFanartBtn) {
      submitFanartBtn.disabled = true;
    }

    if (message) message.textContent = "FAを提出しています...";

    redrawGameCanvas();
    addWatermarkToGameCanvas(myPlayer.data.name || "匿名");

    const imageData = getGameCanvasImageData();
    const round = Number(currentRoom?.data?.currentRound || 0);

    await addDoc(collection(db, "ocGameFanarts"), {
      roomId,
      round,
      artistPlayerId: myPlayer.id,
      artistName: myPlayer.data.name || "匿名",
      artistUserId: myPlayer.data.userId || "",
      artistGuestId: myPlayer.data.guestId || "",
      targetPlayerId: targetPlayer.id,
      targetName: targetPlayer.data.name || "匿名",
      imageData,
      hasDrawn: true,
      isAutoSubmit: false,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    if (message) {
      message.textContent =
        "FAを提出しました。ほかの人の提出を待っています。";
    }

    await renderRoom();
  } catch (error) {
    console.error(error);

    submittingFanart = false;

    if (submitFanartBtn) {
      submitFanartBtn.disabled = false;
    }

    if (message) {
      message.textContent = "FAの提出に失敗しました。";
    }
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!roomId) {
    renderNoRoomId();
    return;
  }

  gameRoomContent.innerHTML = `
    <section class="panel">
      <p>部屋を読み込んでいます...</p>
    </section>
  `;

  startRealtimeListeners();
});

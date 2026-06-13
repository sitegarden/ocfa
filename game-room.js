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
  setDoc,
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
let advancingRound = false;
let forceAdvanceBusy = false;
let isRenderingRoom = false;

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
let fanartTimerId = null;
let submittingOriginal = false;
let submittingFanart = false;

let currentTool = "pen";
let layerHistory = [[], []];

const MAX_LAYER_HISTORY = 20;

function escapeHtml(text) {
  return String(text ?? "")
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
  if (status === "reveal") return "結果発表";
  if (status === "finished") return "終了";

  return "不明";
}

function getDocTime(item) {
  const data = item?.data || {};

  if (data.updatedAt?.seconds) {
    return data.updatedAt.seconds;
  }

  if (data.createdAt?.seconds) {
    return data.createdAt.seconds;
  }

  return 0;
}

function getLatestItem(items) {
  if (!items.length) return null;

  return [...items].sort((a, b) => {
    return getDocTime(b) - getDocTime(a);
  })[0];
}

function getOriginalDocId(playerId) {
  return `${roomId}_${playerId}`;
}

function getFanartDocId(round, artistPlayerId, targetPlayerId) {
  return `${roomId}_${round}_${artistPlayerId}_${targetPlayerId}`;
}

function getMyPlayer() {
  if (currentUser) {
    return currentPlayers.find((player) => {
      return player.data.userId === currentUser.uid
        && player.data.isLeft !== true;
    });
  }

  const guestId = getGuestId();

  return currentPlayers.find((player) => {
    return player.data.guestId === guestId
      && player.data.isLeft !== true;
  });
}

function isOwner() {
  return Boolean(
    currentUser
    && currentRoom?.data?.ownerId === currentUser.uid
  );
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

  const originals = [];

  snap.forEach((docSnap) => {
    originals.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  return getLatestItem(originals);
}

function getAutoGuestName() {
  const guestCount = currentPlayers.filter((player) => {
    return player.data.isGuest === true;
  }).length + 1;

  return `匿名${String(guestCount).padStart(3, "0")}`;
}

function getSubmittedOriginalByPlayerId(playerId) {
  const originals = currentOriginals.filter((original) => {
    return original.data.playerId === playerId
      && original.data.isDeleted !== true;
  });

  return getLatestItem(originals);
}

function getOriginalSubmittedCount() {
  const submittedPlayerIds = new Set();

  currentOriginals.forEach((original) => {
    if (original.data.isDeleted === true) return;
    if (!original.data.playerId) return;

    submittedPlayerIds.add(original.data.playerId);
  });

  return submittedPlayerIds.size;
}

function getTargetPlayerForCurrentRound(myPlayer) {
  if (!myPlayer) return null;
  if (!currentPlayers.length) return null;

  const round = Number(currentRoom?.data?.currentRound || 0);

  const myIndex = currentPlayers.findIndex((player) => {
    return player.id === myPlayer.id;
  });

  if (myIndex < 0) return null;

  const targetIndex = (myIndex + round + 1) % currentPlayers.length;

  return currentPlayers[targetIndex];
}

function getOriginalByPlayerId(playerId) {
  const originals = currentOriginals.filter((original) => {
    return original.data.playerId === playerId
      && original.data.isDeleted !== true;
  });

  return getLatestItem(originals);
}

function getMyFanartForCurrentRound(myPlayer, targetPlayer) {
  if (!myPlayer || !targetPlayer) return null;

  const round = Number(currentRoom?.data?.currentRound || 0);

  const fanarts = currentFanarts.filter((fanart) => {
    return fanart.data.round === round
      && fanart.data.artistPlayerId === myPlayer.id
      && fanart.data.targetPlayerId === targetPlayer.id
      && fanart.data.isDeleted !== true;
  });

  return getLatestItem(fanarts);
}

function createTimeUpImageData(name, label = "OC") {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 768;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#2b2430";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = "bold 54px sans-serif";
  ctx.fillText("時間切れ", canvas.width / 2, canvas.height / 2 - 44);

  ctx.font = "bold 28px sans-serif";
  ctx.fillText(
    `${name || "匿名"} の${label}`,
    canvas.width / 2,
    canvas.height / 2 + 26
  );

  ctx.globalAlpha = 0.72;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(`by ${name || "匿名"}`, canvas.width - 22, canvas.height - 18);

  return canvas.toDataURL("image/jpeg", 0.82);
}

async function createMissingOriginalForPlayer(player) {
  if (!player) return null;

  const alreadySubmitted = getSubmittedOriginalByPlayerId(player.id);

  if (alreadySubmitted) {
    return alreadySubmitted;
  }

  const originalId = getOriginalDocId(player.id);
  const playerName = player.data.name || "匿名";

  const originalData = {
    roomId,
    playerId: player.id,
    playerName,
    userId: player.data.userId || "",
    guestId: player.data.guestId || "",
    imageData: createTimeUpImageData(playerName, "OC"),
    hasDrawn: false,
    isAutoSubmit: true,
    isTimeUpPlaceholder: true,
    isDeleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(
    doc(db, "ocGameOriginals", originalId),
    originalData,
    { merge: true }
  );

  const localOriginal = {
    id: originalId,
    data: {
      ...originalData,
      createdAt: { seconds: Math.floor(Date.now() / 1000) },
      updatedAt: { seconds: Math.floor(Date.now() / 1000) }
    }
  };

  currentOriginals = currentOriginals.filter((original) => {
    return original.data.playerId !== player.id;
  });

  currentOriginals.push(localOriginal);

  return localOriginal;
}

async function createMissingOriginalsForAllPlayers() {
  for (const player of currentPlayers) {
    await createMissingOriginalForPlayer(player);
  }
}

async function createMissingFanartForPlayer(player) {
  if (!player) return null;

  const targetPlayer = getTargetPlayerForCurrentRound(player);

  if (!targetPlayer) return null;

  const alreadySubmitted = getMyFanartForCurrentRound(player, targetPlayer);

  if (alreadySubmitted) {
    return alreadySubmitted;
  }

  const round = Number(currentRoom?.data?.currentRound || 0);
  const fanartId = getFanartDocId(round, player.id, targetPlayer.id);
  const artistName = player.data.name || "匿名";
  const targetName = targetPlayer.data.name || "匿名";

  const fanartData = {
    roomId,
    round,
    artistPlayerId: player.id,
    artistName,
    artistUserId: player.data.userId || "",
    artistGuestId: player.data.guestId || "",
    targetPlayerId: targetPlayer.id,
    targetName,
    imageData: createTimeUpImageData(artistName, "FA"),
    hasDrawn: false,
    isAutoSubmit: true,
    isTimeUpPlaceholder: true,
    isDeleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(
    doc(db, "ocGameFanarts", fanartId),
    fanartData,
    { merge: true }
  );

  const localFanart = {
    id: fanartId,
    data: {
      ...fanartData,
      createdAt: { seconds: Math.floor(Date.now() / 1000) },
      updatedAt: { seconds: Math.floor(Date.now() / 1000) }
    }
  };

  currentFanarts = currentFanarts.filter((fanart) => {
    return !(
      fanart.data.round === round
      && fanart.data.artistPlayerId === player.id
      && fanart.data.targetPlayerId === targetPlayer.id
    );
  });

  currentFanarts.push(localFanart);

  return localFanart;
}

async function createMissingFanartsForCurrentRound() {
  for (const player of currentPlayers) {
    await createMissingFanartForPlayer(player);
  }
}

function isOriginalTimeExpired() {
  if (!currentRoom) return false;
  if (currentRoom.data.status !== "drawing_oc") return false;

  return getOriginalRemainingSeconds() <= 0;
}

function isFanartTimeExpired() {
  if (!currentRoom) return false;
  if (currentRoom.data.status !== "drawing_fa") return false;

  const roundStartedAt = currentRoom.data.roundStartedAt;

  if (!roundStartedAt) {
    return false;
  }

  return getFanartRemainingSeconds() <= 0;
}

async function advanceToFirstFanartRound() {
  await updateDoc(doc(db, "ocGameRooms", roomId), {
    status: "drawing_fa",
    currentRound: 0,
    roundStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function advanceToNextFanartRoundOrReveal() {
  const currentRound = Number(currentRoom.data.currentRound || 0);
  const nextRound = currentRound + 1;
  const lastRoundIndex = currentPlayers.length - 2;

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
    roundStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
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

  const timeExpired = isOriginalTimeExpired();

  if (!allSubmitted && !timeExpired) return;

  try {
    advancingToFa = true;

    if (timeExpired) {
      await createMissingOriginalsForAllPlayers();
    }

    await advanceToFirstFanartRound();
  } catch (error) {
    console.error(error);
    advancingToFa = false;
  }
}

function getFanartsForCurrentRound() {
  const round = Number(currentRoom?.data?.currentRound || 0);
  const fanartMap = new Map();

  currentFanarts.forEach((fanart) => {
    if (fanart.data.isDeleted === true) return;
    if (fanart.data.round !== round) return;

    const key = [
      fanart.data.round,
      fanart.data.artistPlayerId,
      fanart.data.targetPlayerId
    ].join("_");

    const oldFanart = fanartMap.get(key);

    if (!oldFanart || getDocTime(fanart) >= getDocTime(oldFanart)) {
      fanartMap.set(key, fanart);
    }
  });

  return [...fanartMap.values()];
}

function getFanartSubmittedCountForCurrentRound() {
  const artistIds = new Set();

  getFanartsForCurrentRound().forEach((fanart) => {
    if (!fanart.data.artistPlayerId) return;

    artistIds.add(fanart.data.artistPlayerId);
  });

  return artistIds.size;
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

  const timeExpired = isFanartTimeExpired();

  if (!allSubmitted && !timeExpired) return;

  try {
    advancingRound = true;

    if (timeExpired) {
      await createMissingFanartsForCurrentRound();
    }

    await advanceToNextFanartRoundOrReveal();

    advancingRound = false;
  } catch (error) {
    console.error(error);
    advancingRound = false;
  }
}

async function forceAdvanceByOwner() {
  const message = document.getElementById("roomMessage");

  if (!isOwner()) {
    if (message) {
      message.textContent = "この操作はオーナーのみできます。";
    }

    return;
  }

  if (forceAdvanceBusy) return;

  if (!currentRoom) return;

  const ok = confirm(
    "未提出の人を時間切れ扱いにして、次へ進めますか？"
  );

  if (!ok) return;

  try {
    forceAdvanceBusy = true;

    if (message) {
      message.textContent = "未提出者を時間切れ扱いにして進めています...";
    }

    if (currentRoom.data.status === "drawing_oc") {
      await createMissingOriginalsForAllPlayers();
      await advanceToFirstFanartRound();
      return;
    }

    if (currentRoom.data.status === "drawing_fa") {
      await createMissingFanartsForCurrentRound();
      await advanceToNextFanartRoundOrReveal();
      return;
    }

    if (message) {
      message.textContent = "現在は強制進行できる状態ではありません。";
    }
  } catch (error) {
    console.error(error);

    if (message) {
      message.textContent = "強制進行に失敗しました。";
    }
  } finally {
    forceAdvanceBusy = false;
  }
}

async function joinAsGuest() {
  const nameInput = document.getElementById("guestName");
  const message = document.getElementById("roomMessage");

  const alreadyJoined = getMyPlayer();

  if (alreadyJoined) {
    if (message) {
      message.textContent = "すでに参加しています。";
    }

    return;
  }

  if (currentRoom.data.status !== "waiting") {
    if (message) {
      message.textContent = "この部屋はすでに開始されています。";
    }

    return;
  }

  if (currentPlayers.length >= currentRoom.data.maxPlayers) {
    if (message) {
      message.textContent = "この部屋は満員です。";
    }

    return;
  }

  const name = nameInput.value.trim() || getAutoGuestName();
  const guestId = getGuestId();

  try {
    if (message) {
      message.textContent = "参加しています...";
    }

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

    if (message) {
      message.textContent = "参加しました。";
    }
  } catch (error) {
    console.error(error);

    if (message) {
      message.textContent = "参加に失敗しました。";
    }
  }
}

async function joinAsLoginUser() {
  const message = document.getElementById("roomMessage");

  if (!currentUser) {
    if (message) {
      message.textContent = "ログインしていません。";
    }

    return;
  }

  const alreadyJoined = getMyPlayer();

  if (alreadyJoined) {
    if (message) {
      message.textContent = "すでに参加しています。";
    }

    return;
  }

  if (currentRoom.data.status !== "waiting") {
    if (message) {
      message.textContent = "この部屋はすでに開始されています。";
    }

    return;
  }

  if (currentPlayers.length >= currentRoom.data.maxPlayers) {
    if (message) {
      message.textContent = "この部屋は満員です。";
    }

    return;
  }

  const name = await getOcfaDisplayName(currentUser);

  try {
    if (message) {
      message.textContent = "参加しています...";
    }

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

    if (message) {
      message.textContent = "参加しました。";
    }
  } catch (error) {
    console.error(error);

    if (message) {
      message.textContent = "参加に失敗しました。";
    }
  }
}

async function startGame() {
  const message = document.getElementById("roomMessage");

  if (!isOwner()) {
    if (message) {
      message.textContent = "ゲーム開始はオーナーのみできます。";
    }

    return;
  }

  if (currentRoom.data.status !== "waiting") {
    if (message) {
      message.textContent = "この部屋はすでに開始されています。";
    }

    return;
  }

  if (currentPlayers.length < 2) {
    if (message) {
      message.textContent = "2人以上集まると開始できます。";
    }

    return;
  }

  const ok = confirm(
    `現在の参加者は${currentPlayers.length}人です。\nこの人数でゲームを開始しますか？`
  );

  if (!ok) return;

  try {
    if (message) {
      message.textContent = "ゲームを開始しています...";
    }

    await updateDoc(doc(db, "ocGameRooms", roomId), {
      status: "drawing_oc",
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);

    if (message) {
      message.textContent = "ゲーム開始に失敗しました。";
    }
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

function getPlayerNameById(playerId, fallbackName = "匿名") {
  const player = currentPlayers.find((item) => {
    return item.id === playerId;
  });

  return player?.data?.name || fallbackName || "匿名";
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

function isDrawingCanvasVisible() {
  return Boolean(document.getElementById("gameCanvas"));
}

function shouldProtectCanvasFromRealtimeRender(previousRoomData = null) {
  if (!currentRoom) return false;

  const status = currentRoom.data.status;

  if (status !== "drawing_oc" && status !== "drawing_fa") {
    return false;
  }

  if (!isDrawingCanvasVisible()) {
    return false;
  }

  if (submittingOriginal || submittingFanart) {
    return false;
  }

  if (previousRoomData) {
    const previousStatus = previousRoomData.status;
    const currentStatus = currentRoom.data.status;

    const previousRound = Number(previousRoomData.currentRound || 0);
    const currentRound = Number(currentRoom.data.currentRound || 0);

    if (previousStatus !== currentStatus) {
      return false;
    }

    if (previousRound !== currentRound) {
      return false;
    }
  }

  return true;
}

async function safeRenderRoom(previousRoomData = null) {
  if (!currentRoom) return;

  if (shouldProtectCanvasFromRealtimeRender(previousRoomData)) {
    return;
  }

  if (isRenderingRoom) {
    return;
  }

  try {
    isRenderingRoom = true;
    await renderRoom();
  } finally {
    isRenderingRoom = false;
  }
}

function renderOwnerArea() {
  if (!isOwner()) return "";

  if (currentRoom.data.status === "waiting") {
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

  if (
    currentRoom.data.status === "drawing_oc"
    || currentRoom.data.status === "drawing_fa"
  ) {
    return `
      <section class="panel-soft">
        <p class="eyebrow">Owner</p>
        <h2>オーナー操作</h2>

        <p>
          もし誰かの提出が反映されずに止まった場合、
          未提出者を時間切れ扱いにして次へ進められます。
        </p>

        <div class="actions">
          <button id="forceAdvanceBtn" class="danger-btn" type="button">
            未提出者を時間切れ扱いで進める
          </button>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel-soft">
      <p>ゲームは終了しています。</p>
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

    <div class="game-tool-actions">
      <button id="penToolBtn" type="button" class="is-active">
        ペン
      </button>

      <button id="eraserToolBtn" type="button">
        消しゴム
      </button>

      <button id="fillToolBtn" type="button">
        塗りつぶし
      </button>

      <button id="undoLayerBtn" type="button">
        1つ戻る
      </button>
    </div>

    <div class="game-layer-panel">
      <p class="mini-info">レイヤーは「上」から順に表示されます。</p>

      <div class="game-layer-tools">
        <button id="layerBtn1" type="button" class="layer-btn layer-top">
          <span class="layer-order">上</span>
          レイヤー2
        </button>

        <button id="layerBtn0" type="button" class="layer-btn layer-bottom is-active">
          <span class="layer-order">下</span>
          レイヤー1
        </button>
      </div>

      <div class="game-layer-actions">
        <button id="toggleLayerBtn" type="button">
          選択中を表示/非表示
        </button>

        <button id="clearLayerBtn" type="button" class="danger-btn">
          選択中を消す
        </button>
      </div>

      <p id="layerStatusText" class="mini-info">
        現在：レイヤー1（下・表示中）
      </p>
    </div>
  `;
}

function getFanartsByTargetPlayerId(targetPlayerId) {
  const fanartMap = new Map();

  currentFanarts.forEach((fanart) => {
    if (fanart.data.isDeleted === true) return;
    if (fanart.data.targetPlayerId !== targetPlayerId) return;

    const key = [
      fanart.data.round,
      fanart.data.artistPlayerId,
      fanart.data.targetPlayerId
    ].join("_");

    const oldFanart = fanartMap.get(key);

    if (!oldFanart || getDocTime(fanart) >= getDocTime(oldFanart)) {
      fanartMap.set(key, fanart);
    }
  });

  return [...fanartMap.values()].sort((a, b) => {
    const aRound = Number(a.data.round || 0);
    const bRound = Number(b.data.round || 0);

    return aRound - bRound;
  });
}

function renderRevealArea() {
  if (!currentPlayers.length) {
    return `
      <section class="panel">
        <p class="eyebrow">Result</p>
        <h2>結果発表</h2>
        <p>参加者データがありません。</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <p class="eyebrow">Result</p>
      <h2>結果発表</h2>

      <p>
        全ラウンドが終了しました。
        キャラごとに、みんなが描いたファンアートを表示しています。
      </p>
    </section>

    <div class="game-result-list">
      ${currentPlayers
        .map((player) => {
          const original = getOriginalByPlayerId(player.id);
          const fanarts = getFanartsByTargetPlayerId(player.id);

          return `
            <section class="panel game-result-character">
              <div class="section-head">
                <div>
                  <p class="eyebrow">Original Character</p>
                  <h2>${escapeHtml(player.data.name || "匿名")}さんのOC</h2>
                </div>
              </div>

              ${
                original
                  ? `
                    <div class="game-result-original">
                      <img
                        src="${original.data.imageData}"
                        alt="${escapeHtml(player.data.name || "匿名")}さんのOC"
                      >
                    </div>
                  `
                  : `
                    <p class="mini-info">元OCが見つかりませんでした。</p>
                  `
              }

              <h3>描かれたFA</h3>

              ${
                fanarts.length
                  ? `
                    <div class="game-result-fanarts">
                      ${fanarts
                        .map((fanart) => {
                          return `
                            <article class="game-result-fanart-card">
                              <img src="${fanart.data.imageData}" alt="FA">

                              <p>
                                by ${escapeHtml(getPlayerNameById(
                                  fanart.data.artistPlayerId,
                                  fanart.data.artistName
                                ))}
                              </p>
                            </article>
                          `;
                        })
                        .join("")}
                    </div>
                  `
                  : `
                    <p class="mini-info">FAがありません。</p>
                  `
              }
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

async function renderGameStageArea() {
  if (!currentRoom) {
    return "";
  }

  if (currentRoom.data.status === "reveal") {
    return renderRevealArea();
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

          ${
            canCancelSubmitNow()
              ? `
                <div class="actions">
                  <button
                    id="cancelFanartBtn"
                    class="ghost-btn"
                    type="button"
                    data-fanart-id="${submittedFanart.id}"
                  >
                    提出を取り消す
                  </button>
                </div>

                <p class="mini-info">
                  取り消すと、提出した絵を下書きとして復元して描き直せます。
                </p>
              `
              : `
                <p class="mini-info">
                  残り30秒を切ったため、提出は取り消せません。
                </p>
              `
          }
        </section>
      `;
    }

    return `
      <section class="panel game-fa-panel">
        <p class="eyebrow">Fan Art Turn</p>
        <h2>${escapeHtml(targetPlayer.data.name || "匿名")}さんのOCを描く</h2>

        <p class="mini-info">
          Round ${Number(currentRoom.data.currentRound || 0) + 1}
          /
          ${Math.max(1, currentPlayers.length - 1)}
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

        <p class="mini-info">
          描いた内容はこの端末に自動保存されます。
          時間切れになった場合も、保存されている絵があればそれを提出します。
        </p>

        <div class="game-timer-box">
          <p id="fanartTimerText" class="game-timer">残り時間：--:--</p>

          <div class="game-timer-meter">
            <span id="fanartTimerBar"></span>
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

        <p>
          あなたのOCは提出済みです。
          全員の提出が終わるまで待ってください。
        </p>

        <div class="submitted-oc-preview">
          <img src="${submitted.data.imageData}" alt="提出したOC">
        </div>

        ${
          canCancelSubmitNow()
            ? `
              <div class="actions">
                <button
                  id="cancelOriginalBtn"
                  class="ghost-btn"
                  type="button"
                  data-original-id="${submitted.id}"
                >
                  提出を取り消す
                </button>
              </div>

              <p class="mini-info">
                取り消すと、提出した絵を下書きとして復元して描き直せます。
              </p>
            `
            : `
              <p class="mini-info">
                残り30秒を切ったため、提出は取り消せません。
              </p>
            `
        }
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

      <p class="mini-info">
        描いた内容はこの端末に自動保存されます。
        時間切れになった場合も、保存されている絵があればそれを提出します。
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










function clearOwnerAutoAdvanceWatcher() {
  if (window.ocfaGameOwnerWatchId) {
    clearInterval(window.ocfaGameOwnerWatchId);
    window.ocfaGameOwnerWatchId = null;
  }
}

function startOwnerAutoAdvanceWatcher() {
  clearOwnerAutoAdvanceWatcher();

  if (!isOwner()) return;
  if (!currentRoom) return;

  const status = currentRoom.data.status;

  if (status !== "drawing_oc" && status !== "drawing_fa") return;

  window.ocfaGameOwnerWatchId = setInterval(async () => {
    if (!currentRoom) return;
    if (!isOwner()) return;

    try {
      await checkAllOriginalsSubmitted();
      await checkAllFanartsSubmitted();
    } catch (error) {
      console.error(error);
    }
  }, 1000);
}

function syncOwnerAutoAdvanceWatcher() {
  if (!currentRoom) {
    clearOwnerAutoAdvanceWatcher();
    return;
  }

  const status = currentRoom.data.status;

  if (
    isOwner()
    && (status === "drawing_oc" || status === "drawing_fa")
  ) {
    if (!window.ocfaGameOwnerWatchId) {
      startOwnerAutoAdvanceWatcher();
    }

    return;
  }

  clearOwnerAutoAdvanceWatcher();
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
        1ターン ${Math.floor(Number(room.turnSeconds || 120) / 60)}分
      </p>

      <p class="mini-info">
        OC提出 ${getOriginalSubmittedCount()} / ${currentPlayers.length}人
      </p>

      ${
        room.status === "drawing_fa"
          ? `
            <p class="mini-info">
              現在のFA提出 ${getFanartSubmittedCountForCurrentRound()} / ${currentPlayers.length}人
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
  const forceAdvanceBtn = document.getElementById("forceAdvanceBtn");
  const submitOriginalBtn = document.getElementById("submitOriginalBtn");
  const submitFanartBtn = document.getElementById("submitFanartBtn");
  const cancelOriginalBtn = document.getElementById("cancelOriginalBtn");
  const cancelFanartBtn = document.getElementById("cancelFanartBtn");
  const roomMessage = document.getElementById("roomMessage");

  syncOwnerAutoAdvanceWatcher();

  if (copyRoomUrlBtn) {
    copyRoomUrlBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);

        if (roomMessage) {
          roomMessage.textContent = "部屋URLをコピーしました。";
        }
      } catch (error) {
        console.error(error);

        if (roomMessage) {
          roomMessage.textContent = "コピーに失敗しました。";
        }
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

  if (forceAdvanceBtn) {
    forceAdvanceBtn.addEventListener("click", forceAdvanceByOwner);
  }

  if (submitOriginalBtn) {
    submittingOriginal = false;

    initGameCanvas();
    loadGameDraft("oc");
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
    loadGameDraft("fa");
    startFanartAutoSubmitTimer();

    submitFanartBtn.addEventListener("click", () => {
      submitFanart(false);
    });
  } else {
    clearFanartTimer();
  }

  if (cancelOriginalBtn) {
    cancelOriginalBtn.addEventListener("click", () => {
      cancelOriginalSubmit(cancelOriginalBtn.dataset.originalId);
    });
  }

  if (cancelFanartBtn) {
    cancelFanartBtn.addEventListener("click", () => {
      cancelFanartSubmit(cancelFanartBtn.dataset.fanartId);
    });
  }
}

async function cancelOriginalSubmit(originalId) {
  const message = document.getElementById("roomMessage");

  if (!originalId) return;

  if (!canCancelSubmitNow()) {
    if (message) {
      message.textContent = "残り30秒を切ったため、提出は取り消せません。";
    }

    return;
  }

  if (!confirm("提出したOCを取り消しますか？")) return;

  try {
    if (message) {
      message.textContent = "OC提出を取り消しています...";
    }

    const original = currentOriginals.find((item) => {
      return item.id === originalId;
    });

    if (original?.data?.imageData && !hasGameDraft("oc")) {
      saveSubmittedImageAsDraft(original.data.imageData, "oc");
    }

    await updateDoc(doc(db, "ocGameOriginals", originalId), {
      isDeleted: true,
      updatedAt: serverTimestamp()
    });

    currentOriginals = currentOriginals.filter((original) => {
      return original.id !== originalId;
    });

    if (message) {
      message.textContent = "OC提出を取り消しました。";
    }

    await renderRoom();
  } catch (error) {
    console.error(error);

    if (message) {
      message.textContent = "OC提出の取り消しに失敗しました。";
    }
  }
}

async function cancelFanartSubmit(fanartId) {
  const message = document.getElementById("roomMessage");

  if (!fanartId) return;

  if (!canCancelSubmitNow()) {
    if (message) {
      message.textContent = "残り30秒を切ったため、提出は取り消せません。";
    }

    return;
  }

  if (!confirm("提出したFAを取り消しますか？")) return;

  try {
    if (message) {
      message.textContent = "FA提出を取り消しています...";
    }

    const fanart = currentFanarts.find((item) => {
      return item.id === fanartId;
    });

    if (fanart?.data?.imageData && !hasGameDraft("fa")) {
      saveSubmittedImageAsDraft(fanart.data.imageData, "fa");
    }

    await updateDoc(doc(db, "ocGameFanarts", fanartId), {
      isDeleted: true,
      updatedAt: serverTimestamp()
    });

    currentFanarts = currentFanarts.filter((fanart) => {
      return fanart.id !== fanartId;
    });

    if (message) {
      message.textContent = "FA提出を取り消しました。";
    }

    await renderRoom();
  } catch (error) {
    console.error(error);

    if (message) {
      message.textContent = "FA提出の取り消しに失敗しました。";
    }
  }
}

function renderNoRoomId() {
  clearOriginalTimer();
  clearFanartTimer();
  clearOwnerAutoAdvanceWatcher();

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
  clearOriginalTimer();
  clearFanartTimer();
  clearOwnerAutoAdvanceWatcher();

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

  clearOriginalTimer();
  clearFanartTimer();

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

      const previousRoomData = currentRoom?.data || null;

      currentRoom = {
        id: snap.id,
        data
      };

      if (
        currentRoom.data.status !== "drawing_oc"
        && currentRoom.data.status !== "drawing_fa"
      ) {
        clearOwnerAutoAdvanceWatcher();
      }

      await checkAllOriginalsSubmitted();
      await checkAllFanartsSubmitted();

      await safeRenderRoom(previousRoomData);
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
        await safeRenderRoom();
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
        await safeRenderRoom();
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
        await safeRenderRoom();
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
  currentTool = "pen";
  layerHistory = [[], []];

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

  const layerNames = [
    "レイヤー1（下）",
    "レイヤー2（上）"
  ];

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
    layerStatusText.textContent =
      `現在：${layerNames[activeLayerIndex]}（${visibleText}）`;
  }
}

function setupLayerButtons() {
  const layerBtn0 = document.getElementById("layerBtn0");
  const layerBtn1 = document.getElementById("layerBtn1");
  const toggleLayerBtn = document.getElementById("toggleLayerBtn");
  const clearLayerBtn = document.getElementById("clearLayerBtn");
  const gamePenSize = document.getElementById("gamePenSize");
  const gamePenSizeText = document.getElementById("gamePenSizeText");
  const penToolBtn = document.getElementById("penToolBtn");
  const eraserToolBtn = document.getElementById("eraserToolBtn");
  const fillToolBtn = document.getElementById("fillToolBtn");
  const undoLayerBtn = document.getElementById("undoLayerBtn");

  function updateToolButtons() {
    if (penToolBtn) {
      penToolBtn.classList.toggle("is-active", currentTool === "pen");
    }

    if (eraserToolBtn) {
      eraserToolBtn.classList.toggle("is-active", currentTool === "eraser");
    }

    if (fillToolBtn) {
      fillToolBtn.classList.toggle("is-active", currentTool === "fill");
    }
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

  if (fillToolBtn) {
    fillToolBtn.addEventListener("click", () => {
      currentTool = "fill";
      updateToolButtons();
    });
  }

  if (undoLayerBtn) {
    undoLayerBtn.addEventListener("click", undoActiveLayer);
  }

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
      gameHasDrawn = true;
      saveCurrentGameDraft();
      updateLayerUi();
    });
  }

  if (clearLayerBtn) {
    clearLayerBtn.addEventListener("click", () => {
      if (!confirm(`レイヤー${activeLayerIndex + 1}を消しますか？`)) return;

      const targetCtx = getActiveLayerCtx();

      if (!targetCtx) return;

      saveActiveLayerHistory();

      targetCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

      gameHasDrawn = true;

      redrawGameCanvas();
      saveCurrentGameDraft();
      updateLayerUi();
    });
  }

  if (gamePenSize && gamePenSizeText) {
    gamePenSizeText.textContent = gamePenSize.value;

    gamePenSize.addEventListener("input", () => {
      gamePenSizeText.textContent = gamePenSize.value;
    });
  }

  updateToolButtons();
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
  gameCanvas.addEventListener("touchcancel", stopGameDraw);

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

  if (currentTool === "fill") {
    fillActiveLayer(point.x, point.y);
    return;
  }

  saveActiveLayerHistory();

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

  targetCtx.save();

  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.lineWidth = Number(gamePenSize?.value || 5);

  if (currentTool === "eraser") {
    targetCtx.globalCompositeOperation = "destination-out";
    targetCtx.strokeStyle = "rgba(0, 0, 0, 1)";
  } else {
    targetCtx.globalCompositeOperation = "source-over";
    targetCtx.strokeStyle = gamePenColor?.value || "#2b2430";
  }

  targetCtx.beginPath();
  targetCtx.moveTo(gameLastX, gameLastY);
  targetCtx.lineTo(point.x, point.y);
  targetCtx.stroke();

  targetCtx.restore();

  gameLastX = point.x;
  gameLastY = point.y;
  gameHasDrawn = true;

  redrawGameCanvas();
  saveCurrentGameDraft();
}

function stopGameDraw() {
  if (!gameDrawing) return;

  gameDrawing = false;
  saveCurrentGameDraft();
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
  if (!gameCanvas) return "";

  return gameCanvas.toDataURL("image/jpeg", 0.82);
}

function getDraftKey(type = "oc") {
  const myPlayer = getMyPlayer();
  const playerId = myPlayer?.id || "unknown";
  const round = Number(currentRoom?.data?.currentRound || 0);

  return `ocfa_game_draft_${roomId}_${playerId}_${type}_${round}`;
}

function getCurrentDraftType() {
  if (currentRoom?.data?.status === "drawing_fa") {
    return "fa";
  }

  return "oc";
}

function saveCurrentGameDraft() {
  const status = currentRoom?.data?.status;

  if (status !== "drawing_oc" && status !== "drawing_fa") return;

  saveGameDraft(getCurrentDraftType());
}

function saveGameDraft(type = "oc") {
  if (!gameCanvas) return;

  try {
    const draftKey = getDraftKey(type);
    const imageData = getGameCanvasImageData();

    if (!imageData) return;

    localStorage.setItem(draftKey, imageData);
  } catch (error) {
    console.error(error);
  }
}

function hasGameDraft(type = "oc") {
  try {
    const draftKey = getDraftKey(type);

    return Boolean(localStorage.getItem(draftKey));
  } catch (error) {
    console.error(error);
    return false;
  }
}

function loadGameDraft(type = "oc") {
  if (!gameCanvas || !gameCtx) return false;

  try {
    const draftKey = getDraftKey(type);
    const imageData = localStorage.getItem(draftKey);

    if (!imageData) return false;

    const image = new Image();

    image.onload = () => {
      const targetCtx = getActiveLayerCtx();

      if (!targetCtx) return;

      targetCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
      targetCtx.drawImage(image, 0, 0, gameCanvas.width, gameCanvas.height);

      gameHasDrawn = true;
      redrawGameCanvas();
    };

    image.src = imageData;

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function clearGameDraft(type = "oc") {
  try {
    const draftKey = getDraftKey(type);

    localStorage.removeItem(draftKey);
  } catch (error) {
    console.error(error);
  }
}

function saveSubmittedImageAsDraft(imageData, type = "oc") {
  if (!imageData) return;

  try {
    const draftKey = getDraftKey(type);

    localStorage.setItem(draftKey, imageData);
  } catch (error) {
    console.error(error);
  }
}

function clearOriginalTimer() {
  if (originalTimerId) {
    clearInterval(originalTimerId);
    originalTimerId = null;
  }
}

function clearFanartTimer() {
  if (fanartTimerId) {
    clearInterval(fanartTimerId);
    fanartTimerId = null;
  }
}

function getTimestampMs(value) {
  if (!value) return Date.now();

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value.seconds) {
    return value.seconds * 1000;
  }

  return Date.now();
}

function getRoomStartedMs() {
  return getTimestampMs(currentRoom?.data?.startedAt);
}

function getRoundStartedMs() {
  const roundStartedAt = currentRoom?.data?.roundStartedAt;

  if (!roundStartedAt) {
    return null;
  }

  return getTimestampMs(roundStartedAt);
}











function getOriginalRemainingSeconds() {
  const startedMs = getRoomStartedMs();
  const turnSeconds = Number(currentRoom?.data?.turnSeconds || 120);
  const endMs = startedMs + turnSeconds * 1000;

  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

function getFanartRemainingSeconds() {
  const startedMs = getRoundStartedMs();
  const turnSeconds = Number(currentRoom?.data?.turnSeconds || 120);

  if (!startedMs) {
    return turnSeconds;
  }

  const endMs = startedMs + turnSeconds * 1000;

  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

function formatTimer(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;

  return `${min}:${String(sec).padStart(2, "0")}`;
}

function drawTimeUpCard(name, label = "OC") {
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
  gameCtx.fillText(
    `${name || "匿名"} の${label}`,
    gameCanvas.width / 2,
    gameCanvas.height / 2 + 28
  );

  gameCtx.restore();

  gameHasDrawn = true;
}

function updateTimerDisplay(timerText, timerBar, remaining, turnSeconds) {
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
}

function startOriginalAutoSubmitTimer() {
  clearOriginalTimer();

  const timerText = document.getElementById("originalTimerText");
  const timerBar = document.getElementById("originalTimerBar");

  async function tick() {
    if (!currentRoom || currentRoom.data.status !== "drawing_oc") {
      clearOriginalTimer();
      return;
    }

    const remaining = getOriginalRemainingSeconds();
    const turnSeconds = Number(currentRoom?.data?.turnSeconds || 120);

    updateTimerDisplay(timerText, timerBar, remaining, turnSeconds);

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

function startFanartAutoSubmitTimer() {
  clearFanartTimer();

  const timerText = document.getElementById("fanartTimerText");
  const timerBar = document.getElementById("fanartTimerBar");

  async function tick() {
    if (!currentRoom || currentRoom.data.status !== "drawing_fa") {
      clearFanartTimer();
      return;
    }

    const startedMs = getRoundStartedMs();
    const turnSeconds = Number(currentRoom?.data?.turnSeconds || 120);

    if (!startedMs) {
      updateTimerDisplay(timerText, timerBar, turnSeconds, turnSeconds);
      return;
    }

    const remaining = getFanartRemainingSeconds();

    updateTimerDisplay(timerText, timerBar, remaining, turnSeconds);

    if (remaining <= 0) {
      clearFanartTimer();

      if (!submittingFanart) {
        await submitFanart(true);
      }
    }
  }

  tick();

  fanartTimerId = setInterval(() => {
    tick();
  }, 1000);
}

async function waitForDraftLoad() {
  await new Promise((resolve) => {
    setTimeout(resolve, 350);
  });
}

async function submitOriginalOc(isAutoSubmit = false) {
  const message = document.getElementById("roomMessage");
  const submitOriginalBtn = document.getElementById("submitOriginalBtn");
  const myPlayer = getMyPlayer();

  if (submittingOriginal) return;

  if (!currentRoom || currentRoom.data.status !== "drawing_oc") {
    return;
  }

  if (!myPlayer) {
    if (message) {
      message.textContent = "参加してから提出してください。";
    }

    return;
  }

  if (!gameHasDrawn && !isAutoSubmit) {
    if (message) {
      message.textContent = "提出する前にOCを描いてください。";
    }

    return;
  }

  try {
    submittingOriginal = true;

    if (submitOriginalBtn) {
      submitOriginalBtn.disabled = true;
    }

    const originalId = getOriginalDocId(myPlayer.id);
    const originalRef = doc(db, "ocGameOriginals", originalId);
    const existingSnap = await getDoc(originalRef);

    if (existingSnap.exists() && existingSnap.data().isDeleted !== true) {
      clearOriginalTimer();

      if (message) {
        message.textContent = "すでにOCを提出済みです。";
      }

      await renderRoom();
      return;
    }

    if (message) {
      message.textContent = isAutoSubmit
        ? "時間になったため、自動提出しています..."
        : "OCを提出しています...";
    }

    if (isAutoSubmit && !gameHasDrawn) {
      const restored = loadGameDraft("oc");

      if (restored) {
        await waitForDraftLoad();
      }
    }

    if (isAutoSubmit && !gameHasDrawn) {
      drawTimeUpCard(myPlayer.data.name || "匿名", "OC");
    } else {
      redrawGameCanvas();
    }

    addWatermarkToGameCanvas(myPlayer.data.name || "匿名");

    const imageData = getGameCanvasImageData();

    const originalData = {
      roomId,
      playerId: myPlayer.id,
      playerName: myPlayer.data.name || "匿名",
      userId: myPlayer.data.userId || "",
      guestId: myPlayer.data.guestId || "",
      imageData,
      hasDrawn: gameHasDrawn,
      isAutoSubmit,
      isDeleted: false,
      createdAt: existingSnap.exists()
        ? existingSnap.data().createdAt || serverTimestamp()
        : serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(
      originalRef,
      originalData,
      { merge: true }
    );

    currentOriginals = currentOriginals.filter((original) => {
      return original.data.playerId !== myPlayer.id;
    });

    currentOriginals.push({
      id: originalId,
      data: {
        ...originalData,
        createdAt: { seconds: Math.floor(Date.now() / 1000) },
        updatedAt: { seconds: Math.floor(Date.now() / 1000) }
      }
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

async function submitFanart(isAutoSubmit = false) {
  const message = document.getElementById("roomMessage");
  const submitFanartBtn = document.getElementById("submitFanartBtn");

  const myPlayer = getMyPlayer();

  if (submittingFanart) return;

  if (!currentRoom || currentRoom.data.status !== "drawing_fa") {
    return;
  }

  if (isAutoSubmit && !getRoundStartedMs()) {
    return;
  }

  if (!myPlayer) {
    if (message) {
      message.textContent = "参加してから提出してください。";
    }

    return;
  }

  const targetPlayer = getTargetPlayerForCurrentRound(myPlayer);

  if (!targetPlayer) {
    if (message) {
      message.textContent = "描く相手が見つかりません。";
    }

    return;
  }

  const round = Number(currentRoom?.data?.currentRound || 0);
  const fanartId = getFanartDocId(round, myPlayer.id, targetPlayer.id);
  const fanartRef = doc(db, "ocGameFanarts", fanartId);
  const existingSnap = await getDoc(fanartRef);

  if (existingSnap.exists() && existingSnap.data().isDeleted !== true) {
    clearFanartTimer();

    if (message) {
      message.textContent = "このターンのFAは提出済みです。";
    }

    await renderRoom();
    return;
  }

  if (!gameHasDrawn) {
    const restored = loadGameDraft("fa");

    if (restored) {
      await waitForDraftLoad();
    }
  }

  if (!gameHasDrawn && !isAutoSubmit) {
    if (message) {
      message.textContent = "提出する前にFAを描いてください。";
    }

    return;
  }

  try {
    submittingFanart = true;

    if (submitFanartBtn) {
      submitFanartBtn.disabled = true;
    }

    if (message) {
      message.textContent = isAutoSubmit
        ? "時間になったため、FAを自動提出しています..."
        : "FAを提出しています...";
    }

    if (isAutoSubmit && !gameHasDrawn) {
      drawTimeUpCard(myPlayer.data.name || "匿名", "FA");
    } else {
      redrawGameCanvas();
    }

    addWatermarkToGameCanvas(myPlayer.data.name || "匿名");

    const imageData = getGameCanvasImageData();

    const fanartData = {
      roomId,
      round,
      artistPlayerId: myPlayer.id,
      artistName: myPlayer.data.name || "匿名",
      artistUserId: myPlayer.data.userId || "",
      artistGuestId: myPlayer.data.guestId || "",
      targetPlayerId: targetPlayer.id,
      targetName: targetPlayer.data.name || "匿名",
      imageData,
      hasDrawn: gameHasDrawn,
      isAutoSubmit,
      isDeleted: false,
      createdAt: existingSnap.exists()
        ? existingSnap.data().createdAt || serverTimestamp()
        : serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(
      fanartRef,
      fanartData,
      { merge: true }
    );

    currentFanarts = currentFanarts.filter((fanart) => {
      return !(
        fanart.data.round === round
        && fanart.data.artistPlayerId === myPlayer.id
        && fanart.data.targetPlayerId === targetPlayer.id
      );
    });

    currentFanarts.push({
      id: fanartId,
      data: {
        ...fanartData,
        createdAt: { seconds: Math.floor(Date.now() / 1000) },
        updatedAt: { seconds: Math.floor(Date.now() / 1000) }
      }
    });

    clearFanartTimer();

    if (message) {
      message.textContent = isAutoSubmit
        ? "時間切れのため、FAを自動提出しました。"
        : "FAを提出しました。ほかの人の提出を待っています。";
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

async function getOcfaDisplayName(user) {
  if (!user) return "参加者";

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();

      if (userData.displayName) {
        return userData.displayName;
      }
    }
  } catch (error) {
    console.error(error);
  }

  return (
    user.displayName ||
    user.email?.split("@")[0] ||
    "参加者"
  );
}

function saveActiveLayerHistory() {
  const targetCtx = getActiveLayerCtx();

  if (!targetCtx || !gameCanvas) return;

  const imageData = targetCtx.getImageData(
    0,
    0,
    gameCanvas.width,
    gameCanvas.height
  );

  layerHistory[activeLayerIndex].push(imageData);

  if (layerHistory[activeLayerIndex].length > MAX_LAYER_HISTORY) {
    layerHistory[activeLayerIndex].shift();
  }
}

function undoActiveLayer() {
  const targetCtx = getActiveLayerCtx();
  const history = layerHistory[activeLayerIndex];

  if (!targetCtx || !history || history.length === 0) {
    const roomMessage = document.getElementById("roomMessage");

    if (roomMessage) {
      roomMessage.textContent = "これ以上戻れません。";
    }

    return;
  }

  const previousImage = history.pop();

  targetCtx.putImageData(previousImage, 0, 0);

  gameHasDrawn = true;

  redrawGameCanvas();
  saveCurrentGameDraft();
  updateLayerUi();
}

function hexToRgba(hex) {
  const cleanHex = hex.replace("#", "");

  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);

  return [r, g, b, 255];
}

function colorsClose(data, index, targetColor, tolerance = 24) {
  return Math.abs(data[index] - targetColor[0]) <= tolerance
    && Math.abs(data[index + 1] - targetColor[1]) <= tolerance
    && Math.abs(data[index + 2] - targetColor[2]) <= tolerance
    && Math.abs(data[index + 3] - targetColor[3]) <= tolerance;
}

function fillActiveLayer(startX, startY) {
  const targetCtx = getActiveLayerCtx();
  const colorInput = document.getElementById("gamePenColor");

  if (!targetCtx || !gameCanvas || !gameCtx) return;

  if (!layerVisible[activeLayerIndex]) {
    const roomMessage = document.getElementById("roomMessage");

    if (roomMessage) {
      roomMessage.textContent = "非表示中のレイヤーには塗りつぶしできません。";
    }

    return;
  }

  saveActiveLayerHistory();

  redrawGameCanvas();

  const width = gameCanvas.width;
  const height = gameCanvas.height;

  const x = Math.floor(startX);
  const y = Math.floor(startY);

  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const baseImage = gameCtx.getImageData(0, 0, width, height);
  const baseData = baseImage.data;

  const layerImage = targetCtx.getImageData(0, 0, width, height);
  const layerData = layerImage.data;

  const fillColor = hexToRgba(colorInput?.value || "#2b2430");

  const startIndex = (y * width + x) * 4;
  const targetColor = [
    baseData[startIndex],
    baseData[startIndex + 1],
    baseData[startIndex + 2],
    baseData[startIndex + 3]
  ];

  if (
    Math.abs(targetColor[0] - fillColor[0]) < 3
    && Math.abs(targetColor[1] - fillColor[1]) < 3
    && Math.abs(targetColor[2] - fillColor[2]) < 3
  ) {
    return;
  }

  const stack = [[x, y]];
  const visited = new Uint8Array(width * height);

  while (stack.length > 0) {
    const [currentX, currentY] = stack.pop();

    if (
      currentX < 0 ||
      currentY < 0 ||
      currentX >= width ||
      currentY >= height
    ) {
      continue;
    }

    const pixelIndex = currentY * width + currentX;

    if (visited[pixelIndex]) continue;

    visited[pixelIndex] = 1;

    const dataIndex = pixelIndex * 4;

    if (!colorsClose(baseData, dataIndex, targetColor)) {
      continue;
    }

    layerData[dataIndex] = fillColor[0];
    layerData[dataIndex + 1] = fillColor[1];
    layerData[dataIndex + 2] = fillColor[2];
    layerData[dataIndex + 3] = fillColor[3];

    stack.push([currentX + 1, currentY]);
    stack.push([currentX - 1, currentY]);
    stack.push([currentX, currentY + 1]);
    stack.push([currentX, currentY - 1]);
  }

  targetCtx.putImageData(layerImage, 0, 0);

  gameHasDrawn = true;

  redrawGameCanvas();
  saveCurrentGameDraft();
}

function getCurrentTurnRemainingSeconds() {
  if (!currentRoom) return 9999;

  if (currentRoom.data.status === "drawing_oc") {
    return getOriginalRemainingSeconds();
  }

  if (currentRoom.data.status === "drawing_fa") {
    return getFanartRemainingSeconds();
  }

  return 9999;
}

function canCancelSubmitNow() {
  return getCurrentTurnRemainingSeconds() > 30;
}

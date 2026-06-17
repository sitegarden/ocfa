import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
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

/* 筆圧ペン途中停止対策 */
let gameActivePointerId = null;
let lastCanvasInputAt = 0;

/* 筆圧を使いやすくするための補正用 */
let gameLastPressure = 0.5;
let gameSmoothedPressure = 0.5;

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

let gamePenColorValue = "#2b2430";
let gamePenSizeValue = 6;

let stabilizerEnabled = true;
let stabilizerStrength = 0.45;
let toolSettingsOpen = false;


/*
  筆圧ONでも細くなりすぎないようにする
  OFFなら普通のブラシとして描ける
*/
let pressureEnabled = false;

const MAX_LAYER_HISTORY = 20;
const TIME_UP_GRACE_MS = 7000;

/* 筆圧補正 */
const MIN_PRESSURE = 0.18;
const MAX_PRESSURE = 1.0;
const PRESSURE_SMOOTHING = 0.55;

/* キャンバス */
const GAME_CANVAS_SIZE = 768;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeGuestHandle(text) {
  const value = String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);

  if (!value) return "";

  if (value.startsWith("@")) {
    return value;
  }

  return value;
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
  if (status === "starting") return "開始準備中";
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
  const guestId = getGuestId();

  if (currentUser) {
    return currentPlayers.find((player) => {
      return (
        player.data.isLeft !== true &&
        (
          player.data.userId === currentUser.uid ||
          player.data.guestId === guestId
        )
      );
    });
  }

  return currentPlayers.find((player) => {
    return player.data.guestId === guestId && player.data.isLeft !== true;
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

  return getOcPlayers().filter((player) => {
    return submittedPlayerIds.has(player.id);
  }).length;
}

function getTargetPlayerForCurrentRound(myPlayer) {
  if (!myPlayer) return null;

  const round = Number(currentRoom?.data?.currentRound || 0);
  const targets = getFanartTargetsForPlayer(myPlayer);

  return targets[round] || null;
}

function getOriginalByPlayerId(playerId) {
  const originals = currentOriginals.filter((original) => {
    return original.data.playerId === playerId
      && original.data.isDeleted !== true;
  });

  return getLatestItem(originals);
}

function getPlayerCreditName(player) {
  if (!player) return "匿名";

  const name = player.data.name || "匿名";

  if (player.data.isGuest === true && player.data.guestHandle) {
    return `${name} ${player.data.guestHandle}`;
  }

  return name;
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


function drawSubmissionWatermark(ctx, canvas, name = "匿名", label = "OC") {
  const safeName = String(name || "匿名").trim() || "匿名";
  const safeLabel = String(label || "OC").trim().toUpperCase();

  const padding = Math.max(18, Math.floor(canvas.width * 0.022));
  const labelFontSize = Math.max(24, Math.floor(canvas.width * 0.04));
  const nameFontSize = Math.max(18, Math.floor(canvas.width * 0.028));

  const x = canvas.width - padding;
  const nameY = canvas.height - padding;
  const labelY = nameY - nameFontSize - 8;

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.lineJoin = "round";

  // OC / FA
  ctx.globalAlpha = 0.26;
  ctx.font = `900 ${labelFontSize}px sans-serif`;
  ctx.lineWidth = Math.max(3, Math.floor(labelFontSize * 0.12));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.strokeText(safeLabel, x, labelY);

  ctx.fillStyle =
    safeLabel === "FA"
      ? "rgba(110, 92, 255, 0.95)"
      : "rgba(60, 150, 255, 0.95)";
  ctx.fillText(safeLabel, x, labelY);

  // by 名前
  ctx.globalAlpha = 0.72;
  ctx.font = `bold ${nameFontSize}px sans-serif`;
  ctx.lineWidth = Math.max(2, Math.floor(nameFontSize * 0.12));
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(`by ${safeName}`, x, nameY);

  ctx.fillStyle = "rgba(43, 36, 48, 0.92)";
  ctx.fillText(`by ${safeName}`, x, nameY);

  ctx.restore();
}

function createTimeUpImageData(name, label = "OC") {
  const canvas = document.createElement("canvas");
  canvas.width = GAME_CANVAS_SIZE;
  canvas.height = GAME_CANVAS_SIZE;

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

  drawSubmissionWatermark(ctx, canvas, name, label);

  return canvas.toDataURL("image/jpeg", 0.82);
}

function createSubmittedImageData(sourceCanvas, name, label = "OC") {
  const canvas = document.createElement("canvas");
  canvas.width = GAME_CANVAS_SIZE;
  canvas.height = GAME_CANVAS_SIZE;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

  drawSubmissionWatermark(ctx, canvas, name, label);

  return canvas.toDataURL("image/jpeg", 0.82);
}

async function createMissingOriginalForPlayer(player) {
  if (!player) return null;

  const originalId = getOriginalDocId(player.id);
  const originalRef = doc(db, "ocGameOriginals", originalId);

  const latestSnap = await getDoc(originalRef);

  if (latestSnap.exists() && latestSnap.data().isDeleted !== true) {
    return {
      id: originalId,
      data: latestSnap.data()
    };
  }

  const alreadySubmitted = getSubmittedOriginalByPlayerId(player.id);

  if (alreadySubmitted && alreadySubmitted.data.isDeleted !== true) {
    return alreadySubmitted;
  }

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

  let savedOriginalData = null;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(originalRef);

    if (snap.exists() && snap.data().isDeleted !== true) {
      savedOriginalData = snap.data();
      return;
    }

    transaction.set(originalRef, originalData);
    savedOriginalData = originalData;
  });

  const nowSeconds = Math.floor(Date.now() / 1000);

  const localOriginal = {
    id: originalId,
    data: {
      ...savedOriginalData,
      createdAt: savedOriginalData.createdAt || { seconds: nowSeconds },
      updatedAt: savedOriginalData.updatedAt || { seconds: nowSeconds }
    }
  };

  currentOriginals = currentOriginals.filter((original) => {
    return original.data.playerId !== player.id;
  });

  currentOriginals.push(localOriginal);

  return localOriginal;
}

async function createMissingOriginalsForAllPlayers() {
  await wait(TIME_UP_GRACE_MS);

  const ocPlayers = getOcPlayers();

  for (const player of ocPlayers) {
    await createMissingOriginalForPlayer(player);
  }
}

async function createMissingFanartForPlayer(player) {
  if (!player) return null;

  const targetPlayer = getTargetPlayerForCurrentRound(player);

  if (!targetPlayer) return null;

  const round = Number(currentRoom?.data?.currentRound || 0);
  const fanartId = getFanartDocId(round, player.id, targetPlayer.id);
  const fanartRef = doc(db, "ocGameFanarts", fanartId);

  const latestSnap = await getDoc(fanartRef);

  if (latestSnap.exists() && latestSnap.data().isDeleted !== true) {
    return {
      id: fanartId,
      data: latestSnap.data()
    };
  }

  const alreadySubmitted = getMyFanartForCurrentRound(player, targetPlayer);

  if (alreadySubmitted && alreadySubmitted.data.isDeleted !== true) {
    return alreadySubmitted;
  }

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

  let savedFanartData = null;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(fanartRef);

    if (snap.exists() && snap.data().isDeleted !== true) {
      savedFanartData = snap.data();
      return;
    }

    transaction.set(fanartRef, fanartData);
    savedFanartData = fanartData;
  });

  const nowSeconds = Math.floor(Date.now() / 1000);

  const localFanart = {
    id: fanartId,
    data: {
      ...savedFanartData,
      createdAt: savedFanartData.createdAt || { seconds: nowSeconds },
      updatedAt: savedFanartData.updatedAt || { seconds: nowSeconds }
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
  await wait(TIME_UP_GRACE_MS);

  const activeArtists = currentPlayers.filter((player) => {
    return hasFanartTargetThisRound(player);
  });

  for (const player of activeArtists) {
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
  const maxRoundCount = getMaxFanartRoundCount();

  if (nextRound >= maxRoundCount) {
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

  const ocPlayers = getOcPlayers();

  if (ocPlayers.length < 1) return;
  if (currentPlayers.length < 2) return;

  const allSubmitted = ocPlayers.every((player) => {
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

function isFaOnlyPlayer(player) {
  return player?.data?.playStyle === "fa_only";
}

function isOcPlayer(player) {
  return !isFaOnlyPlayer(player);
}

function getOcPlayers() {
  return currentPlayers.filter((player) => {
    return player.data.isLeft !== true && isOcPlayer(player);
  });
}

function getFanartTargetsForPlayer(player) {
  if (!player) return [];

  const ocPlayers = getOcPlayers();

  return ocPlayers.filter((targetPlayer) => {
    // 普通参加者は自分のOCには描かない
    if (!isFaOnlyPlayer(player) && targetPlayer.id === player.id) {
      return false;
    }

    // 元OCが存在する人だけ対象
    return Boolean(getOriginalByPlayerId(targetPlayer.id));
  });
}

function getMaxFanartRoundCount() {
  if (!currentPlayers.length) return 0;

  const counts = currentPlayers.map((player) => {
    return getFanartTargetsForPlayer(player).length;
  });

  return Math.max(0, ...counts);
}

function hasFanartTargetThisRound(player) {
  const round = Number(currentRoom?.data?.currentRound || 0);
  const targets = getFanartTargetsForPlayer(player);

  return Boolean(targets[round]);
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

  const activeArtists = currentPlayers.filter((player) => {
    return hasFanartTargetThisRound(player);
  });

  const maxRoundCount = getMaxFanartRoundCount();

  if (maxRoundCount <= 0) return;

  const allSubmitted =
    activeArtists.length > 0
      ? activeArtists.every((player) => {
          return hasPlayerSubmittedFanartThisRound(player);
        })
      : true;

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
  const handleInput = document.getElementById("guestHandle");
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

  const name = nameInput?.value.trim() || getAutoGuestName();
  const guestHandle = normalizeGuestHandle(handleInput?.value || "");
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
      guestHandle,
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
      guestHandle: "",
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
  status: "starting",
  startCount: 3,
  startingAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});

await wait(1000);

await updateDoc(doc(db, "ocGameRooms", roomId), {
  startCount: 2,
  updatedAt: serverTimestamp()
});

await wait(1000);

await updateDoc(doc(db, "ocGameRooms", roomId), {
  startCount: 1,
  updatedAt: serverTimestamp()
});

await wait(1000);

await updateDoc(doc(db, "ocGameRooms", roomId), {
  status: "drawing_oc",
  startCount: 0,
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
          const guestHandle = data.guestHandle || "";

          return `
            <article class="player-card">
              <div>
                <strong>${escapeHtml(data.name || "匿名")}</strong>

                ${
                  guestHandle
                    ? `
                      <p class="mini-info game-player-handle">
                        ${escapeHtml(guestHandle)}
                      </p>
                    `
                    : ""
                }

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

            <div class="guest-join-fields">
              <label>
                参加名
                <input
                  id="guestName"
                  type="text"
                  maxlength="20"
                  placeholder="例：匿名にゃんこ"
                  autocomplete="off"
                >
              </label>

              <label>
                ID・SNSアカウント（任意）
                <input
                  id="guestHandle"
                  type="text"
                  maxlength="40"
                  placeholder="@example / X ID / Discord名など"
                  autocomplete="off"
                >
              </label>

              <p class="mini-info">
                入力すると参加者一覧に表示されます。誰かわかるためのメモなので、空欄でも参加できます。
              </p>
            </div>

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
    <div class="game-draw-toolbar" aria-label="描画ツール">
      <div class="game-draw-tools">
        <label class="game-color-tool" title="色" aria-label="色">
          <span>色</span>
          <input id="gamePenColor" type="color" value="${escapeHtml(gamePenColorValue)}">
        </label>

        <label class="game-size-tool" title="太さ" aria-label="太さ">
          <span>太さ</span>
          <input id="gamePenSize" type="range" min="1" max="28" value="${gamePenSizeValue}">
          <strong id="gamePenSizeText">${gamePenSizeValue}</strong>
        </label>
      </div>

      <div class="game-tool-actions">
        <button
          id="penToolBtn"
          type="button"
          class="${currentTool === "pen" ? "is-active" : ""}"
          title="ペン"
          aria-label="ペン"
        >
          ✏️
        </button>

        <button
          id="eraserToolBtn"
          type="button"
          class="${currentTool === "eraser" ? "is-active" : ""}"
          title="消しゴム"
          aria-label="消しゴム"
        >
          🧽
        </button>

        <button
          id="fillToolBtn"
          type="button"
          class="${currentTool === "fill" ? "is-active" : ""}"
          title="塗りつぶし"
          aria-label="塗りつぶし"
        >
          🪣
        </button>

        <button
          id="undoLayerBtn"
          type="button"
          title="1つ戻る"
          aria-label="1つ戻る"
        >
          ↩️
        </button>
      </div>

      <div class="game-layer-tools">
        <button
          id="layerBtn1"
          type="button"
          class="layer-btn layer-top ${activeLayerIndex === 1 ? "is-active" : ""}"
          title="上レイヤー"
          aria-label="上レイヤー"
        >
          上
        </button>

        <button
          id="layerBtn0"
          type="button"
          class="layer-btn layer-bottom ${activeLayerIndex === 0 ? "is-active" : ""}"
          title="下レイヤー"
          aria-label="下レイヤー"
        >
          下
        </button>
      </div>

      <div class="game-layer-actions">
        <button
          id="toggleLayerBtn"
          type="button"
          title="表示/非表示"
          aria-label="表示/非表示"
        >
          👁
        </button>

        <button
          id="clearLayerBtn"
          type="button"
          class="danger-btn"
          title="消す"
          aria-label="消す"
        >
          🗑
        </button>
      </div>

<div class="game-tool-setting-button-area">
  <button
    id="toolSettingsBtn"
    type="button"
    class="${toolSettingsOpen ? "is-active" : ""}"
    title="設定"
    aria-label="設定"
  >
    ⚙️
  </button>
</div>
</div>

<div
  id="toolSettingsPanel"
  class="game-tool-settings-panel ${toolSettingsOpen ? "is-open" : ""}"
>

     
      <div class="game-tool-settings-head">
        <strong>描き心地設定</strong>
        <small>必要な時だけ調整できます</small>
      </div>

      <label class="game-pressure-toggle">
        <input
          id="gamePressureToggle"
          type="checkbox"
          ${pressureEnabled ? "checked" : ""}
        >
        <span>
          筆圧を使う
          <small>Apple Pencilなど対応ペンのみ</small>
        </span>
      </label>

      <label class="game-stabilizer-toggle">
        <input
          id="gameStabilizerToggle"
          type="checkbox"
          ${stabilizerEnabled ? "checked" : ""}
        >
        <span>
          手ぶれ補正
          <small>線をなめらかにします</small>
        </span>
      </label>

      <label class="game-stabilizer-strength">
        <span>手ぶれ補正の強さ</span>
        <input
          id="gameStabilizerStrength"
          type="range"
          min="0"
          max="80"
          value="${Math.round(stabilizerStrength * 100)}"
        >
      </label>
    </div>

    <div class="game-layer-panel">
      <div class="game-layer-head">
        <p id="layerStatusText" class="mini-info">
          現在：レイヤー2
        </p>
      </div>
    </div>
  `;
}

function renderCanvasGuide(type = "oc") {
  const drawText = type === "fa"
    ? "下のキャンバスにファンアートを描いてください。"
    : "下のキャンバスに自分のOCを描いてください。";

  const label = type === "fa"
    ? "FAを描く場所"
    : "OCを描く場所";

  return `
    <div class="game-canvas-guide">
      <div class="game-canvas-guide-icon">↓</div>

      <div>
        <strong>${label}はこの下です</strong>
        <p>
          ${drawText}
          スマホではこのまま少し下へスクロールすると、大きな白い描画エリアがあります。
        </p>
      </div>
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
      <section class="game-result-screen">
        <div class="game-result-hero">
          <p class="mini-label">Result</p>
          <h2>結果発表</h2>
          <p>参加者データがありません。</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="game-result-screen">
      <div class="game-result-hero">
        <p class="mini-label">Result</p>
        <h2>結果発表！</h2>
        <p>
          全ラウンドが終了しました。
          キャラごとに、みんなが描いたファンアートを表示しています。
        </p>
      </div>

      <div class="game-result-list-new">
        ${currentPlayers
          .map((player) => {
            const original = getOriginalByPlayerId(player.id);
            const fanarts = getFanartsByTargetPlayerId(player.id);

            return `
              <article class="game-result-character-new">
                <header class="game-result-character-head">
                  <div>
                    <p class="mini-label">Original Character</p>
                    <h3>${escapeHtml(player.data.name || "匿名")}さんのOC</h3>
                  </div>

                  <span>${fanarts.length} FA</span>
                </header>

                <div class="game-result-original-new">
                  ${
                    original
                      ? `
                        <img
                          src="${original.data.imageData}"
                          alt="${escapeHtml(player.data.name || "匿名")}さんのOC"
                        >
                      `
                      : `
                        <p class="mini-info">元OCが見つかりませんでした。</p>
                      `
                  }
                </div>

                <div class="game-result-fa-area">
                  <h4>描かれたFA</h4>

                  ${
                    fanarts.length
                      ? `
                        <div class="game-result-fanarts-new">
                          ${fanarts
                            .map((fanart) => {
                              return `
                                <article class="game-result-fanart-card-new">
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
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

async function renderGameStageArea() {
  if (!currentRoom) {
    return "";
  }

  if (currentRoom.data.status === "starting") {
  const startCount = Number(currentRoom.data.startCount || 3);

  return `
    <section class="game-starting-screen">
      <p class="mini-label">Game Start</p>
      <h2>始まるよー！</h2>
      <p>まずは自分のOCを描く時間です。準備してね。</p>
      <div class="game-starting-count">
        ${startCount > 0 ? startCount : "START!"}
      </div>
    </section>
  `;
}

  if (currentRoom.data.status === "waiting") {
    return `
      <section class="game-waiting-hero">
        <p class="mini-label">Lobby</p>
        <h2>参加者を待っています</h2>
        <p>
          参加者が集まったら、オーナーがゲームを開始できます。
          まずは自分のOCを描いて、そのあと他の人のOCへファンアートを描きます。
        </p>

        <div class="game-rule-grid">
          <div>
            <strong>1</strong>
            <span>自分のOCを描く</span>
          </div>
          <div>
            <strong>2</strong>
            <span>他の人のOCを見る</span>
          </div>
          <div>
            <strong>3</strong>
            <span>FAを描いて提出</span>
          </div>
          <div>
            <strong>4</strong>
            <span>最後に結果発表</span>
          </div>
        </div>
      </section>
    `;
  }

  if (currentRoom.data.status === "reveal") {
    return renderRevealArea();
  }

  if (currentRoom.data.status === "drawing_fa") {
    const myPlayer = getMyPlayer();

if (!myPlayer) {
  return `
    <section class="panel-soft">
      <p>ゲームは開始されています。参加者のみ描画できます。</p>
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
    <section class="game-submitted-screen">
      <div class="game-submitted-hero">
        <p class="mini-label">Submitted</p>
        <h2>FA提出完了！</h2>
        <p>
          ${escapeHtml(targetPlayer.data.name || "匿名")}さんのOCへのFAを提出しました。
          ほかの人の提出を待っています。
        </p>
      </div>

      <div class="game-submitted-preview">
        <div class="game-canvas-label">
          <span>提出したFA</span>
          <small>${escapeHtml(targetPlayer.data.name || "匿名")}さん宛て</small>
        </div>

        <img src="${submittedFanart.data.imageData}" alt="提出したFA">
      </div>

      ${
        canCancelSubmitNow()
          ? `
            <div class="game-submit-bar">
              <p>残り30秒までは提出を取り消して描き直せます。</p>

              <button
                id="cancelFanartBtn"
                class="btn ghost"
                type="button"
                data-fanart-id="${submittedFanart.id}"
              >
                提出を取り消す
              </button>
            </div>
          `
          : `
            <div class="game-draw-note">
              残り30秒を切ったため、提出は取り消せません。
            </div>
          `
      }
    </section>
  `;
}

    return `
  <section class="game-fa-screen">
    <header class="game-draw-header">
      <div>
        <p class="mini-label">Fan Art Turn</p>
        <h2>${escapeHtml(targetPlayer.data.name || "匿名")}さんのOCを描く</h2>
        <p>資料OCを見ながら、ファンアートを描いてください。</p>
      </div>

      <div class="game-draw-timer">
        <span>残り時間</span>
        <strong id="fanartTimerText">残り時間：--:--</strong>

        <div class="game-timer-meter">
          <span id="fanartTimerBar"></span>
        </div>
      </div>
    </header>

    <div class="game-fa-focus-card">
      <div class="game-fa-reference-inline">
        <div class="game-canvas-label">
          <span>資料OC</span>
          <small>${escapeHtml(targetPlayer.data.name || "匿名")}さん</small>
        </div>

        <img
          src="${targetOriginal.data.imageData}"
          alt="${escapeHtml(targetPlayer.data.name || "OC")}のOC"
        >
      </div>

      <div class="game-canvas-card">
        <div class="game-canvas-label">
          <span>FAを描く場所</span>
          <small>資料を見ながら描いてください</small>
        </div>

        <canvas
          id="gameCanvas"
          class="game-canvas"
          width="768"
          height="768"
        ></canvas>
      </div>
    </div>

    <div class="game-tool-box">
  ${renderLayerTools()}
</div>

    <div class="game-submit-bar">
      <p>
        Round ${Number(currentRoom.data.currentRound || 0) + 1}
        /
        ${Math.max(1, currentPlayers.length - 1)}
      </p>

      <button id="submitFanartBtn" class="btn primary" type="button">
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

  if (isFaOnlyPlayer(myPlayer)) {
  return `
    <section class="panel-soft">
      <p class="mini-label">FA Only</p>
      <h2>OCターン待機中</h2>
      <p>
        あなたはFAのみ参加です。
        ほかの参加者がOCを提出するまで待ってください。
      </p>
    </section>
  `;
}

  const submitted = await getMyOriginal(myPlayer.id);

if (submitted) {
  return `
    <section class="game-submitted-screen">
      <div class="game-submitted-hero">
        <p class="mini-label">Submitted</p>
        <h2>OC提出完了！</h2>
        <p>
          あなたのOCは提出済みです。
          全員の提出が終わるまで待ってください。
        </p>
      </div>

      <div class="game-submitted-preview">
        <div class="game-canvas-label">
          <span>提出したOC</span>
          <small>みんながこのOCを見てFAを描きます</small>
        </div>

        <img src="${submitted.data.imageData}" alt="提出したOC">
      </div>

      ${
        canCancelSubmitNow()
          ? `
            <div class="game-submit-bar">
              <p>残り30秒までは提出を取り消して描き直せます。</p>

              <button
                id="cancelOriginalBtn"
                class="btn ghost"
                type="button"
                data-original-id="${submitted.id}"
              >
                提出を取り消す
              </button>
            </div>
          `
          : `
            <div class="game-draw-note">
              残り30秒を切ったため、提出は取り消せません。
            </div>
          `
      }
    </section>
  `;
}

  return `
    <section class="game-draw-screen">
      <header class="game-draw-header">
        <div>
          <p class="mini-label">Draw Your OC</p>
          <h2>自分のOCを描く</h2>
          <p>
            まずは自分のOCを描いて提出してください。
            この絵が、ほかの参加者がファンアートを描く元になります。
          </p>
        </div>

        <div class="game-draw-timer">
  <span>残り時間</span>
  <strong id="originalTimerText">残り時間：--:--</strong>

  <div class="game-timer-meter">
    <span id="originalTimerBar"></span>
  </div>
</div>
      </header>

      <div class="game-draw-note">
        描いた内容はこの端末に自動保存されます。
        時間切れになった場合も、保存されている絵があればそれを提出します。
      </div>

      <div class="game-tool-box">
  ${renderLayerTools()}
</div>

      <div class="game-canvas-card">
        <div class="game-canvas-label">
          <span>OCを描く場所</span>
          <small>指やペンで白いエリアに描けます</small>
        </div>

        <canvas
          id="gameCanvas"
          class="game-canvas"
          width="768"
          height="768"
        ></canvas>
      </div>

      <div class="game-submit-bar">
        <p>描けたら提出。提出後も残り30秒までは取り消せます。</p>
        <button id="submitOriginalBtn" class="btn primary" type="button">
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
  const statusLabel = getStatusLabel(room.status);
  const turnMinutes = Math.floor(Number(room.turnSeconds || 120) / 60);

  const isDrawingStatus =
  room.status === "drawing_oc" || room.status === "drawing_fa";

  gameRoomContent.innerHTML = `
  <div class="game-shell ${isDrawingStatus ? "is-drawing-mode" : ""}">
    <header class="game-topbar">
      <div>
        <p class="game-topbar-status">OC Drawing Game / ${escapeHtml(statusLabel)}</p>
        <h1 class="game-topbar-title">${escapeHtml(room.title || "OC描き合いゲーム")}</h1>
      </div>

      ${
        !isDrawingStatus
          ? `
            <div class="game-topbar-meta">
              <span>参加者 ${currentPlayers.length} / ${room.maxPlayers}人</span>
              <span>1ターン ${turnMinutes}分</span>
            </div>
          `
          : ""
      }
    </header>

    <div class="game-main-layout">
      <main class="game-stage-panel">
        ${
          !isDrawingStatus
            ? `
              <div class="game-room-status">
  <div>
    <strong>OC提出</strong>
    <span>${getOriginalSubmittedCount()} / ${getOcPlayers().length}人</span>
  </div>

                ${
                  room.status === "drawing_fa"
                    ? `
                      <div>
                        <strong>現在のFA提出</strong>
                        <span>${getFanartSubmittedCountForCurrentRound()} / ${currentPlayers.length}人</span>
                      </div>
                    `
                    : ""
                }
              </div>
            `
            : ""
        }

        ${await renderGameStageArea()}
      </main>

      ${
        !isDrawingStatus
          ? `
            <aside class="game-side-panel">
              <section class="game-side-section">
                <p class="mini-label">Players</p>
                <h2>参加者</h2>
                ${renderPlayers()}
              </section>

              <section class="game-side-section">
                ${renderJoinArea()}
              </section>

              <section class="game-side-section">
                ${renderOwnerArea()}
              </section>

              <section class="game-side-section">
                <p class="mini-label">Share</p>
                <p class="small-text">部屋URLを共有すると、ゲストも参加できます。</p>
                <button type="button" class="btn secondary" id="copyRoomUrlBtn">
                  部屋URLをコピー
                </button>
                <a class="btn ghost" href="/games/">ゲームトップへ戻る</a>
              </section>

              <p id="roomMessage" class="message"></p>
            </aside>
          `
          : `
  <div class="game-floating-owner-tools">
    ${
      isOwner()
        ? `
          <button
            id="forceAdvanceBtn"
            class="danger-btn"
            type="button"
          >
            未提出者を時間切れ扱いで進める
          </button>
        `
        : ""
    }

    <p id="roomMessage" class="message game-floating-message"></p>
  </div>
`
      }
    </div>
  </div>
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
















function getGamePressure(e) {
  if (!pressureEnabled) return 1;

  if (e.pointerType && e.pointerType !== "pen") {
    return 0;
  }

  const rawPressure =
    typeof e.pressure === "number" && e.pressure > 0
      ? e.pressure
      : 0.5;

  const correctedPressure = Math.max(
  MIN_PRESSURE,
  Math.min(MAX_PRESSURE, rawPressure)
);

  gameSmoothedPressure =
    gameSmoothedPressure * PRESSURE_SMOOTHING
    + correctedPressure * (1 - PRESSURE_SMOOTHING);

  return gameSmoothedPressure;
}

function shouldIgnoreGameCanvasInput(e) {
  if (!pressureEnabled) return false;
  if (!e.pointerType) return false;

  return e.pointerType !== "pen";
}

function getGamePoint(e) {
  const rect = gameCanvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;

  return {
    x: ((touch.clientX - rect.left) / rect.width) * gameCanvas.width,
    y: ((touch.clientY - rect.top) / rect.height) * gameCanvas.height,
    pressure: getGamePressure(e)
  };
}

function createLayerCanvas() {
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = gameCanvas.width;
  layerCanvas.height = gameCanvas.height;

  const layerCtx = layerCanvas.getContext("2d", {
    willReadFrequently: true
  });

  layerCtx.lineCap = "round";
  layerCtx.lineJoin = "round";

  return {
    canvas: layerCanvas,
    ctx: layerCtx
  };
}

function initGameLayers() {
  layerCanvases = [];
  layerContexts = [];
  activeLayerIndex = 1;
  layerVisible = [true, true];
  layerHistory = [[], []];
  gameLastPressure = 0.5;
  gameSmoothedPressure = 0.5;

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

  gameCtx.save();

  gameCtx.globalCompositeOperation = "source-over";
  gameCtx.globalAlpha = 1;
  gameCtx.fillStyle = "#fffdf8";
  gameCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  layerCanvases.forEach((layerCanvas, index) => {
    if (!layerVisible[index]) return;

    gameCtx.drawImage(layerCanvas, 0, 0);
  });

  gameCtx.restore();
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
    layerBtn0.setAttribute(
      "aria-pressed",
      activeLayerIndex === 0 ? "true" : "false"
    );
  }

  if (layerBtn1) {
    layerBtn1.classList.toggle("is-active", activeLayerIndex === 1);
    layerBtn1.classList.toggle("is-hidden-layer", layerVisible[1] === false);
    layerBtn1.setAttribute(
      "aria-pressed",
      activeLayerIndex === 1 ? "true" : "false"
    );
  }

  if (layerStatusText) {
    const visibleText = layerVisible[activeLayerIndex] ? "表示中" : "非表示";
    layerStatusText.textContent =
      `現在：${layerNames[activeLayerIndex]}（${visibleText}）`;
  }
}

function canSwitchLayerNow() {
  return !gameDrawing;
}

function setupLayerButtons() {
  
  const layerBtn0 = document.getElementById("layerBtn0");
const layerBtn1 = document.getElementById("layerBtn1");
const toggleLayerBtn = document.getElementById("toggleLayerBtn");
const clearLayerBtn = document.getElementById("clearLayerBtn");
const gamePenColor = document.getElementById("gamePenColor");
const gamePenSize = document.getElementById("gamePenSize");
const gamePenSizeText = document.getElementById("gamePenSizeText");
  const penToolBtn = document.getElementById("penToolBtn");
  const eraserToolBtn = document.getElementById("eraserToolBtn");
  const fillToolBtn = document.getElementById("fillToolBtn");
  const undoLayerBtn = document.getElementById("undoLayerBtn");
  
  const gamePressureToggle = document.getElementById("gamePressureToggle");
const gameStabilizerToggle = document.getElementById("gameStabilizerToggle");
const gameStabilizerStrength = document.getElementById("gameStabilizerStrength");
const toolSettingsBtn = document.getElementById("toolSettingsBtn");
const toolSettingsPanel = document.getElementById("toolSettingsPanel");

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

    if (toolSettingsBtn && toolSettingsPanel) {
  toolSettingsPanel.hidden = !toolSettingsOpen;

  toolSettingsBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    toolSettingsOpen = !toolSettingsOpen;

    toolSettingsBtn.classList.toggle("is-active", toolSettingsOpen);
    toolSettingsPanel.classList.toggle("is-open", toolSettingsOpen);
    toolSettingsPanel.hidden = !toolSettingsOpen;
  });
}

  if (penToolBtn) {
    penToolBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      currentTool = "pen";
      updateToolButtons();
    });
  }

  if (eraserToolBtn) {
    eraserToolBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      currentTool = "eraser";
      updateToolButtons();
    });
  }

  if (fillToolBtn) {
    fillToolBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      currentTool = "fill";
      updateToolButtons();
    });
  }

  if (undoLayerBtn) {
    undoLayerBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      undoActiveLayer();
    });
  }

  if (gamePressureToggle) {
    gamePressureToggle.checked = pressureEnabled;

    gamePressureToggle.addEventListener("change", () => {
      pressureEnabled = gamePressureToggle.checked;
      gameLastPressure = 0.5;
      gameSmoothedPressure = 0.5;
    });
  }

  if (gameStabilizerToggle) {
  gameStabilizerToggle.checked = stabilizerEnabled;

  gameStabilizerToggle.addEventListener("change", () => {
    stabilizerEnabled = gameStabilizerToggle.checked;
  });
}

if (gameStabilizerStrength) {
  gameStabilizerStrength.value = String(Math.round(stabilizerStrength * 100));

  gameStabilizerStrength.addEventListener("input", () => {
    stabilizerStrength = Number(gameStabilizerStrength.value || 0) / 100;
  });
}

  if (layerBtn0) {
    layerBtn0.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!canSwitchLayerNow()) return;

      activeLayerIndex = 0;
      updateLayerUi();
    });
  }

  if (layerBtn1) {
    layerBtn1.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!canSwitchLayerNow()) return;

      activeLayerIndex = 1;
      updateLayerUi();
    });
  }

  if (toggleLayerBtn) {
    toggleLayerBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!canSwitchLayerNow()) return;

      layerVisible[activeLayerIndex] = !layerVisible[activeLayerIndex];

      redrawGameCanvas();
      gameHasDrawn = true;
      saveCurrentGameDraft();
      updateLayerUi();
    });
  }

  if (clearLayerBtn) {
    clearLayerBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!canSwitchLayerNow()) return;
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

  if (gamePenColor) {
  gamePenColor.value = gamePenColorValue;

  gamePenColor.addEventListener("input", () => {
    gamePenColorValue = gamePenColor.value;
  });
}

if (gamePenSize && gamePenSizeText) {
  gamePenSize.value = String(gamePenSizeValue);
  gamePenSizeText.textContent = String(gamePenSizeValue);

  gamePenSize.addEventListener("input", () => {
    gamePenSizeValue = Number(gamePenSize.value || 6);
    gamePenSizeText.textContent = String(gamePenSizeValue);
  });
}

  updateToolButtons();
  updateLayerUi();
}

function setupGameCanvasProtection() {
  if (window.ocfaGameCanvasProtectionReady) return;

  window.ocfaGameCanvasProtectionReady = true;

  document.addEventListener("selectstart", (event) => {
    const target = event.target;

    if (
      target.closest(
        "#gameCanvas, .game-canvas, .game-canvas-wrap, .game-draw-panel, .game-fa-panel, .game-layer-panel, .game-tool-actions, .game-draw-toolbar"
      )
    ) {
      event.preventDefault();
    }
  });

  document.addEventListener("contextmenu", (event) => {
    const target = event.target;

    if (
      target.closest(
        "#gameCanvas, .game-canvas, .game-canvas-wrap, .game-draw-panel, .game-fa-panel, .game-layer-panel, .game-tool-actions, .game-draw-toolbar"
      )
    ) {
      event.preventDefault();
    }
  });

  document.addEventListener("dragstart", (event) => {
    const target = event.target;

    if (
      target.closest(
        "#gameCanvas, .game-canvas, .game-canvas-wrap, .game-draw-panel, .game-fa-panel"
      )
    ) {
      event.preventDefault();
    }
  });
}

function initGameCanvas() {
  gameCanvas = document.getElementById("gameCanvas");

  if (!gameCanvas) return;

  gameCtx = gameCanvas.getContext("2d", {
    willReadFrequently: true
  });

  gameDrawing = false;
  gameHasDrawn = false;
  gameActivePointerId = null;
  lastCanvasInputAt = 0;
  gameLastPressure = 0.5;
  gameSmoothedPressure = 0.5;

  gameCanvas.width = GAME_CANVAS_SIZE;
  gameCanvas.height = GAME_CANVAS_SIZE;

  gameCanvas.setAttribute("touch-action", "none");
  gameCanvas.style.touchAction = "none";
  gameCanvas.style.webkitUserSelect = "none";
  gameCanvas.style.userSelect = "none";
  gameCanvas.style.webkitTouchCallout = "none";
  gameCanvas.style.webkitTapHighlightColor = "transparent";

  initGameLayers();

  if (window.ocfaGameCanvasAbortController) {
    window.ocfaGameCanvasAbortController.abort();
  }

  window.ocfaGameCanvasAbortController = new AbortController();

  const signal = window.ocfaGameCanvasAbortController.signal;

  if (window.PointerEvent) {
    gameCanvas.addEventListener(
      "pointerdown",
      startGameDraw,
      { passive: false, signal }
    );

    gameCanvas.addEventListener(
      "pointermove",
      drawGameCanvas,
      { passive: false, signal }
    );

    window.addEventListener(
      "pointerup",
      stopGameDraw,
      { passive: false, signal }
    );

    window.addEventListener(
      "pointercancel",
      stopGameDraw,
      { passive: false, signal }
    );
  } else {
    gameCanvas.addEventListener(
      "mousedown",
      startGameDraw,
      { signal }
    );

    gameCanvas.addEventListener(
      "mousemove",
      drawGameCanvas,
      { signal }
    );

    window.addEventListener(
      "mouseup",
      stopGameDraw,
      { signal }
    );

    gameCanvas.addEventListener(
      "touchstart",
      startGameDraw,
      { passive: false, signal }
    );

    gameCanvas.addEventListener(
      "touchmove",
      drawGameCanvas,
      { passive: false, signal }
    );

    window.addEventListener(
      "touchend",
      stopGameDraw,
      { passive: false, signal }
    );

    window.addEventListener(
      "touchcancel",
      stopGameDraw,
      { passive: false, signal }
    );
  }

  setupLayerButtons();
  setupGameCanvasProtection();
}

function startGameDraw(e) {
  e.preventDefault();
  e.stopPropagation();

  lastCanvasInputAt = Date.now();

  if (e.pointerId !== undefined) {
    gameActivePointerId = e.pointerId;
  }

  if (shouldIgnoreGameCanvasInput(e)) {
    gameDrawing = false;

    const roomMessage = document.getElementById("roomMessage");

    if (roomMessage) {
      roomMessage.textContent = "筆圧ON中は、ペン入力のみ描画できます。指で描く場合は筆圧OFFにしてください。";
    }

    return;
  }

  if (!layerVisible[activeLayerIndex]) {
    const roomMessage = document.getElementById("roomMessage");

    if (roomMessage) {
      roomMessage.textContent = "非表示中のレイヤーには描けません。表示に戻すか、別レイヤーを選んでください。";
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
  gameLastPressure = point.pressure;
  gameSmoothedPressure = point.pressure;

  if (gameCanvas.setPointerCapture && e.pointerId !== undefined) {
    try {
      gameCanvas.setPointerCapture(e.pointerId);
    } catch (error) {
      console.error(error);
    }
  }
}

function drawGameCanvas(e) {
  if (!gameDrawing) return;

  e.preventDefault();
  e.stopPropagation();

  lastCanvasInputAt = Date.now();

  if (
    gameActivePointerId !== null
    && e.pointerId !== undefined
    && e.pointerId !== gameActivePointerId
  ) {
    return;
  }

  if (shouldIgnoreGameCanvasInput(e)) {
    gameDrawing = false;
    return;
  }

  const point = getGamePoint(e);
  const targetCtx = getActiveLayerCtx();

  const drawPoint = stabilizerEnabled
  ? {
      ...point,
      x: gameLastX + (point.x - gameLastX) * (1 - stabilizerStrength),
      y: gameLastY + (point.y - gameLastY) * (1 - stabilizerStrength)
    }
  : point;

  const gamePenColor = document.getElementById("gamePenColor");
  const gamePenSize = document.getElementById("gamePenSize");

  if (!targetCtx) return;

  const baseSize = Number(gamePenSize?.value || gamePenSizeValue || 6);
  const pressure = Math.max(MIN_PRESSURE, Math.min(MAX_PRESSURE, point.pressure));

  if (pressure <= 0) {
    return;
  }

  targetCtx.save();

  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.lineWidth = Math.max(1, baseSize * pressure);

  if (currentTool === "eraser") {
    targetCtx.globalCompositeOperation = "destination-out";
    targetCtx.strokeStyle = "rgba(0, 0, 0, 1)";
  } else {
    targetCtx.globalCompositeOperation = "source-over";
    targetCtx.strokeStyle = gamePenColor?.value || gamePenColorValue || "#2b2430";
  }

  targetCtx.beginPath();
  targetCtx.moveTo(gameLastX, gameLastY);
  targetCtx.lineTo(drawPoint.x, drawPoint.y);
  targetCtx.stroke();

  targetCtx.restore();

  gameLastX = drawPoint.x;
gameLastY = drawPoint.y;
  gameLastPressure = pressure;
  gameHasDrawn = true;

  redrawGameCanvas();
  scheduleGameDraftSave();
}

function stopGameDraw(e) {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }

  lastCanvasInputAt = Date.now();

  if (!gameDrawing) {
    gameActivePointerId = null;
    return;
  }

  gameDrawing = false;
  gameActivePointerId = null;

  redrawGameCanvas();
  saveCurrentGameDraft();

  if (gameCanvas?.releasePointerCapture && e?.pointerId !== undefined) {
    try {
      gameCanvas.releasePointerCapture(e.pointerId);
    } catch (error) {
      console.error(error);
    }
  }
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

function scheduleGameDraftSave() {
  clearTimeout(window.ocfaGameDraftSaveTimer);

  window.ocfaGameDraftSaveTimer = setTimeout(() => {
    saveCurrentGameDraft();
  }, 220);
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
      layerCanvases.forEach((layerCanvas) => {
        const ctx = layerCanvas.getContext("2d", {
          willReadFrequently: true
        });

        ctx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
      });

      activeLayerIndex = 0;
      layerVisible = [true, true];

      const targetCtx = layerContexts[0];

      if (!targetCtx) return;

      targetCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
      targetCtx.drawImage(image, 0, 0, gameCanvas.width, gameCanvas.height);

      gameHasDrawn = true;
      redrawGameCanvas();
      updateLayerUi();
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
    const ctx = layerCanvas.getContext("2d", {
      willReadFrequently: true
    });

    ctx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  });

  const targetCtx = layerContexts[0];

  if (!targetCtx) return;

  activeLayerIndex = 0;
  layerVisible = [true, true];

  targetCtx.save();

  targetCtx.fillStyle = "#fffdf8";
  targetCtx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  targetCtx.fillStyle = "#2b2430";
  targetCtx.textAlign = "center";
  targetCtx.textBaseline = "middle";

  targetCtx.font = "bold 46px sans-serif";
  targetCtx.fillText("時間切れ", gameCanvas.width / 2, gameCanvas.height / 2 - 28);

  targetCtx.font = "bold 24px sans-serif";
  targetCtx.fillText(
    `${name || "匿名"} の${label}`,
    gameCanvas.width / 2,
    gameCanvas.height / 2 + 28
  );

  targetCtx.restore();

  gameHasDrawn = true;

  redrawGameCanvas();
  updateLayerUi();
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
      drawTimeUpCard(getPlayerCreditName(myPlayer), "OC");
    } else {
      redrawGameCanvas();
    }

    const imageData = createSubmittedImageData(
  gameCanvas,
  getPlayerCreditName(myPlayer),
  "OC"
);

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
    clearGameDraft("oc");

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
      drawTimeUpCard(getPlayerCreditName(myPlayer), "FA");
    } else {
      redrawGameCanvas();
    }

    const imageData = createSubmittedImageData(
  gameCanvas,
  getPlayerCreditName(myPlayer),
  "FA"
);

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
    clearGameDraft("fa");

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
  const cleanHex = String(hex || "#2b2430").replace("#", "");

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

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  if (!currentRoom) return;

  try {
    const latestRoom = await getRoom();

    if (latestRoom) {
      currentRoom = latestRoom;
      await renderRoom();
    }
  } catch (error) {
    console.error(error);
  }
});

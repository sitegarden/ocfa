import { auth, db } from "/firebase.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const battleRoomCreateForm = document.getElementById("battleRoomCreateForm");
const battleRoomTitle = document.getElementById("battleRoomTitle");
const drawSeconds = document.getElementById("drawSeconds");
const voteSeconds = document.getElementById("voteSeconds");
const battleMaxPlayers = document.getElementById("battleMaxPlayers");
const battleMessage = document.getElementById("battleMessage");
const createBattleRoomBtn = document.getElementById("createBattleRoomBtn");

let currentUser = null;

function setMessage(text) {
  if (!battleMessage) return;
  battleMessage.textContent = text;
}

function setButtonDisabled(disabled) {
  if (!createBattleRoomBtn) return;
  createBattleRoomBtn.disabled = disabled;
}

async function getOwnerName(user) {
  if (!user) return "ホスト";

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

  return user.displayName || user.email?.split("@")[0] || "ホスト";
}

function getDefaultRoomTitle() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} ${hour}:${minute} お題バトル`;
}

function getNumberValue(element, fallback) {
  if (!element) return fallback;

  const value = Number(element.value);

  if (Number.isNaN(value)) {
    return fallback;
  }

  return value;
}

function validateRoomSettings(selectedDrawSeconds, selectedVoteSeconds, selectedMaxPlayers) {
  if (selectedDrawSeconds < 300 || selectedDrawSeconds > 1200) {
    return "お絵描き時間が正しくありません。";
  }

  if (selectedVoteSeconds < 120 || selectedVoteSeconds > 300) {
    return "投票時間が正しくありません。";
  }

  if (selectedMaxPlayers < 2 || selectedMaxPlayers > 10) {
    return "最大人数が正しくありません。";
  }

  return "";
}

function setFormState() {
  if (!createBattleRoomBtn) return;

  if (!currentUser) {
    setButtonDisabled(true);
    setMessage("部屋を作るにはログインしてください。");
    return;
  }

  setButtonDisabled(false);
  setMessage("部屋を作成できます。");
}

async function createBattleRoom() {
  if (!currentUser) {
    setMessage("部屋を作るにはログインしてください。");
    return;
  }

  const title = battleRoomTitle?.value.trim() || getDefaultRoomTitle();

  const selectedDrawSeconds = getNumberValue(drawSeconds, 600);
  const selectedVoteSeconds = getNumberValue(voteSeconds, 180);
  const selectedMaxPlayers = getNumberValue(battleMaxPlayers, 6);

  const errorMessage = validateRoomSettings(
    selectedDrawSeconds,
    selectedVoteSeconds,
    selectedMaxPlayers
  );

  if (errorMessage) {
    setMessage(errorMessage);
    return;
  }

  try {
    setButtonDisabled(true);
    setMessage("部屋を作成しています...");

    const ownerName = await getOwnerName(currentUser);

    const roomRef = await addDoc(collection(db, "odaiBattleRooms"), {
      ownerId: currentUser.uid,
      ownerName,
      title,
      status: "waiting",

      drawSeconds: selectedDrawSeconds,
      voteSeconds: selectedVoteSeconds,
      maxPlayers: selectedMaxPlayers,

      selectedThemeId: "",
      selectedThemeText: "",

      startedAt: null,
      themeStartedAt: null,
      drawingStartedAt: null,
      votingStartedAt: null,
      resultStartedAt: null,

      isDeleted: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "odaiBattlePlayers"), {
      roomId: roomRef.id,

      userId: currentUser.uid,
      guestId: "",

      name: ownerName,

      isGuest: false,
      isOwner: true,
      order: 0,
      isLeft: false,

      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    location.href = `/battle/room/?id=${encodeURIComponent(roomRef.id)}`;
  } catch (error) {
    console.error(error);
    setButtonDisabled(false);
    setMessage("部屋の作成に失敗しました。少し時間を置いてもう一度お試しください。");
  }
}

if (battleRoomCreateForm) {
  battleRoomCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createBattleRoom();
  });
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  setFormState();
});

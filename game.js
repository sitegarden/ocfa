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

const roomCreateForm = document.getElementById("roomCreateForm");
const roomTitle = document.getElementById("roomTitle");
const turnSeconds = document.getElementById("turnSeconds");
const maxPlayers = document.getElementById("maxPlayers");
const gameMessage = document.getElementById("gameMessage");
const createRoomBtn = document.getElementById("createRoomBtn");

let currentUser = null;

function setMessage(text) {
  if (!gameMessage) return;
  gameMessage.textContent = text;
}

async function getOwnerName(user) {
  if (!user) return "オーナー";

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
    "オーナー"
  );
}

function setFormState() {
  if (!createRoomBtn) return;

  if (!currentUser) {
    createRoomBtn.disabled = true;
    setMessage("部屋を作るにはログインしてください。");
    return;
  }

  createRoomBtn.disabled = false;
  setMessage("部屋を作成できます。");
}

function getDefaultRoomTitle() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} ${hour}:${minute}`;
}

async function createRoom() {
  if (!currentUser) {
    setMessage("部屋を作るにはログインしてください。");
    return;
  }

  const title = roomTitle.value.trim() || getDefaultRoomTitle();

  const selectedTurnSeconds = Number(turnSeconds.value || 120);
  const selectedMaxPlayers = Number(maxPlayers.value || 4);

  if (selectedTurnSeconds < 30 || selectedTurnSeconds > 600) {
    setMessage("1ターンの時間が正しくありません。");
    return;
  }

  if (selectedMaxPlayers < 2 || selectedMaxPlayers > 10) {
    setMessage("最大人数が正しくありません。");
    return;
  }

  try {
    createRoomBtn.disabled = true;
    setMessage("部屋を作成しています...");

    const ownerName = await getOwnerName(currentUser);

    const roomRef = await addDoc(collection(db, "ocGameRooms"), {
      ownerId: currentUser.uid,
      ownerName,
      title,
      status: "waiting",
      turnSeconds: selectedTurnSeconds,
      maxPlayers: selectedMaxPlayers,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "ocGamePlayers"), {
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

    location.href = `/games/room/?id=${encodeURIComponent(roomRef.id)}`;
  } catch (error) {
    console.error(error);

    createRoomBtn.disabled = false;
    setMessage("部屋の作成に失敗しました。少し時間を置いてもう一度お試しください。");
  }
}

if (roomCreateForm) {
  roomCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createRoom();
  });
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  setFormState();
});

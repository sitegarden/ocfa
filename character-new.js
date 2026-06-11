import { auth, db } from "./firebase.js";

import {
  addDoc,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const canvas = document.getElementById("drawCanvas");
const ctx = canvas.getContext("2d");

const penColor = document.getElementById("penColor");
const penSize = document.getElementById("penSize");
const clearBtn = document.getElementById("clearBtn");
const form = document.getElementById("characterForm");
const message = document.getElementById("message");

let drawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawn = false;

function initCanvas() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

initCanvas();

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches ? e.touches[0] : e;

  return {
    x: ((touch.clientX - rect.left) / rect.width) * canvas.width,
    y: ((touch.clientY - rect.top) / rect.height) * canvas.height
  };
}

function startDraw(e) {
  e.preventDefault();

  const point = getPoint(e);
  drawing = true;
  lastX = point.x;
  lastY = point.y;
}

function draw(e) {
  if (!drawing) return;

  e.preventDefault();

  const point = getPoint(e);

  ctx.strokeStyle = penColor.value;
  ctx.lineWidth = Number(penSize.value);

  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();

  lastX = point.x;
  lastY = point.y;
  hasDrawn = true;
}

function stopDraw() {
  drawing = false;
}

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", stopDraw);
canvas.addEventListener("mouseleave", stopDraw);

canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", draw, { passive: false });
canvas.addEventListener("touchend", stopDraw);

clearBtn.addEventListener("click", () => {
  initCanvas();
  hasDrawn = false;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;

  if (!user) {
    message.textContent = "ログインしてから登録してくれ。";
    return;
  }

  const name = document.getElementById("charName").value.trim();
  const profile = document.getElementById("charProfile").value.trim();
  const tagsText = document.getElementById("charTags").value.trim();
  const faOk = document.getElementById("faOk").checked;
  const ngText = document.getElementById("ngText").value.trim();

  if (!name) {
    message.textContent = "キャラ名は必要だぞ。";
    return;
  }

  if (!hasDrawn) {
    message.textContent = "キャラ絵を描いてから登録してくれ。";
    return;
  }

  const tags = tagsText
    .split(/[,\s、]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  const imageData = canvas.toDataURL("image/jpeg", 0.75);

  try {
    message.textContent = "登録中...";

    await addDoc(collection(db, "v2Characters"), {
      userId: user.uid,
      ownerName: user.displayName || "",
      ownerPhotoURL: user.photoURL || "",
      name,
      profile,
      tags,
      faOk,
      ngText,
      imageData,
      isPublic: true,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    message.textContent = "登録できた。いいじゃん。";
    form.reset();
    initCanvas();
    hasDrawn = false;
  } catch (error) {
    console.error(error);
    message.textContent = "登録に失敗した。Firestoreルールか容量が怪しい。";
  }
});

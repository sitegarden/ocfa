import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const fanartContent = document.getElementById("fanartContent");

const params = new URLSearchParams(location.search);
const eventId = params.get("event");
const characterId = params.get("character");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function show(text) {
  fanartContent.innerHTML = `
    <section class="panel">
      <h1>診断中</h1>
      <p>${escapeHtml(text)}</p>
      <p>event: ${escapeHtml(eventId || "なし")}</p>
      <p>character: ${escapeHtml(characterId || "なし")}</p>
    </section>
  `;
}

show("event-fanart.js は実行されています。");

async function getEventEntryForCharacter() {
  const q = query(
    collection(db, "v2EventEntries"),
    where("eventId", "==", eventId),
    where("characterId", "==", characterId),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  let result = null;

  snap.forEach((docSnap) => {
    result = {
      id: docSnap.id,
      data: docSnap.data()
    };
  });

  return result;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    show("ログインしていません。");
    return;
  }

  show(`ログイン確認OK：${user.uid}`);

  try {
    const eventSnap = await getDoc(doc(db, "v2Events", eventId));

    if (!eventSnap.exists()) {
      show("イベントが見つかりません。");
      return;
    }

    show("イベント取得OK。次にキャラを取得します。");

    const characterSnap = await getDoc(doc(db, "v2Characters", characterId));

    if (!characterSnap.exists()) {
      show("キャラが見つかりません。");
      return;
    }

    show("イベント取得OK。キャラ取得OK。次に参加データを取得します。");

    const entry = await getEventEntryForCharacter();

    if (!entry) {
      show("参加データが見つかりません。このキャラはイベントに参加していない扱いです。");
      return;
    }

    show(
      `参加データ取得OK。\nentryId: ${entry.id}\nuserId: ${entry.data.userId}\nprogressCount: ${entry.data.progressCount ?? "なし"}\nfanartCount: ${entry.data.fanartCount ?? "なし"}`
    );
  } catch (error) {
    console.error(error);

    show(`エラー：${error.message}`);
  }
});

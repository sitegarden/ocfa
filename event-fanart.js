import { auth, db } from "/firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const fanartContent = document.getElementById("fanartContent");

const params = new URLSearchParams(location.search);
const eventId = params.get("event");
const characterId = params.get("character");

function show(text) {
  fanartContent.innerHTML = `
    <section class="panel">
      <h1>診断中</h1>
      <p>${text}</p>
      <p>event: ${eventId || "なし"}</p>
      <p>character: ${characterId || "なし"}</p>
    </section>
  `;
}

show("event-fanart.js は実行されています。");

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

    show("イベント取得OK。キャラ取得OK。ここまでは成功です。");
  } catch (error) {
    console.error(error);

    show(`エラー：${error.message}`);
  }
});

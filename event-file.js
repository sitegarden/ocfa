import { auth, db } from "/firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const eventFile = document.getElementById("eventFile");

const params = new URLSearchParams(location.search);
const eventId = params.get("id");

let currentUser = null;
let currentEvent = null;
let isCurrentAdmin = false;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(text) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

function statusLabel(status) {
  if (status === "open") return "受付中";
  if (status === "closed") return "終了";
  if (status === "draft") return "下書き";
  return "準備中";
}

async function getUserData(user) {
  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) return null;

  return snap.data();
}

async function getEvent() {
  const eventRef = doc(db, "v2Events", eventId);
  const snap = await getDoc(eventRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getMyCharacters() {
  if (!currentUser) return [];

  const q = query(
    collection(db, "v2Characters"),
    where("userId", "==", currentUser.uid),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  const characters = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.isPublic !== true) return;

    characters.push({
      id: docSnap.id,
      data
    });
  });

  characters.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  return characters;
}

async function getEventEntries() {
  const q = query(
    collection(db, "v2EventEntries"),
    where("eventId", "==", eventId),
    where("isDeleted", "==", false)
  );

  const snap = await getDocs(q);

  const entries = [];

  snap.forEach((docSnap) => {
    entries.push({
      id: docSnap.id,
      data: docSnap.data()
    });
  });

  entries.sort((a, b) => {
    const aTime = a.data.createdAt?.seconds || 0;
    const bTime = b.data.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  return entries;
}

async function getCharacterById(characterId) {
  const characterRef = doc(db, "v2Characters", characterId);
  const snap = await getDoc(characterRef);

  if (!snap.exists()) return null;

  return {
    id: snap.id,
    data: snap.data()
  };
}

async function getEntryCharacters(entries) {
  const results = [];

  for (const entry of entries) {
    const character = await getCharacterById(entry.data.characterId);

    if (!character) continue;
    if (character.data.isDeleted === true) continue;
    if (character.data.isPublic !== true && !isCurrentAdmin) continue;

    results.push({
      entry,
      character
    });
  }

  return results;
}

function renderNoEventId() {
  eventFile.innerHTML = `
    <section class="panel">
      <h1>イベントが選ばれていません</h1>
      <p>URLが正しいか確認してください。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderNotFound() {
  eventFile.innerHTML = `
    <section class="panel">
      <h1>イベントが見つかりませんでした</h1>
      <p>削除されたか、URLが変わっている可能性があります。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderPrivateEvent() {
  eventFile.innerHTML = `
    <section class="panel">
      <h1>このイベントは非公開です</h1>
      <p>公開されていないイベントです。</p>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
      </div>
    </section>
  `;
}

function renderEntryCharacters(entryCharacters) {
  if (entryCharacters.length === 0) {
    return `
      <div class="panel-soft">
        <p>参加キャラはまだいません。</p>
      </div>
    `;
  }

  return `
    <div class="character-list">
      ${entryCharacters
        .map(({ character }) => {
          const data = character.data;

          const tags = Array.isArray(data.tags)
            ? data.tags
                .map((tag) => `<span>${escapeHtml(tag)}</span>`)
                .join("")
            : "";

          return `
            <article class="character-card">
              <a class="character-card-link" href="/characters/file/?id=${encodeURIComponent(character.id)}">
                <img src="${data.imageData}" alt="${escapeHtml(data.name || "キャラ")}">

                <div class="character-body">
                  <h2>${escapeHtml(data.name || "名前未設定")}</h2>

                  ${
                    data.kana
                      ? `<p class="mini-info">${escapeHtml(data.kana)}</p>`
                      : ""
                  }

                  <div class="tag-list">
                    ${tags}
                  </div>

                  <p class="mini-info">
                    ${data.faOk ? "ファンアート歓迎" : "ファンアートは要確認"}
                  </p>
                </div>
              </a>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderJoinForm(myCharacters, myEntry) {
  if (!currentUser) {
    return `
      <div class="panel-soft">
        <p>イベントに参加するにはログインしてください。</p>
      </div>
    `;
  }

  if (currentEvent.data.status !== "open") {
    return `
      <div class="panel-soft">
        <p>このイベントは現在、参加受付中ではありません。</p>
      </div>
    `;
  }

  if (currentEvent.data.isPublic === false) {
    return `
      <div class="panel-soft">
        <p>非公開イベントのため、参加受付は表示されません。</p>
      </div>
    `;
  }

  if (myEntry) {
    return `
      <div class="panel-soft">
        <p>このイベントにはすでに参加しています。</p>

        <div class="actions">
          <button id="cancelEntryBtn" class="ghost-btn" type="button">
            参加を取り消す
          </button>
        </div>
      </div>
    `;
  }

  if (myCharacters.length === 0) {
    return `
      <div class="panel-soft">
        <p>参加できる公開キャラがまだありません。</p>

        <div class="actions">
          <a class="primary-btn" href="/draw/">キャラを作る</a>
        </div>
      </div>
    `;
  }

  return `
    <form id="eventEntryForm" class="event-entry-form">
      <p class="form-label">参加させるキャラ</p>

      <div class="entry-character-options">
        ${myCharacters
          .map((character, index) => {
            const data = character.data;

            return `
              <label class="entry-character-card">
                <input
                  type="radio"
                  name="entryCharacterId"
                  value="${character.id}"
                  ${index === 0 ? "checked" : ""}
                >

                <span>
                  <img src="${data.imageData}" alt="${escapeHtml(data.name || "キャラ")}">

                  <strong>${escapeHtml(data.name || "名前未設定")}</strong>

                  ${
                    data.kana
                      ? `<small>${escapeHtml(data.kana)}</small>`
                      : `<small>参加キャラ</small>`
                  }
                </span>
              </label>
            `;
          })
          .join("")}
      </div>

      <p class="mini-info">
        ひとつのイベントにつき、参加できるキャラはひとり1体までです。
      </p>

      <button class="primary-btn" type="submit">このキャラで参加する</button>
      <p id="entryMessage" class="message"></p>
    </form>
  `;
}

async function renderEvent(event) {
  currentEvent = event;

  const data = event.data;

  if (data.isDeleted === true) {
    renderNotFound();
    return;
  }

  if (data.isPublic === false && !isCurrentAdmin) {
    renderPrivateEvent();
    return;
  }

  const entries = await getEventEntries();
  const entryCharacters = await getEntryCharacters(entries);

  const myEntry = currentUser
    ? entries.find((entry) => entry.data.userId === currentUser.uid)
    : null;

  const myCharacters = currentUser && !myEntry
    ? await getMyCharacters()
    : [];

  eventFile.innerHTML = `
    <article class="event-detail panel">
      <div class="event-detail-head">
        <div>
          <p class="eyebrow">Event File</p>
          <h1>${escapeHtml(data.title || "無題のイベント")}</h1>

          <div class="event-status-row">
            <span class="status-pill">${statusLabel(data.status)}</span>
            ${
              data.isPublic === false
                ? `<span class="status-pill muted-pill">非公開</span>`
                : `<span class="status-pill">公開中</span>`
            }
          </div>
        </div>

        ${
          isCurrentAdmin
            ? `
              <div class="actions">
                <a class="primary-btn" href="/events/edit/?id=${encodeURIComponent(event.id)}">
                  編集する
                </a>
              </div>
            `
            : ""
        }
      </div>

      <section class="detail-section">
        <h2>イベント説明</h2>
        ${
          data.description
            ? `<p>${nl2br(data.description)}</p>`
            : `<p>説明文はまだありません。</p>`
        }
      </section>

      <section class="detail-section">
        <h2>イベントに参加する</h2>
        ${renderJoinForm(myCharacters, myEntry)}
      </section>

      <section class="detail-section">
        <h2>参加キャラ</h2>
        <p class="mini-info">${entryCharacters.length}体のキャラが参加中です。</p>
        ${renderEntryCharacters(entryCharacters)}
      </section>

      <section class="detail-section">
        <h2>ファンアート</h2>
        <p>
          ファンアート投稿機能は、参加キャラ機能のあとに追加予定です。
        </p>
      </section>

      <div class="actions">
        <a class="ghost-btn" href="/events/">イベント一覧へ</a>
        <a class="ghost-btn" href="/characters/">キャラ一覧を見る</a>
      </div>
    </article>
  `;

  setupEntryActions(myEntry);
}

function setupEntryActions(myEntry) {
  const form = document.getElementById("eventEntryForm");
  const cancelBtn = document.getElementById("cancelEntryBtn");

  if (form) {
    const message = document.getElementById("entryMessage");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();


form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const checkedCharacter = document.querySelector(
    'input[name="entryCharacterId"]:checked'
  );

  if (!checkedCharacter) {
    message.textContent = "参加させるキャラを選んでください。";
    return;
  }

  const characterId = checkedCharacter.value;

  if (!currentUser) return;

  const entryId = `${eventId}_${currentUser.uid}`;


      
      if (!currentUser) return;

      const entryId = `${eventId}_${currentUser.uid}`;

      try {
        message.textContent = "参加登録しています...";

        await setDoc(doc(db, "v2EventEntries", entryId), {
          eventId,
          characterId,
          userId: currentUser.uid,
          isDeleted: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        message.textContent = "イベントに参加しました。";

        setTimeout(() => {
          location.reload();
        }, 700);
      } catch (error) {
        console.error(error);
        message.textContent =
          "参加登録に失敗しました。少し時間を置いて、もう一度お試しください。";
      }
    });
  }

  if (cancelBtn && myEntry) {
    cancelBtn.addEventListener("click", async () => {
      try {
        cancelBtn.disabled = true;
        cancelBtn.textContent = "取り消しています...";

        await updateDoc(doc(db, "v2EventEntries", myEntry.id), {
          isDeleted: true,
          updatedAt: serverTimestamp()
        });

        location.reload();
      } catch (error) {
        console.error(error);
        cancelBtn.disabled = false;
        cancelBtn.textContent = "参加を取り消す";
        alert("参加の取り消しに失敗しました。");
      }
    });
  }
}

async function init() {
  if (!eventId) {
    renderNoEventId();
    return;
  }

  const event = await getEvent();

  if (!event) {
    renderNotFound();
    return;
  }

  await renderEvent(event);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  try {
    const userData = await getUserData(user);
    isCurrentAdmin = userData?.role === "admin";

    await init();
  } catch (error) {
    console.error(error);

    eventFile.innerHTML = `
      <section class="panel">
        <h1>読み込みに失敗しました</h1>
        <p>ページを再読み込みしてみてください。</p>
      </section>
    `;
  }
});

import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import CanvasEditor from "../components/CanvasEditor";

export default function CharacterNew() {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [faOk, setFaOk] = useState(true);
  const [ngText, setNgText] = useState("");
  const [imageData, setImageData] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();

    const user = auth.currentUser;

    if (!user) {
      setMessage("ログインしてから登録してくれ。");
      return;
    }

    if (!name.trim()) {
      setMessage("キャラ名は必要だぞ。");
      return;
    }

    if (!imageData) {
      setMessage("キャラ絵を描いてから登録してくれ。");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const tags = tagsText
        .split(/[,\s、]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);

      await addDoc(collection(db, "v2Characters"), {
        userId: user.uid,
        ownerName: user.displayName || "",
        name: name.trim(),
        profile: profile.trim(),
        tags,
        faOk,
        ngText: ngText.trim(),
        imageData,
        isPublic: true,
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setName("");
      setProfile("");
      setTagsText("");
      setFaOk(true);
      setNgText("");
      setImageData("");
      setMessage("登録できた。いいじゃん。");
    } catch (error) {
      console.error(error);
      setMessage("登録に失敗した。Firestoreルールを見直す必要があるかも。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <section className="page-head">
        <p className="eyebrow">Character Create</p>
        <h1>キャラを描いて登録する</h1>
        <p>
          画像URLは使わず、この場で描いたイラストをキャラ画像として登録する。
        </p>
      </section>

      <form className="character-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-panel">
            <label>
              キャラ名
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：星川ましろ"
              />
            </label>

            <label>
              プロフィール
              <textarea
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder="性格、設定、世界観など"
                rows="6"
              />
            </label>

            <label>
              タグ
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="例：魔法 少女 ほのぼの"
              />
            </label>

            <label className="check-row">
              <input
                type="checkbox"
                checked={faOk}
                onChange={(e) => setFaOk(e.target.checked)}
              />
              ファンアート歓迎
            </label>

            <label>
              NG・注意事項
              <textarea
                value={ngText}
                onChange={(e) => setNgText(e.target.value)}
                placeholder="例：過度な改変NG、R指定NG など"
                rows="4"
              />
            </label>

            <button className="primary-btn" disabled={saving}>
              {saving ? "登録中..." : "登録する"}
            </button>

            {message && <p className="form-message">{message}</p>}
          </div>

          <div className="form-panel">
            <h2>キャラ絵</h2>
            <CanvasEditor width={600} height={600} onChange={setImageData} />
          </div>
        </div>
      </form>
    </main>
  );
}

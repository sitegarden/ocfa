import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase";

export default function Header() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) return;

      const userRef = doc(db, "users", currentUser.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName || "",
          photoURL: currentUser.photoURL || "",
          role: "user",
          handle: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    });
  }, []);

  async function login() {
    await signInWithPopup(auth, googleProvider);
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <header className="site-header">
      <Link to="/" className="logo">
        OCFA v2
      </Link>

      <nav className="nav">
        <Link to="/characters">キャラ</Link>
        <Link to="/characters/new">キャラ作成</Link>
        <Link to="/events">イベント</Link>
        <Link to="/mypage">マイページ</Link>
      </nav>

      <div className="auth-area">
        {user ? (
          <>
            <span className="user-name">{user.displayName || "ログイン中"}</span>
            <button onClick={logout}>ログアウト</button>
          </>
        ) : (
          <button onClick={login}>Googleログイン</button>
        )}
      </div>
    </header>
  );
}

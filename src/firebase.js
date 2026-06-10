import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAKp6xPP-mFAMspTlhRpkc2PqjEjimVBY8",
  authDomain: "ocfa-data.firebaseapp.com",
  projectId: "ocfa-data",
  storageBucket: "ocfa-data.firebasestorage.app",
  messagingSenderId: "707709384754",
  appId: "1:707709384754:web:faa1449b1ce0b9ba75e42b"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

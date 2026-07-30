// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// Analytics only works in secure contexts (HTTPS)
let analytics;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig); // ✅ named export (fix)

// Init services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ✅ Cloud Functions — set region explicitly (prevents wrong endpoint/CORS confusion)
const FUNCTIONS_REGION =
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1";
export const functions = getFunctions(app, FUNCTIONS_REGION);

// ✅ OPTIONAL (recommended for localhost dev):
// If you run `firebase emulators:start --only functions`, this avoids CORS completely.
if (import.meta.env.DEV) {
  const useEmulator =
    String(import.meta.env.VITE_USE_FUNCTIONS_EMULATOR || "false") === "true";
  if (useEmulator) {
    connectFunctionsEmulator(functions, "localhost", 5001);
  }
}

// Prevent crashes on localhost (Analytics requires https)
if (typeof window !== "undefined" && window.location.protocol === "https:") {
  import("firebase/analytics")
    .then(({ getAnalytics }) => {
      analytics = getAnalytics(app);
    })
    .catch(() => {
      // ignore analytics load errors
    });
}

export { analytics };
export default app; // ✅ keep default export too (no breaking changes)

// src/hooks/useClientProfile.js
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function useClientProfile(uid) {
  const [clientDoc, setClientDoc] = useState(null);
  const [loading, setLoading] = useState(!!uid);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!uid) {
      setClientDoc(null);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    const ref = doc(db, "clients", uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        setClientDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
      },
      (err) => {
        console.error("useClientProfile error:", err);
        setError(err?.message || "Failed to load client profile.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid]);

  return { clientDoc, loading, error };
}

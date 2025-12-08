// src/hooks/useUserProfile.js
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function useUserProfile(uid) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!uid || typeof uid !== "string") {
      setProfile(null);
      setLoading(false);
      setError("");
      return;
    }

    const loadProfile = async () => {
      setLoading(true);
      setError("");

      try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setProfile(null);
        } else {
          setProfile({
            id: snap.id,
            ...snap.data(),
          });
        }
      } catch (err) {
        console.error("Error loading user profile:", err);
        setError("Could not load user profile.");
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [uid]);

  return { profile, loading, error };
}

// src/components/ClientRegister.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebaseConfig";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function ClientRegister() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password || !confirm) {
      setError("Please complete all fields.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password should be at least 6 characters.");
      return;
    }

    try {
      setSaving(true);

      // ✅ Ensure intent is stored (prevents mis-routing before profile exists)
      try {
        localStorage.setItem("uh_registration_intent", "client");
      } catch {
        // ignore
      }

      // 1) Create auth user
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      // 2) Send verification email
      await sendEmailVerification(cred.user);

      // 3) Create BOTH records:
      //    A) users/{uid} → role detection + app routing
      //    B) clients/{uid} → client-specific details/status
      await Promise.all([
        setDoc(doc(db, "users", uid), {
          uid,
          email,
          role: "client",
          accountType: "client",
          isClient: true,
          status: "pending",
          createdAt: serverTimestamp(),
        }),
        setDoc(doc(db, "clients", uid), {
          uid,
          email,
          accountType: "client",
          status: "pending", // admin can later activate
          createdAt: serverTimestamp(),
        }),
      ]);

      // ✅ Clear intent once profile exists (prevents future confusion)
      try {
        localStorage.removeItem("uh_registration_intent");
      } catch {
        // ignore
      }

      // 4) Sign out so they must verify then log in
      await signOut(auth);

      // ✅ 5) Go to verify-email screen, THEN after verification go to client onboarding
      navigate(`/verify-email?next=${encodeURIComponent("/client/onboarding")}`);
    } catch (err) {
      console.error("Client registration error:", err);
      if (err.code === "auth/email-already-in-use") {
        setError("This email is already registered. Please log in instead.");
      } else if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (err.code === "auth/weak-password") {
        setError("Your password is too weak. Please use a stronger password.");
      } else {
        setError("Registration failed. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div
        className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4"
        style={{ maxWidth: "28rem" }}
      >
        <h1 className="text-lg font-semibold text-slate-900 text-center">
          Register your client login
        </h1>
        <p className="text-xs text-slate-500 text-center">
          Step 1: Create a secure login with your work email. We&apos;ll send a
          verification email before you complete your full client registration.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-sm md:text-base">
          <div>
            <label className="font-medium text-sm">Work Email *</label>
            <input
              className="uh-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="font-medium text-sm">Password *</label>
            <input
              className="uh-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="font-medium text-sm">Confirm Password *</label>
            <input
              className="uh-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button
            disabled={saving}
            className="w-full bg-cyan-700 text-white py-2 rounded-lg font-semibold hover:bg-cyan-800 disabled:opacity-60"
          >
            {saving ? "Creating account…" : "Create Client Account"}
          </button>
        </form>

        <p className="text-[11px] text-slate-500 mt-1 text-center">
          Please check your inbox and your <strong>spam/junk</strong> folder for
          the verification email. After verifying, log in to complete your full
          client registration. Your account will remain pending until approved.
        </p>

        {/* Unity registration back button */}
        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-full py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← Back to landing page
        </button>
        <style>{`
          .uh-input {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            outline: none;
            font-size: 0.85rem;
            background-color: white;
          }
          .uh-input:focus {
            border-color: #0e7490;
            box-shadow: 0 0 0 1px #22d3ee33;
          }
        `}</style>
      </div>
    </div>
  );
}

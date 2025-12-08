// src/components/ClientVerify.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  sendEmailVerification,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";

export default function ClientVerify() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adminStatus, setAdminStatus] = useState(null); // "pending" | "active" | "rejected" | null

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setChecking(false);
    });
    return () => unsub();
  }, []);

  const handleResend = async () => {
    if (!user) {
      setMessage("You are not logged in. Please register again.");
      return;
    }
    try {
      setResending(true);
      setMessage("");
      await sendEmailVerification(user);
      setMessage("Verification email sent again. Please check your inbox.");
    } catch (err) {
      console.error("Error resending verification:", err);
      setMessage("Could not resend verification email. Try again later.");
    } finally {
      setResending(false);
    }
  };

  const handleCheck = async () => {
    if (!user) {
      setMessage("You are not logged in. Please register again.");
      return;
    }

    try {
      setRefreshing(true);
      setMessage("");
      setAdminStatus(null);

      // 1️⃣ Refresh auth user to see latest emailVerified flag
      await user.reload();

      if (!user.emailVerified) {
        setMessage(
          "We still can’t see your email as verified. Please click the link in your email, then try again."
        );
        return;
      }

      // 2️⃣ Email is verified → check Firestore for admin status
      const clientRef = doc(db, "clients", user.uid);
      const clientSnap = await getDoc(clientRef);

      if (!clientSnap.exists()) {
        setMessage(
          "We couldn’t find your client record. Please contact support."
        );
        return;
      }

      const data = clientSnap.data();
      const status = data.status || "pending";
      setAdminStatus(status);

      if (status === "active") {
        setMessage("Email verified and account activated. Redirecting you…");
        // Go to client portal/dashboard – change route if you use a different path
        navigate("/client");
      } else if (status === "rejected") {
        setMessage(
          "Your account has been reviewed but could not be approved. Please contact Unity admin for details."
        );
      } else {
        // pending
        setMessage(
          "Email verified. Your account is now awaiting Unity admin review and activation."
        );
      }
    } catch (err) {
      console.error("Error checking verification/admin status:", err);
      setMessage("Could not refresh status. Try again.");
    } finally {
      setRefreshing(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-700">
        Checking your session…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center space-y-3">
          <h1 className="text-lg font-semibold text-slate-900">
            Session not found
          </h1>
          <p className="text-sm text-slate-600">
            We couldn’t find your account. Please return to the registration
            page and try again.
          </p>
          <button
            onClick={() => navigate("/client/onboarding")}
            className="px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
          >
            Back to client registration
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full space-y-4 text-center">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900">
          Check your email
        </h1>
        <p className="text-sm md:text-base text-slate-600">
          We’ve sent a verification link to:
        </p>
        <p className="text-sm md:text-base font-semibold text-slate-900">
          {user.email}
        </p>
        <p className="text-xs md:text-sm text-slate-500">
          Please click the link in that email to verify your address. Once
          verified, click &quot;I&apos;ve verified my email&quot; below.
          After that, Unity admin will review and activate your client account.
        </p>

        {message && (
          <div className="bg-slate-50 border border-slate-200 text-slate-700 text-xs md:text-sm px-3 py-2 rounded-lg">
            {message}
            {adminStatus && (
              <div className="mt-1 text-[11px] text-slate-500">
                Account status: <strong>{adminStatus}</strong>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={handleCheck}
            disabled={refreshing}
            className="w-full px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800 disabled:opacity-60"
          >
            {refreshing ? "Checking…" : "I’ve verified my email"}
          </button>

          <button
            onClick={handleResend}
            disabled={resending}
            className="w-full px-4 py-2 rounded-full border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {resending ? "Resending…" : "Resend verification email"}
          </button>

          <button
            onClick={() => navigate("/")}
            className="w-full px-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-xs text-slate-600 hover:bg-slate-100"
          >
            Back to main site
          </button>
        </div>
      </div>
    </div>
  );
}

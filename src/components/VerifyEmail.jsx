// src/components/VerifyEmail.jsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../firebaseConfig";
import { sendEmailVerification, reload } from "firebase/auth";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();

  const [status, setStatus] = useState("checking"); // checking | ready | no-user
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);

  const searchParams = new URLSearchParams(location.search);
  const nextPath = searchParams.get("next") || "/";

  useEffect(() => {
    const user = auth.currentUser;

    if (!user) {
      setStatus("no-user");
      return;
    }

    if (user.emailVerified) {
      // Already verified – just send them on
      navigate(nextPath, { replace: true });
      return;
    }

    setStatus("ready");
  }, [navigate, nextPath]);

  const handleResend = async () => {
    setError("");
    setMessage("");
    setResending(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        setStatus("no-user");
        throw new Error("You are not signed in.");
      }

      await sendEmailVerification(user);
      setMessage(
        "We’ve sent a new verification email. Please check your inbox and your spam/junk folder."
      );
    } catch (err) {
      console.error("Error resending verification email:", err);
      setError(
        err.message ||
          "We couldn’t resend the verification email. Please try again."
      );
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerified = async () => {
    setError("");
    setMessage("");
    setChecking(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        setStatus("no-user");
        throw new Error("You are not signed in.");
      }

      // Refresh user from Firebase
      await reload(user);

      if (user.emailVerified) {
        setMessage("Thank you! Your email is now verified.");
        setTimeout(() => {
          navigate(nextPath, { replace: true });
        }, 600);
      } else {
        setError(
          "We still can’t see your email as verified. Please click the link in the email, then try again."
        );
      }
    } catch (err) {
      console.error("Error checking verification status:", err);
      setError(
        err.message ||
          "There was a problem checking your verification status. Please try again."
      );
    } finally {
      setChecking(false);
    }
  };

  // Not logged in
  if (status === "no-user") {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Sign in to verify your email
          </h1>
          <p className="text-sm text-slate-600">
            You need to be signed in to your Unity Healthcare account to verify
            your email address.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-2 px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  // Initial check
  if (status === "checking") {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-4 text-sm text-slate-600">
          Checking your account…
        </div>
      </div>
    );
  }

  // Normal "verify email" UI
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900 text-center">
          Verify your email address
        </h1>

        <p className="text-sm text-slate-600">
          We’ve sent a verification link to the email address on your Unity
          Healthcare account. Please click the link in that email to verify your
          address.
        </p>

        <p className="text-xs text-slate-500">
          Remember to check your <strong>spam/junk</strong> folder if you can’t
          see the email in your inbox. Once your email is verified, you’ll be
          able to continue to the next step.
        </p>

        {message && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-md">
            {message}
          </div>
        )}

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={handleResend}
            disabled={resending}
            className="w-full px-4 py-2 rounded-full border border-cyan-700 text-cyan-700 text-sm font-semibold bg-white hover:bg-cyan-50 disabled:opacity-60"
          >
            {resending ? "Sending verification email…" : "Resend verification email"}
          </button>

          <button
            onClick={handleCheckVerified}
            disabled={checking}
            className="w-full px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800 disabled:opacity-60"
          >
            {checking ? "Checking status…" : "I’ve verified my email – continue"}
          </button>
        </div>

        <button
          onClick={() => navigate("/")}
          className="w-full mt-2 text-xs text-slate-500 hover:text-slate-700"
        >
          ← Back to login
        </button>
      </div>
    </div>
  );
}

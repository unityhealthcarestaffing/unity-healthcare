// src/components/Login.jsx
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebaseConfig";
import { useNavigate } from "react-router-dom";

export default function Login({ onLogin }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    try {
      setLoading(true);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (onLogin) onLogin(cred.user);
    } catch (err) {
      console.error("Login error:", err);
      if (err.code === "auth/invalid-credential") {
        setError("Incorrect email or password.");
      } else if (err.code === "auth/user-disabled") {
        setError("Your account is disabled. Please contact admin.");
      } else {
        setError("Could not sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="bg-white w-full max-w-md p-6 rounded-2xl shadow-sm border border-slate-200 space-y-5">

        {/* HEADER */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">
            Unity Healthcare Staffing
          </h1>
          <p className="text-xs text-slate-500 mt-1">Secure portal login</p>
        </div>

        {/* ERROR */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* LOGIN FORM */}
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Email address
            </label>
            <input
              type="email"
              className="uh-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Password
            </label>
            <input
              type="password"
              className="uh-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-full bg-cyan-700 text-white font-semibold text-sm hover:bg-cyan-800 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* CLIENT REGISTRATION */}
        <div className="pt-3 border-t border-slate-200 text-center space-y-2">
          <p className="text-xs text-slate-500">Are you a new client organisation?</p>

          <button
            type="button"
            onClick={() => navigate("/client/onboarding")}
            className="inline-flex items-center justify-center px-4 py-1.5 rounded-full border border-cyan-700 text-cyan-700 text-xs font-semibold hover:bg-cyan-50"
          >
            Register as a Client
          </button>
        </div>

        {/* STAFF APPLICATION LINK */}
        <div className="text-center space-y-2">
          <p className="text-xs text-slate-500">Want to work with us?</p>
          <button
            type="button"
            onClick={() => navigate("/staff/apply")}
            className="inline-flex items-center justify-center px-4 py-1.5 rounded-full border border-emerald-700 text-emerald-700 text-xs font-semibold hover:bg-emerald-50"
          >
            Apply as Staff
          </button>
        </div>

        {/* FOOTER */}
        <p className="text-center text-[11px] text-slate-400 mt-4">
          © {new Date().getFullYear()} Unity Healthcare Staffing
        </p>
      </div>

      {/* LOCAL INPUT STYLES */}
      <style>{`
        .uh-input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          outline: none;
          font-size: 0.9rem;
          background-color: white;
        }
        .uh-input:focus {
          border-color: #0e7490;
          box-shadow: 0 0 0 1px #22d3ee33;
        }
      `}</style>
    </div>
  );
}

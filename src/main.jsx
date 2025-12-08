// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import ClientRegister from "./components/ClientRegister.jsx";
import StaffOnboarding from "./components/StaffOnboarding.jsx";
import "./index.css";

// Simple verify screen – you can customise later
function ClientVerify() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3 text-center">
        <h1 className="text-xl font-semibold text-slate-900">
          Check your email
        </h1>
        <p className="text-sm text-slate-600">
          We've sent a verification link to your email address.
          Please verify your email, then Unity admin will review and activate
          your client account.
        </p>
        <a
          href="/"
          className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
        >
          Return to login
        </a>
      </div>
    </div>
  );
}

function Root() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ⭐ PUBLIC STAFF RECRUITMENT FORM */}
        <Route path="/staff/apply" element={<StaffOnboarding />} />

        {/* ⭐ PUBLIC CLIENT ONBOARDING ROUTES */}
        <Route path="/client/onboarding" element={<ClientRegister />} />
        <Route path="/client-verify" element={<ClientVerify />} />

        {/* ⭐ EVERYTHING ELSE: LOGIN + DASHBOARD APP */}
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);

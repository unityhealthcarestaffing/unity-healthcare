// src/main.jsx
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";

import ClientRegister from "./components/ClientRegister.jsx";
import StaffRegister from "./components/StaffRegister.jsx";
import StaffOnboarding from "./components/StaffOnboarding.jsx";
import ClientOnboarding from "./components/ClientOnboarding.jsx";
import VerifyEmail from "./components/VerifyEmail.jsx";

// ✅ Admin route
import AdminStaffApplications from "./components/AdminStaffApplications.jsx";

import "./index.css";

// ✅ Firebase
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import {
  canViewAdminTab,
  resolveAdminAccess,
} from "./utils/adminAccess";

// ✅ Protected admin route wrapper
function AdminRoute({ children }) {
  const [checking, setChecking] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    let unsub = null;

    unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setIsAllowed(false);
          setChecking(false);
          return;
        }

        /*
         * Protected Super Admins resolve without requiring
         * a Firestore profile document.
         */
        const protectedAccess =
          resolveAdminAccess(
            user,
            null
          );

        if (protectedAccess.isSuperAdmin) {
          setIsAllowed(
            canViewAdminTab(
              protectedAccess,
              "admin-staff-applications"
            )
          );

          setChecking(false);
          return;
        }

        const uref =
          doc(db, "users", user.uid);

        const usnap =
          await getDoc(uref);

        const profile =
          usnap.exists()
            ? usnap.data()
            : null;

        const adminAccess =
          resolveAdminAccess(
            user,
            profile
          );

        setIsAllowed(
          canViewAdminTab(
            adminAccess,
            "admin-staff-applications"
          )
        );

        setChecking(false);
      } catch (err) {
        console.error("AdminRoute check failed:", err);
        setIsAllowed(false);
        setChecking(false);
      }
    });

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
        <div className="text-sm text-slate-600">Checking access…</div>
      </div>
    );
  }

  if (!isAllowed) {
    // redirect to App (login / dashboard gate)
    return <Navigate to="/" replace />;
  }

  return children;
}

function Root() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/client/register" element={<ClientRegister />} />
        <Route path="/staff/register" element={<StaffRegister />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        <Route path="/staff/apply" element={<StaffOnboarding />} />
        <Route path="/client/onboarding" element={<ClientOnboarding />} />

        {/* ✅ PROTECTED ADMIN PAGE */}
        <Route
          path="/admin/staff-applications"
          element={
            <AdminRoute>
              <AdminStaffApplications />
            </AdminRoute>
          }
        />

        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);

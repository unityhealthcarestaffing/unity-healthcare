// src/App.jsx
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";

import Login from "./components/Login.jsx";
import ShiftsList from "./components/ShiftsList.jsx";
import MyBookings from "./components/MyBookings.jsx";
import AdminShifts from "./components/AdminShifts.jsx";
import Availability from "./components/Availability.jsx";
import Timesheets from "./components/Timesheets.jsx";
import Payroll from "./components/Payroll.jsx";
import ClientDashboard from "./components/ClientDashboard.jsx";
import AdminUsers from "./components/AdminUsers.jsx";
import AdminTimesheets from "./components/AdminTimesheets.jsx";
import ClientInvoices from "./components/ClientInvoices.jsx";
import AdminClients from "./components/AdminClients.jsx";
import AdminStaffApplications from "./components/AdminStaffApplications.jsx"; // ⭐ NEW

import useUserProfile from "./hooks/useUserProfile";
import logo from "./assets/unity-logo.png";

function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState("shifts");

  // Safety net admin emails
  const adminEmails = [
    "info@unityhealthcarestaffing.co.uk",
    "valentine@unityhealthcarestaffing.co.uk",
    "valentine.c.enyi@gmail.com",
  ];

  // Watch Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
      setCheckingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Load Firestore profile
  const {
    profile,
    loading: profileLoading,
    error: profileError,
  } = useUserProfile(user ? user.uid : null);

  // Role flags
  const isAdmin =
    !!user &&
    (adminEmails.includes(user.email || "") ||
      profile?.role === "admin" ||
      profile?.isAdmin === true);

  const isClient =
    !!user &&
    (profile?.role === "client" ||
      profile?.accountType === "client" ||
      profile?.isClient === true);

  const isStaff =
    !!user &&
    !isClient &&
    (profile?.role === "staff" ||
      profile?.accountType === "staff" ||
      profile?.isStaff === true ||
      (!profile && !isAdmin)); // default to staff when unknown

  // Pick sensible default tab when user/role changes
  useEffect(() => {
    if (!user) return;

    if (isClient && !isAdmin) {
      // Pure client → client portal
      setActiveTab("client-shifts");
    } else if (isAdmin) {
      // Admin → admin dashboard first
      setActiveTab("admin-clients");
    } else {
      // Staff
      setActiveTab("shifts");
    }
  }, [user, isClient, isAdmin]);

  if (checkingAuth || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-700">
        Checking session…
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  // ✅ Email verification gate for CLIENTS (non-admin)
  if (isClient && !isAdmin && !user.emailVerified) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <img
              src={logo}
              alt="Unity Healthcare Staffing"
              className="h-10 w-auto object-contain"
            />
            <h1 className="text-lg font-semibold text-slate-900">
              Verify your email to continue
            </h1>
          </div>
          <p className="text-sm text-slate-600">
            We&apos;ve created your account, but your email address{" "}
            <span className="font-semibold">{user.email}</span> has not been
            verified yet.
          </p>
          <p className="text-xs text-slate-500">
            Please click the verification link we sent to your email. Once
            verified, sign in again and you&apos;ll be able to access the client
            portal.
          </p>
          <div className="flex flex-col gap-2 mt-2">
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Build visible tabs based on role
  const tabs = [];

  if (isClient && !isAdmin) {
    // Pure client experience
    tabs.push({
      id: "client-shifts",
      label: "Client – Shifts & Billing",
      group: "Client",
    });
  } else {
    // Staff (and/or admin) experience
    tabs.push(
      { id: "shifts", label: "Available Shifts", group: "Staff" },
      { id: "bookings", label: "My Bookings", group: "Staff" },
      { id: "availability", label: "My Availability", group: "Staff" },
      { id: "timesheets", label: "Timesheets", group: "Staff" }
    );
  }

  if (isAdmin) {
    tabs.push(
      { id: "admin-clients", label: "Admin – Clients", group: "Admin" },
      { id: "admin-shifts", label: "Admin – Shifts", group: "Admin" },
      { id: "admin-users", label: "Admin – Users", group: "Admin" },
      { id: "admin-timesheets", label: "Admin – Timesheets", group: "Admin" },
      { id: "admin-invoices", label: "Client Invoices", group: "Admin" },
      { id: "payroll", label: "Payroll", group: "Admin" },
      {
        id: "admin-staff-applications",
        label: "Staff Applications",
        group: "Admin",
      } // ⭐ NEW
    );
  }

  const accountLabel = isAdmin
    ? "Admin"
    : isClient
    ? "Client"
    : "Staff";

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Centre container with sidebar + main content */}
      <div className="mx-auto max-w-7.5xl min-h-screen flex bg-slate-50 shadow-sm">
        {/* SIDEBAR */}
        <aside className="w-64 bg-slate-900 text-slate-50 flex flex-col">
          {/* Brand / User */}
          <div className="px-4 py-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <img
                src={logo}
                alt="Unity Healthcare Staffing"
                className="h-9 w-auto md:h-10 object-contain"
              />
              <div className="min-w-0">
                <h1 className="text-sm font-semibold leading-tight">
                  Unity Healthcare
                </h1>
                <p className="text-[11px] text-slate-300">
                  Staffing &amp; Client Portal
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-1 text-[11px]">
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-slate-800 border border-slate-700">
                <span className="font-medium">{accountLabel}</span>
                <span className="text-slate-400">account</span>
              </div>
              <p className="truncate text-slate-300">{user.email}</p>
              {profileError && (
                <p className="text-[10px] text-amber-300">
                  Profile: {profileError}
                </p>
              )}
            </div>
          </div>

          {/* NAVIGATION */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 text-sm space-y-4">
            {/* Grouped labels look more “corporate” */}
            {["Client", "Staff", "Admin"].map((group) => {
              const groupTabs = tabs.filter((t) => t.group === group);
              if (!groupTabs.length) return null;

              return (
                <div key={group}>
                  <p className="px-2 mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                    {group} Area
                  </p>
                  <div className="space-y-1">
                    {groupTabs.map((tab) => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition ${
                            isActive
                              ? "bg-cyan-600 text-white shadow-sm"
                              : "text-slate-200 hover:bg-slate-800 hover:text-white"
                          }`}
                        >
                          <span>{tab.label}</span>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* FOOTER ACTIONS */}
          <div className="px-4 py-3 border-t border-slate-800 text-[11px] flex items-center justify-between">
            <span className="text-slate-400">
              Logged in as{" "}
              <span className="font-semibold text-slate-100">
                {accountLabel}
              </span>
            </span>
            <button
              onClick={() => signOut(auth)}
              className="px-3 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-medium"
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {/* Top heading area changes depending on role */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base md:text-lg font-semibold text-slate-900">
                {activeTab === "client-shifts" && isClient
                  ? "Client Shift & Billing Portal"
                  : isAdmin
                  ? "Admin Dashboard"
                  : "Staff Portal"}
              </h2>
              <p className="text-xs text-slate-500">
                Manage shifts, bookings, clients, staff applications and invoices
                in one place.
              </p>
            </div>
          </div>

          {/* TAB CONTENT */}
          <div className="space-y-5 pb-4">
            {/* Client portal */}
            {activeTab === "client-shifts" && isClient && (
              <ClientDashboard currentUser={user} />
            )}

            {/* Staff-facing tabs (only if not pure client) */}
            {activeTab === "shifts" && !isClient && (
              <ShiftsList currentUser={user} />
            )}
            {activeTab === "bookings" && !isClient && (
              <MyBookings currentUser={user} />
            )}
            {activeTab === "availability" && !isClient && (
              <Availability currentUser={user} />
            )}
            {activeTab === "timesheets" && !isClient && (
              <Timesheets currentUser={user} />
            )}

            {/* Admin-only financial/admin tools */}
            {activeTab === "payroll" && isAdmin && (
              <Payroll currentUser={user} />
            )}
            {activeTab === "admin-timesheets" && isAdmin && (
              <AdminTimesheets currentUser={user} />
            )}
            {activeTab === "admin-invoices" && isAdmin && (
              <ClientInvoices currentUser={user} />
            )}

            {/* Other admin tabs */}
            {activeTab === "admin-shifts" && isAdmin && (
              <AdminShifts currentUser={user} />
            )}
            {activeTab === "admin-users" && isAdmin && (
              <AdminUsers currentUser={user} />
            )}
            {activeTab === "admin-clients" && isAdmin && (
              <AdminClients currentUser={user} />
            )}
            {activeTab === "admin-staff-applications" && isAdmin && (
              <AdminStaffApplications currentUser={user} />
            )}

            {/* Safety fallback */}
            {!tabs.find((t) => t.id === activeTab) && (
              <p className="text-sm text-slate-600">
                You don’t have access to this section.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

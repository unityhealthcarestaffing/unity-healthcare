// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
} from "firebase/auth";
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
import AdminAccessManagement from "./components/AdminAccessManagement.jsx";
import AdminTimesheets from "./components/AdminTimesheets.jsx";
import ClientInvoices from "./components/ClientInvoices.jsx";
import AdminClients from "./components/AdminClients.jsx";
import AdminStaffApplications from "./components/AdminStaffApplications.jsx";
import StaffOnboarding from "./components/StaffOnboarding.jsx";
import ClientOnboarding from "./components/ClientOnboarding.jsx";

// ✅ NEW: client-only invoices tab component
import ClientMyInvoices from "./components/ClientMyInvoices.jsx";

import useUserProfile from "./hooks/useUserProfile";
import useClientProfile from "./hooks/useClientProfile";
import {
  canViewAdminTab,
  resolveAdminAccess,
} from "./utils/adminAccess";
import logo from "./assets/unity-logo.png";

function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState("shifts");

  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifySending, setVerifySending] = useState(false);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
      setCheckingAuth(false);
      setVerifyMessage("");
      setVerifyError("");
      setVerifySending(false);
    });
    return () => unsubscribe();
  }, []);

  const {
    profile,
    loading: profileLoading,
    error: profileError,
  } = useUserProfile(user ? user.uid : null);

  const adminAccess = useMemo(
    () => resolveAdminAccess(user, profile),
    [user, profile]
  );

  const isAdmin = adminAccess.isAdmin;

  const canUseStaffPortal =
    !isAdmin ||
    adminAccess.permissions.staffPortalAccess === true;

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
      (!profile && !isAdmin)); // keep your staff fallback

  const {
    clientDoc,
    loading: clientLoading,
    error: clientError,
  } = useClientProfile(isClient ? user?.uid : null);

  useEffect(() => {
    if (!user) return;

    if (isClient && !isAdmin) setActiveTab("client-shifts");
    else if (isAdmin) setActiveTab("admin-clients");
    else setActiveTab("shifts");
  }, [user, isClient, isAdmin]);

  const handleResendVerification = async () => {
    setVerifyMessage("");
    setVerifyError("");

    if (!user) {
      setVerifyError("We couldn’t find your session. Please sign in again first.");
      return;
    }

    try {
      setVerifySending(true);
      await sendEmailVerification(user);
      setVerifyMessage(
        "Verification email sent. Please check your inbox and spam/junk folder."
      );
    } catch (err) {
      console.error("Error resending verification email:", err);
      setVerifyError(
        "We couldn’t resend the verification email right now. Please try again."
      );
    } finally {
      setVerifySending(false);
    }
  };

  /**
   * ✅ HOOKS FIX (keep memos above any early returns)
   */
  const tabs = useMemo(() => {
    const t = [];

    // ✅ CLIENT tabs
    if (isClient && !isAdmin) {
      t.push(
        {
          id: "client-shifts",
          label: "Client – Shifts & Billing",
          group: "Client",
        },
        {
          id: "client-invoices",
          label: "Client – Invoices",
          group: "Client",
        }
      );
    } else if (canUseStaffPortal) {
      // STAFF tabs
      t.push(
        { id: "shifts", label: "Available Shifts", group: "Staff" },
        { id: "bookings", label: "My Bookings", group: "Staff" },
        { id: "availability", label: "My Availability", group: "Staff" },
        { id: "timesheets", label: "Timesheets", group: "Staff" }
      );
    }

    // ✅ ADMIN tabs
    if (isAdmin) {
      const adminTabs = [
        {
          id: "admin-clients",
          label: "Admin - Clients",
          group: "Admin",
        },
        {
          id: "admin-shifts",
          label: "Admin - Shifts",
          group: "Admin",
        },
        {
          id: "admin-users",
          label: "Admin - Users",
          group: "Admin",
        },
        {
          id: "admin-access",
          label: "Admin Access",
          group: "Admin",
        },
        {
          id: "admin-timesheets",
          label: "Admin - Timesheets",
          group: "Admin",
        },
        {
          id: "admin-invoices",
          label: "Client Invoices",
          group: "Admin",
        },
        {
          id: "payroll",
          label: "Payroll",
          group: "Admin",
        },
        {
          id: "admin-staff-applications",
          label: "Staff Applications",
          group: "Admin",
        },
      ];

      t.push(
        ...adminTabs.filter((tab) =>
          canViewAdminTab(adminAccess, tab.id)
        )
      );
    }

    return t;
  }, [
    isClient,
    isAdmin,
    canUseStaffPortal,
    adminAccess,
  ]);

  useEffect(() => {
    if (!user || tabs.length === 0) return;

    const activeTabIsAllowed = tabs.some(
      (tab) => tab.id === activeTab
    );

    if (!activeTabIsAllowed) {
      setActiveTab(tabs[0].id);
    }
  }, [user, tabs, activeTab]);

  const groupedTabs = useMemo(() => {
    const order = ["Client", "Staff", "Admin"];
    return order
      .map((group) => ({ group, items: tabs.filter((t) => t.group === group) }))
      .filter((g) => g.items.length > 0);
  }, [tabs]);

  const activeTabLabel =
    tabs.find((t) => t.id === activeTab)?.label || "Portal";

  const accountLabel = isAdmin ? "Admin" : isClient ? "Client" : "Staff";

  // ---------- EARLY RETURNS ----------
  if (checkingAuth || profileLoading || (isClient && clientLoading)) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-100 text-slate-700">
        Checking session…
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;

  // Email verification gates
  if (isStaff && !isAdmin && !user.emailVerified) {
    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4 text-center">
          <img
            src={logo}
            alt="Unity Healthcare Staffing"
            className="h-10 w-auto mx-auto object-contain"
          />
          <h1 className="text-lg font-semibold text-slate-900">
            Verify your email to access the staff portal
          </h1>

          {verifyMessage && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-md">
              {verifyMessage}
            </div>
          )}
          {verifyError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
              {verifyError}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={verifySending}
              className="px-4 py-2 rounded-full border border-cyan-700 text-cyan-700 text-sm font-semibold bg-white hover:bg-cyan-50 disabled:opacity-60"
            >
              {verifySending ? "Sending…" : "Resend verification email"}
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isClient && !isAdmin && !user.emailVerified) {
    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4 text-center">
          <img
            src={logo}
            alt="Unity Healthcare Staffing"
            className="h-10 w-auto mx-auto object-contain"
          />
          <h1 className="text-lg font-semibold text-slate-900">
            Verify your email to continue
          </h1>

          {verifyMessage && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-md">
              {verifyMessage}
            </div>
          )}
          {verifyError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
              {verifyError}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={verifySending}
              className="px-4 py-2 rounded-full border border-cyan-700 text-cyan-700 text-sm font-semibold bg-white hover:bg-cyan-50 disabled:opacity-60"
            >
              {verifySending ? "Sending…" : "Resend verification email"}
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STAFF onboarding gate
  if (
    isStaff &&
    !isAdmin &&
    user.emailVerified &&
    (!profile || profile.onboardingCompleted !== true)
  ) {
    return <StaffOnboarding />;
  }

  // CLIENT onboarding + approval gate
  if (isClient && !isAdmin) {
    const registrationCompleted = clientDoc?.registrationCompleted === true;
    const status = clientDoc?.status || "pending";

    if (!registrationCompleted) {
      return <ClientOnboarding currentUser={user} />;
    }

    if (status !== "active") {
      return (
        <div className="min-h-dvh bg-slate-100 flex items-center justify-center px-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3 text-center">
            <img
              src={logo}
              alt="Unity Healthcare Staffing"
              className="h-10 w-auto mx-auto object-contain"
            />
            <h1 className="text-lg font-semibold text-slate-900">
              Account pending approval
            </h1>
            <p className="text-sm text-slate-600">
              Your client registration has been submitted. An admin must approve
              your account before you can create shifts.
            </p>
            {clientError && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-md">
                {clientError}
              </p>
            )}
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="uh-app-shell min-h-dvh">
      <header className="uh-app-header sticky top-0 z-30 border-b">
        <div className="w-full mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 xl:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={logo}
              alt="Unity Healthcare Staffing"
              className="h-9 w-auto object-contain"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {activeTabLabel}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {accountLabel} • {user.email}
              </p>
              {profileError && (
                <p className="text-[10px] text-amber-600 truncate">
                  Profile: {profileError}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => signOut(auth)}
            className="shrink-0 px-3 py-2 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>

        <div className="uh-app-nav border-t">
          <div className="w-full mx-auto max-w-[1600px] px-2 sm:px-4 lg:px-6 xl:px-8">
            <div className="flex gap-2 overflow-x-auto py-2 no-scrollbar">
              {groupedTabs.map((g) => (
                <div
                  key={g.group}
                  className="flex items-center gap-2 shrink-0"
                >
                  <span className="px-2 text-[10px] uppercase tracking-wide text-slate-400">
                    {g.group}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {g.items.map((tab) => {
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={[
                            "px-3 py-2 rounded-full text-xs font-semibold border transition whitespace-nowrap",
                            isActive
                              ? "bg-cyan-700 text-white border-cyan-700"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                          ].join(" ")}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="uh-main-content w-full mx-auto max-w-[1600px] px-3 sm:px-4 lg:px-6 xl:px-8 py-4">
        <div className="uh-main-panel rounded-2xl border p-4 md:p-6">
          <div className="space-y-5">
            {/* ✅ CLIENT */}
            {activeTab === "client-shifts" && isClient && (
              <ClientDashboard currentUser={user} />
            )}
            {activeTab === "client-invoices" && isClient && (
              <ClientMyInvoices currentUser={user} />
            )}

            {/* ✅ STAFF */}
            {activeTab === "shifts" && !isClient && canUseStaffPortal && (
              <ShiftsList currentUser={user} />
            )}
            {activeTab === "bookings" && !isClient && canUseStaffPortal && (
              <MyBookings
                currentUser={user}
                onOpenTimesheets={() =>
                  setActiveTab("timesheets")
                }
              />
            )}
            {activeTab === "availability" && !isClient && canUseStaffPortal && (
              <Availability currentUser={user} />
            )}
            {activeTab === "timesheets" && !isClient && canUseStaffPortal && (
              <Timesheets currentUser={user} />
            )}

            {/* ✅ ADMIN */}
            {activeTab === "payroll" && canViewAdminTab(adminAccess, "payroll") && (
              <Payroll currentUser={user} />
            )}
            {activeTab === "admin-timesheets" && canViewAdminTab(adminAccess, "admin-timesheets") && (
              <AdminTimesheets
                  currentUser={user}
                  adminAccess={adminAccess}
                />
            )}
            {activeTab === "admin-invoices" && canViewAdminTab(adminAccess, "admin-invoices") && (
              <ClientInvoices currentUser={user} />
            )}

            {activeTab === "admin-shifts" && canViewAdminTab(adminAccess, "admin-shifts") && (
              <AdminShifts
                currentUser={user}
                adminAccess={adminAccess}
              />
            )}
            {activeTab === "admin-users" && canViewAdminTab(adminAccess, "admin-users") && (
              <AdminUsers currentUser={user} />
            )}
            {activeTab === "admin-access" &&
              canViewAdminTab(adminAccess, "admin-access") && (
                <AdminAccessManagement currentUser={user} />
              )}

            {activeTab === "admin-clients" && canViewAdminTab(adminAccess, "admin-clients") && (
              <AdminClients
                currentUser={user}
                adminAccess={adminAccess}
              />
            )}
            {activeTab === "admin-staff-applications" && canViewAdminTab(adminAccess, "admin-staff-applications") && (
              <AdminStaffApplications currentUser={user} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

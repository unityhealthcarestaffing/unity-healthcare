// src/components/ShiftsList.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebaseConfig";
import { resolveAdminAccess } from "../utils/adminAccess";

// Helper to classify shift as Day or Night based on startTime (HH:MM)
function getShiftType(shift) {
  const start = shift?.startTime || "";
  const [hourStr] = start.split(":");
  const hour = Number(hourStr);

  if (!Number.isFinite(hour)) return "Day";
  return hour < 17 ? "Day" : "Night";
}

// Build shift start DateTime from shift.date + shift.startTime
function getShiftStartDateTime(shift) {
  const baseDate = shift?.date?.toDate ? shift.date.toDate() : null;
  if (!baseDate) return null;

  const startTime = shift?.startTime || "";
  const [hh, mm] = startTime.split(":").map((n) => Number(n));

  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return d;

  d.setHours(hh, mm, 0, 0);
  return d;
}

// Build shift end DateTime from shift.date + shift.endTime (supports overnight)
function getShiftEndDateTime(shift) {
  const baseDate = shift?.date?.toDate ? shift.date.toDate() : null;
  if (!baseDate) return null;

  const endTime = shift?.endTime || "";
  const [hh, mm] = endTime.split(":").map((n) => Number(n));

  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return d;

  d.setHours(hh, mm, 0, 0);

  // overnight: if end <= start, add 1 day
  const start = getShiftStartDateTime(shift);
  if (start && d.getTime() <= start.getTime()) {
    d.setDate(d.getDate() + 1);
  }

  return d;
}

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ✅ Hours between two Date objects
function hoursBetween(a, b) {
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

// ✅ Duration in hours for a shift
function getShiftDurationHours(shift) {
  const s = getShiftStartDateTime(shift);
  const e = getShiftEndDateTime(shift);
  const h = hoursBetween(s, e);
  if (h == null) return 0;
  return h > 0 ? h : 0;
}

// ✅ get week start (Monday 00:00) for a date
function getWeekStartMonday(dateObj) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day; // move back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function isSameWeek(dateA, dateB) {
  const a = getWeekStartMonday(dateA);
  const b = getWeekStartMonday(dateB);
  return a.getTime() === b.getTime();
}

// ✅ Overlap check between two intervals [start,end)
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

// ✅ 10-hour rest rule between two shifts
function violatesRestRule(
  candidateStart,
  candidateEnd,
  otherStart,
  otherEnd,
  minRestHours
) {
  if (!candidateStart || !candidateEnd || !otherStart || !otherEnd) return false;

  // If overlap, it's already invalid
  if (intervalsOverlap(candidateStart, candidateEnd, otherStart, otherEnd))
    return true;

  // candidate after other
  if (candidateStart.getTime() >= otherEnd.getTime()) {
    const rest = hoursBetween(otherEnd, candidateStart);
    return rest != null && rest < minRestHours;
  }

  // other after candidate
  if (otherStart.getTime() >= candidateEnd.getTime()) {
    const rest = hoursBetween(candidateEnd, otherStart);
    return rest != null && rest < minRestHours;
  }

  return false;
}

// Active staff gate from users/{uid}
function isActiveStaffProfile(p) {
  if (!p) return false;

  const status = String(p.status || p.accountStatus || "").toLowerCase();
  const active =
    p.isActive === true ||
    status === "active" ||
    status === "approved" ||
    status === "enabled";

  const role = String(p.role || p.accountType || "").toLowerCase();
  const staffish = role === "staff" || p.isStaff === true;

  const onboarded = p.onboardingCompleted === true || p.onboarded === true;

  // allow legacy users with missing role as staff (keeps your old behaviour)
  const roleOk = staffish || role === "" || role === "user";

  return active && onboarded && roleOk;
}

// --- normalize roles and enforce booking rules (UI gating only; server still enforces) ---
function normalizeRole(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";

  if (v.includes("healthcare assistant") || v === "hca") return "hca";
  if (v.includes("support worker")) return "support worker";

  if (v === "rgn" || v.includes("registered general nurse")) return "rgn";
  if (v === "rmn" || v.includes("registered mental health nurse")) return "rmn";

  if (v.includes("nurse")) return "nurse";
  return v;
}

function staffCanBookShift(staffRoleRaw, shiftRoleRaw) {
  const staffRole = normalizeRole(staffRoleRaw);
  const shiftRole = normalizeRole(shiftRoleRaw);

  // If we can't determine staff role, don't hard-block (avoids breaking legacy data)
  if (!staffRole) return true;

  // HCA + Support Worker can book either HCA or Support Worker shifts
  if (staffRole === "hca" || staffRole === "support worker") {
    return shiftRole === "hca" || shiftRole === "support worker";
  }

  // Nurse (generic) can book nurse/rgn/rmn shifts
  if (staffRole === "nurse") {
    return shiftRole === "nurse" || shiftRole === "rgn" || shiftRole === "rmn";
  }

  // Otherwise exact match (e.g., rgn -> rgn)
  return staffRole === shiftRole;
}

// ✅ Staff PAY rate helper (supports legacy + new schema)
// Staff should see staff pay rate (NOT client billing rate)
function readStaffRate(shift) {
  const v =
    shift?.rates?.staff ??
    shift?.staffRate ??
    shift?.staffRatePerHour ??
    shift?.rateStaff ??
    shift?.rateStaffPerHour ??
    // legacy fallback (only if you used it historically for staff pay):
    shift?.hourlyRate ??
    null;

  const n =
    typeof v === "number"
      ? v
      : v == null || v === ""
      ? null
      : Number(v);

  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// ✅ Weekly max hours field reader from staff profile
function readMaxWeeklyHours(profile) {
  const v =
    profile?.maxWeeklyHours ??
    profile?.maxHoursPerWeek ??
    profile?.weeklyMaxHours ??
    profile?.weeklyHoursLimit ??
    profile?.visaWeeklyHoursLimit ??
    null;

  const n =
    typeof v === "number"
      ? v
      : v == null || v === ""
      ? null
      : Number(String(v).trim());

  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** ✅ Shift ID display (consistent across portals)
 * Preferred: your stored 6-digit/human code fields
 * Fallback: first 8 chars of Firestore doc id (uppercase)
 */
function getShiftIdDisplay(shift) {
  const explicit =
    String(shift.shiftId || "").trim() ||
    String(shift.shiftID || "").trim() ||
    String(shift.shiftCode || "").trim() ||
    String(shift.shiftId6 || "").trim() ||
    String(shift.publicShiftId || "").trim() ||
    String(shift.referenceId || "").trim() ||
    String(shift.refId || "").trim();

  if (explicit) return explicit;

  const docId = String(shift.id || "").trim();
  return docId ? docId.slice(0, 8).toUpperCase() : "—";
}

export default function ShiftsList({ currentUser }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingShiftId, setBookingShiftId] = useState(null);
  const [error, setError] = useState("");

  // Staff gate
  const [staffProfile, setStaffProfile] = useState(null);
  const [staffChecking, setStaffChecking] = useState(true);

  // ✅ Load staff's existing bookings/pending shifts (for overlap/rest/max-hours checks)
  const [myAssignedShifts, setMyAssignedShifts] = useState([]);
  const [checkingMyRules, setCheckingMyRules] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  // Resolve administrator and Staff Portal permissions.
  const adminAccess = useMemo(
    () =>
      resolveAdminAccess(
        currentUser,
        staffProfile
      ),
    [currentUser, staffProfile]
  );

  const canUseStaffPortal =
    !adminAccess.isAdmin ||
    adminAccess.permissions
      .staffPortalAccess === true;
  // Load staff profile once (users/{uid})
  useEffect(() => {
    const loadProfile = async () => {
      if (!currentUser?.uid) {
        setStaffProfile(null);
        setStaffChecking(false);
        return;
      }

      setStaffChecking(true);
      try {
        const ref = doc(db, "users", currentUser.uid);
        const snap = await getDoc(ref);
        setStaffProfile(snap.exists() ? snap.data() : null);
      } catch (e) {
        console.error("Error loading staff profile:", e);
        setStaffProfile(null);
      } finally {
        setStaffChecking(false);
      }
    };

    loadProfile();
  }, [currentUser]);

  const staffIsActive = useMemo(
    () => isActiveStaffProfile(staffProfile),
    [staffProfile]
  );

  // Administrators require explicit Staff Portal access.
  const canViewShifts =
    canUseStaffPortal &&
    (
      adminAccess.isAdmin ||
      staffIsActive
    );
  // Pick staff role field (supports multiple naming styles)
  const staffRoleRaw =
    staffProfile?.staffRole ||
    staffProfile?.roleName ||
    staffProfile?.position ||
    staffProfile?.jobRole ||
    staffProfile?.primaryRole ||
    staffProfile?.roleType ||
    staffProfile?.role ||
    "";

  const maxWeeklyHours = useMemo(
    () => readMaxWeeklyHours(staffProfile),
    [staffProfile]
  );

  // ✅ Load shifts: exclude past dates at DB level + exclude past start times today
  const loadShifts = async () => {
    setLoading(true);
    setError("");

    try {
      const shiftsRef = collection(db, "shifts");

      const midnight = todayMidnight();
      const q = query(
        shiftsRef,
        where("status", "==", "open"),
        where("date", ">=", Timestamp.fromDate(midnight))
      );

      const snapshot = await getDocs(q);

      const now = Date.now();
      const data = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...d.data(),
        }))
        .filter((shift) => {
          const startDT = getShiftStartDateTime(shift);
          return !startDT || startDT.getTime() >= now;
        });

      setShifts(data);
    } catch (err) {
      console.error("Error fetching shifts:", err);
      setError("Could not load shifts. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Load my assigned shifts (booked/pending) for clash/rest/max-hours checks
  const loadMyAssignedShifts = async () => {
    if (!currentUser?.uid) return;
    // Only needed for active staff bookings. Admin view does not need this.
    if (!staffIsActive) {
      setMyAssignedShifts([]);
      return;
    }

    setCheckingMyRules(true);
    try {
      const shiftsRef = collection(db, "shifts");

      // We intentionally avoid orderBy to reduce index requirements.
      const q1 = query(shiftsRef, where("bookedBy", "==", currentUser.uid));
      const q2 = query(shiftsRef, where("bookedStaffId", "==", currentUser.uid));
      const q3 = query(shiftsRef, where("requestedStaffId", "==", currentUser.uid));

      const [s1, s2, s3] = await Promise.all([getDocs(q1), getDocs(q2), getDocs(q3)]);

      const map = new Map();
      const addSnap = (snap) => {
        snap.docs.forEach((d) => {
          map.set(d.id, { id: d.id, ...d.data() });
        });
      };

      addSnap(s1);
      addSnap(s2);
      addSnap(s3);

      const merged = Array.from(map.values()).filter((s) => {
        const st = String(s.status || "").toLowerCase();
        // Include booked + pending states (to prevent double-booking while pending)
        // Exclude cancelled
        if (st === "cancelled") return false;
        if (st === "booked") return true;
        if (st === "pending_admin") return true;
        if (st === "pending") return true;
        if (st === "client_pending") return true;
        // Some old data might not have status; keep it to be safe
        return st === "" || st === "open" ? false : true;
      });

      setMyAssignedShifts(merged);
    } catch (e) {
      console.error("Error loading my assigned shifts:", e);
      // Don't hard-fail the whole screen; just disable booking checks gracefully.
      setMyAssignedShifts([]);
    } finally {
      setCheckingMyRules(false);
    }
  };

  // ✅ Only load shifts if admin OR staff is active
  useEffect(() => {
    if (staffChecking) return;
    if (!currentUser) return;
    if (!canViewShifts) return;

    loadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, staffChecking, canViewShifts]);

  // ✅ Load booking-rule data when staff becomes active or user changes
  useEffect(() => {
    if (staffChecking) return;
    if (!currentUser?.uid) return;
    if (!staffIsActive) return;

    loadMyAssignedShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, staffChecking, staffIsActive]);

  // ✅ compute booking eligibility for a candidate shift
  const getBookingBlockReason = (shift) => {
    if (!staffIsActive) return "Only active staff can book shifts.";

    // role eligibility
    if (!staffCanBookShift(staffRoleRaw, shift.role)) {
      return "Role mismatch. You can only book shifts that match your role (HCA & Support Worker can book either).";
    }

    // start in past
    const startDT = getShiftStartDateTime(shift);
    const endDT = getShiftEndDateTime(shift);
    if (startDT && startDT.getTime() < Date.now()) {
      return "You cannot book a shift in the past.";
    }

    // If we cannot compute times, don't hard-block (prevents breaking legacy shifts)
    if (!startDT || !endDT) return "";

    // (4) no overlap/clash
    for (const s of myAssignedShifts) {
      const sStart = getShiftStartDateTime(s);
      const sEnd = getShiftEndDateTime(s);
      if (!sStart || !sEnd) continue;

      if (intervalsOverlap(startDT, endDT, sStart, sEnd)) {
        return "You already have a shift that overlaps with this time.";
      }
    }

    // (5) 10-hour rest
    const MIN_REST_HOURS = 10;
    for (const s of myAssignedShifts) {
      const sStart = getShiftStartDateTime(s);
      const sEnd = getShiftEndDateTime(s);
      if (!sStart || !sEnd) continue;

      if (violatesRestRule(startDT, endDT, sStart, sEnd, MIN_REST_HOURS)) {
        return "You must have at least 10 hours rest between shifts.";
      }
    }

    // (6) weekly max hours limit (visa restrictions)
    if (typeof maxWeeklyHours === "number") {
      const candidateHours = getShiftDurationHours(shift);

      const start = startDT;
      const totalThisWeek = myAssignedShifts.reduce((sum, s) => {
        const st = getShiftStartDateTime(s);
        if (!st) return sum;
        if (!isSameWeek(st, start)) return sum;
        return sum + getShiftDurationHours(s);
      }, 0);

      const projected = totalThisWeek + candidateHours;

      if (projected > maxWeeklyHours + 1e-9) {
        return `Weekly hours limit exceeded. Your max is ${maxWeeklyHours} hrs/week. This booking would take you to ${projected.toFixed(
          2
        )} hrs.`;
      }
    }

    return "";
  };

  // ✅ SERVER-ENFORCED booking (we add safe UI checks first)
  const handleBook = async (shift) => {
    if (!currentUser) {
      alert("Please log in to book a shift.");
      return;
    }

    if (!staffIsActive) {
      alert("Only active staff can book shifts. Please contact admin.");
      return;
    }

    const reason = getBookingBlockReason(shift);
    if (reason) {
      alert(reason);
      return;
    }

    const confirmed = window.confirm(
      "Do you want to book this shift? It will be sent for admin approval and will show as pending until confirmed."
    );
    if (!confirmed) return;

    setBookingShiftId(shift.id);
    setError("");

    try {
      const requestShiftBooking = httpsCallable(functions, "requestShiftBookingV2");

      // ✅ keep payload minimal (prevents breaking strict Cloud Function validation)
      const res = await requestShiftBooking({ shiftId: shift.id });

      if (res?.data?.ok) {
        await loadShifts();
        await loadMyAssignedShifts(); // refresh local rule data
        alert("Shift requested. It is now pending admin approval.");
      } else {
        const msg = res?.data?.message || "Could not request this shift. Please try again.";
        alert(msg);
      }
    } catch (err) {
      console.error("Error booking shift:", err);
      const msg =
        err?.message ||
        err?.details ||
        "Could not request this shift. Please try again.";
      setError(msg);
      alert(msg);
    } finally {
      setBookingShiftId(null);
    }
  };

  const handleCopyAddress = (text) => {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => alert("Address copied to clipboard"))
          .catch(() => alert("Could not copy. Please copy manually."));
      } else {
        alert("Copy not supported. Please copy manually:\n" + text);
      }
    } catch {
      alert("Copy not supported. Please copy manually:\n" + text);
    }
  };

  // Gate UI
  if (!currentUser) {
    return (
      <div className="text-sm text-slate-600">
        Please sign in to view available shifts.
      </div>
    );
  }

  if (staffChecking) {
    return <div className="text-sm text-slate-600">Checking access…</div>;
  }

  if (!canViewShifts) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {adminAccess.isAdmin
          ? "Your administrator profile does not include Staff Portal Access."
          : "Your staff account is not active yet. Only active staff can view and book shifts. Please contact Unity admin."}
      </div>
    );
  }

  if (loading) return <div className="text-sm text-slate-600">Loading shifts…</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;

  // Apply filters
  const filteredShifts = shifts.filter((shift) => {
    const type = getShiftType(shift);

    if (filterType === "day" && type !== "Day") return false;
    if (filterType === "night" && type !== "Night") return false;

    if (
      locationFilter &&
      !shift.location?.toLowerCase().includes(locationFilter.toLowerCase())
    )
      return false;

    if (roleFilter && shift.role !== roleFilter) return false;

    if (dateFilter) {
      const filterDate = new Date(dateFilter);
      filterDate.setHours(0, 0, 0, 0);

      const shiftDate = shift.date?.toDate ? shift.date.toDate() : null;
      if (!shiftDate) return false;
      shiftDate.setHours(0, 0, 0, 0);

      const same =
        shiftDate.getFullYear() === filterDate.getFullYear() &&
        shiftDate.getMonth() === filterDate.getMonth() &&
        shiftDate.getDate() === filterDate.getDate();

      if (!same) return false;
    }

    return true;
  });

  const hasAnyShifts = shifts.length > 0;

  const FiltersBar = () => (
    <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
      <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
        <button
          onClick={() => setFilterType("all")}
          className={`px-3 py-1 rounded-full ${
            filterType === "all"
              ? "bg-cyan-700 text-white"
              : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilterType("day")}
          className={`px-3 py-1 rounded-full ${
            filterType === "day"
              ? "bg-cyan-700 text-white"
              : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          Day
        </button>
        <button
          onClick={() => setFilterType("night")}
          className={`px-3 py-1 rounded-full ${
            filterType === "night"
              ? "bg-cyan-700 text-white"
              : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          Night
        </button>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-slate-500">Location:</span>
        <input
          type="text"
          placeholder="e.g. Ysbyty Gwynedd"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
        />
      </div>

      <div className="flex items-center gap-1">
        <span className="text-slate-500">Role:</span>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
        >
          <option value="">All</option>
          <option value="Nurse">Nurse</option>
          <option value="HCA">Healthcare Assistant</option>
          <option value="Support Worker">Support Worker</option>
          <option value="RGN">RGN</option>
          <option value="RMN">RMN</option>
        </select>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-slate-500">Date:</span>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
        />
      </div>

      {!!normalizeRole(staffRoleRaw) && (
        <div className="text-[11px] text-slate-500">
          Your role:{" "}
          <span className="font-semibold text-slate-700">{String(staffRoleRaw)}</span>
        </div>
      )}

      {typeof maxWeeklyHours === "number" && (
        <div className="text-[11px] text-slate-500">
          Weekly limit:{" "}
          <span className="font-semibold text-slate-700">{maxWeeklyHours} hrs</span>
        </div>
      )}

      {checkingMyRules && (
        <div className="text-[11px] text-slate-500">Checking your bookings…</div>
      )}
    </div>
  );

  if (!filteredShifts.length) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Available Shifts</h2>
          <p className="text-xs text-slate-500">Book an open shift from the list below.</p>
        </div>

        <FiltersBar />

        <div className="text-sm text-slate-600">
          {hasAnyShifts
            ? "No shifts match your filters."
            : "No open shifts at the moment."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Available Shifts</h2>
        <p className="text-xs text-slate-500">Book an open shift from the list below.</p>
      </div>

      <FiltersBar />

      <div className="grid gap-4 md:grid-cols-2">
        {filteredShifts.map((shift) => {
          const type = getShiftType(shift);
          const isDay = type === "Day";

          const mapQuery = [shift.location, shift.address, shift.postcode]
            .filter(Boolean)
            .join(", ");

          const mapsUrl = mapQuery
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                mapQuery
              )}`
            : null;

          const roleMismatch = !staffCanBookShift(staffRoleRaw, shift.role);
          const staffPayRate = readStaffRate(shift);

          const blockReason = !staffIsActive
            ? "Only active staff can book."
            : getBookingBlockReason(shift);

          const disabled =
            bookingShiftId === shift.id ||
            roleMismatch ||
            !!blockReason ||
            checkingMyRules;

          const shiftIdDisplay = getShiftIdDisplay(shift);

          return (
            <div
              key={shift.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-1 hover:shadow-md hover:border-cyan-300 transition"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-slate-900">
                  {shift.location}
                </h3>

                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    isDay
                      ? "bg-amber-100 text-amber-700 border border-amber-200"
                      : "bg-slate-800 text-slate-50 border border-slate-700"
                  }`}
                >
                  {isDay ? "Day shift" : "Night shift"}
                </span>
              </div>

              {/* ✅ SHIFT ID (clean UI) */}
              <p className="text-[11px] text-slate-600">
                Shift ID: <span className="font-mono font-semibold">{shiftIdDisplay}</span>
              </p>

              <p className="text-xs text-slate-500">
                {shift.date?.toDate ? shift.date.toDate().toLocaleDateString() : ""}
              </p>

              <p className="text-xs text-slate-600">
                {shift.startTime} – {shift.endTime}
              </p>

              <p className="text-xs text-slate-700">
                Staff rate (pay):{" "}
                <span className="font-semibold">
                  {typeof staffPayRate === "number" ? `£${staffPayRate}` : "TBC"}
                </span>
                /hr
              </p>

              {shift.role && (
                <p className="text-[11px] text-slate-600">
                  Role: <span className="font-semibold">{shift.role}</span>
                </p>
              )}

              {roleMismatch && (
                <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                  You can only book shifts that match your role (HCA &amp; Support Worker can book either).
                </div>
              )}

              {!roleMismatch && blockReason && (
                <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
                  {blockReason}
                </div>
              )}

              <button
                onClick={() => handleBook(shift)}
                disabled={disabled}
                className="mt-3 inline-flex items-center justify-center rounded-full bg-cyan-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-cyan-800 disabled:opacity-60 disabled:cursor-default transition"
                title={roleMismatch ? "Role mismatch" : blockReason || ""}
              >
                {checkingMyRules
                  ? "Checking…"
                  : roleMismatch
                  ? "Not eligible"
                  : bookingShiftId === shift.id
                  ? "Requesting…"
                  : blockReason
                  ? "Cannot book"
                  : "Book shift"}
              </button>

              <details className="mt-2 text-[11px] text-slate-600">
                <summary className="cursor-pointer text-xs text-cyan-700 hover:underline">
                  Shift details
                </summary>
                <div className="mt-1 space-y-0.5">
                  {shift.address && <p>Address: {shift.address}</p>}
                  {shift.postcode && <p>Postcode: {shift.postcode}</p>}
                  {shift.landmarks && <p>Nearby: {shift.landmarks}</p>}

                  {mapQuery && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-700 hover:underline"
                        >
                          Open in Google Maps
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopyAddress(mapQuery)}
                        className="text-xs px-2 py-0.5 rounded-full border border-slate-300 bg-slate-50 hover:bg-slate-100"
                      >
                        Copy address
                      </button>
                    </div>
                  )}

                  {!shift.address && !shift.postcode && !shift.landmarks && !mapQuery && (
                    <p>No extra details provided.</p>
                  )}
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

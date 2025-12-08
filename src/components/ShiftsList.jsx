import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

// Helper to classify shift as Day or Night based on startTime (HH:MM)
function getShiftType(shift) {
  const start = shift?.startTime || "";
  const [hourStr] = start.split(":");
  const hour = Number(hourStr);

  if (!Number.isFinite(hour)) return "Day"; // fallback
  return hour < 17 ? "Day" : "Night";
}

export default function ShiftsList({ currentUser }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingShiftId, setBookingShiftId] = useState(null);
  const [error, setError] = useState("");

  // Filters
  const [filterType, setFilterType] = useState("all"); 
  const [locationFilter, setLocationFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const loadShifts = async () => {
    setLoading(true);
    setError("");
    try {
      const shiftsRef = collection(db, "shifts");
      // Only show open shifts
      const q = query(shiftsRef, where("status", "==", "open"));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setShifts(data);
    } catch (err) {
      console.error("Error fetching shifts:", err);
      setError("Could not load shifts. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  // ⭐⭐⭐ STAFF BOOKING FUNCTION (UPDATED)
  const handleBook = async (shiftId) => {
    if (!currentUser) {
      alert("Please log in to book a shift.");
      return;
    }

    const confirmed = window.confirm(
      "Do you want to book this shift? It will be sent for approval and show as pending until confirmed."
    );
    if (!confirmed) return;

    setBookingShiftId(shiftId);
    setError("");

    try {
      const shiftRef = doc(db, "shifts", shiftId);

      await updateDoc(shiftRef, {
        status: "pending",

        // 🔹 Required for admin + payroll + client dashboard
        bookedBy: currentUser.uid,
        bookedStaffId: currentUser.uid,
        bookedStaffEmail: currentUser.email || null,
        bookedStaffName:
          currentUser.displayName ||
          currentUser.fullName ||
          currentUser.email ||
          null,

        bookedAt: new Date(),
      });

      await loadShifts();
      alert("Shift requested. It is now pending approval.");
    } catch (err) {
      console.error("Error booking shift:", err);
      setError("Could not request this shift. Please try again.");
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

  if (loading)
    return <div className="text-sm text-slate-600">Loading shifts…</div>;

  if (error)
    return <div className="text-sm text-red-600">{error}</div>;

  // Apply filters
  const filteredShifts = shifts.filter((shift) => {
    const type = getShiftType(shift); // "Day" or "Night"

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

  // Filters bar UI
  const FiltersBar = () => (
    <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
      {/* Day/Night filter */}
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

      {/* Location filter */}
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

      {/* Role filter */}
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

      {/* Date filter */}
      <div className="flex items-center gap-1">
        <span className="text-slate-500">Date:</span>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
        />
      </div>
    </div>
  );

  if (!filteredShifts.length) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Available Shifts
          </h2>
          <p className="text-xs text-slate-500">
            Book an open shift from the list below.
          </p>
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

  // Main UI
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Available Shifts
        </h2>
        <p className="text-xs text-slate-500">
          Book an open shift from the list below.
        </p>
      </div>

      <FiltersBar />

      {/* Shift cards */}
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

          return (
            <div
              key={shift.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-1 hover:shadow-md hover:border-cyan-300 transition"
            >
              {/* Header */}
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

              <p className="text-xs text-slate-500">
                {shift.date?.toDate
                  ? shift.date.toDate().toLocaleDateString()
                  : ""}
              </p>

              <p className="text-xs text-slate-600">
                {shift.startTime} – {shift.endTime}
              </p>

              <p className="text-xs text-slate-700">
                Rate:{" "}
                <span className="font-semibold">£{shift.hourlyRate}</span>/hr
              </p>

              {shift.role && (
                <p className="text-[11px] text-slate-600">
                  Role:{" "}
                  <span className="font-semibold">{shift.role}</span>
                </p>
              )}

              <button
                onClick={() => handleBook(shift.id)}
                disabled={bookingShiftId === shift.id}
                className="mt-3 inline-flex items-center justify-center rounded-full bg-cyan-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-cyan-800 disabled:opacity-60 disabled:cursor-default transition"
              >
                {bookingShiftId === shift.id ? "Requesting…" : "Book shift"}
              </button>

              {/* Extra details */}
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

                  {!shift.address &&
                    !shift.postcode &&
                    !shift.landmarks &&
                    !mapQuery && <p>No extra details provided.</p>}
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}

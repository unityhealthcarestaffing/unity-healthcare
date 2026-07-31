// src/components/MyBookings.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  Timestamp,
  onSnapshot,
} from "firebase/firestore";
import { db, functions } from "../firebaseConfig";
import { httpsCallable } from "firebase/functions";

// Build a Date object for shift start using shift.date (Timestamp) + startTime (HH:MM)
function getShiftStartDateTime(shift) {
  const baseDate = shift?.date?.toDate ? shift.date.toDate() : null;
  const startTime = shift?.startTime || "";

  if (!baseDate || !startTime.includes(":")) return null;

  const [hh, mm] = startTime.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const start = new Date(baseDate);
  start.setHours(hh, mm, 0, 0);
  return start;
}

function hoursUntil(dateObj) {
  if (!dateObj) return null;
  return (dateObj.getTime() - Date.now()) / (1000 * 60 * 60);
}

// ✅ Rate helper (supports your legacy + new schema)
function readStaffRate(shift) {
  const v =
    shift?.rates?.staff ??
    shift?.staffRate ??
    shift?.staffRatePerHour ??
    shift?.hourlyRate ??
    shift?.rateStaff ??
    shift?.rateStaffPerHour ??
    null;

  if (v === null || v === undefined || v === "") return null;

  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

// ✅ Best-effort "address" aggregator (supports different field names safely)
function readShiftAddress(shift) {
  const parts = [];

  const direct =
    shift?.address ||
    shift?.fullAddress ||
    shift?.shiftAddress ||
    shift?.locationAddress ||
    "";

  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const a1 = shift?.addressLine1 || shift?.address1 || "";
  const a2 = shift?.addressLine2 || shift?.address2 || "";
  const city = shift?.city || shift?.town || "";
  const county = shift?.county || "";
  const postcode = shift?.postcode || shift?.postCode || "";

  [a1, a2, city, county, postcode].forEach((p) => {
    const s = typeof p === "string" ? p.trim() : "";
    if (s) parts.push(s);
  });

  return parts.join(", ");
}

function readShiftNotes(shift) {
  const v =
    shift?.notes ??
    shift?.shiftNotes ??
    shift?.instructions ??
    shift?.specialInstructions ??
    shift?.requirements ??
    "";
  return typeof v === "string" ? v.trim() : "";
}

// ✅ Client/site name (supports different field names safely)
function readPlaceName(shift) {
  return (
    shift?.location ||
    shift?.siteName ||
    shift?.clientName ||
    shift?.facilityName ||
    "Shift"
  );
}

// ✅ Derive badge from SHIFT + TIMESHEET DOC (source of truth)
function deriveBadgeAndStatusKey({ shift, hrs, tsDoc }) {
  const status = String(shift?.status || "").toLowerCase();
  const isPastOrStarted = hrs != null && hrs <= 0;

  // Timesheet status comes from timesheets collection
  const tsStatus = String(tsDoc?.status || "").toLowerCase();

  if (isPastOrStarted) {
    if (tsStatus === "approved") {
      return {
        statusKey: "completed",
        badge: {
          text: "Completed",
          className: "bg-slate-100 text-slate-700 border border-slate-200",
        },
      };
    }
    if (tsStatus === "submitted") {
      return {
        statusKey: "timesheet_submitted",
        badge: {
          text: "Timesheet submitted",
          className: "bg-cyan-50 text-cyan-800 border border-cyan-200",
        },
      };
    }
    if (tsStatus === "rejected") {
      return {
        statusKey: "submit_timesheet",
        badge: {
          text: "Submit timesheet",
          className: "bg-amber-50 text-amber-800 border border-amber-200",
        },
      };
    }

    // No readable timesheet yet (or not created/available): prompt submit
    return {
      statusKey: "submit_timesheet",
      badge: {
        text: "Submit timesheet",
        className: "bg-amber-50 text-amber-800 border border-amber-200",
      },
    };
  }

  // Future shifts: keep your existing shift.status behaviour
  if (status === "pending_admin") {
    return {
      statusKey: "pending_admin",
      badge: {
        text: "Pending admin approval",
        className: "bg-amber-50 text-amber-700 border border-amber-200",
      },
    };
  }

  if (status === "pending" || status === "client_pending") {
    return {
      statusKey: "pending",
      badge: {
        text: "Pending",
        className: "bg-amber-50 text-amber-700 border border-amber-200",
      },
    };
  }

  if (status === "open") {
    return {
      statusKey: "open",
      badge: {
        text: "Open",
        className: "bg-slate-50 text-slate-600 border border-slate-200",
      },
    };
  }

  return {
    statusKey: "booked",
    badge: {
      text: "Booked",
      className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    },
  };
}

export default function MyBookings({
  currentUser,
  onOpenTimesheets,
}) {
  const navigate = useNavigate();

  const [bookings, setBookings] = useState([]);
  const [timesheetsByShiftId, setTimesheetsByShiftId] = useState({});
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState("");

  // ✅ Sort + filters (non-destructive)
  const [sortBy, setSortBy] = useState("dateAsc"); // dateAsc | dateDesc | clientAsc | statusAsc
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const uid = currentUser?.uid || null;

  // ✅ time tick so status labels update as time passes (booked -> submit timesheet, etc.)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  const nowBucket = useMemo(() => Math.floor(now.getTime() / 60_000), [now]);

  // ✅ helper: get a timesheet doc for a shift using BOTH internal docId and public shift code
  function getTimesheetForShift(shift, tsMap) {
    if (!shift || !tsMap) return null;

    // internal shift doc id
    const byDocId = shift.id ? tsMap[shift.id] : null;
    if (byDocId) return byDocId;

    // public shift code (SH-000001) stored on shift as shift.shiftId
    const pub = String(shift.shiftId || "").trim();
    if (pub && tsMap[pub]) return tsMap[pub];

    return null;
  }

  // ✅ LIVE: current and legacy booking ownership fields
  useEffect(() => {
    if (!uid) {
      setBookings([]);
      setTimesheetsByShiftId({});
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");

    const shiftsRef = collection(db, "shifts");

    const userEmail = String(
      currentUser?.email || ""
    ).trim();

    const ownershipQueries = [
      ["bookedBy", uid],
      ["bookedStaffId", uid],
      ["requestedStaffId", uid],
      ["staffBookedBy", uid],
      ["staffBooking.staffId", uid],
      ["staffBooking.uid", uid],
    ];

    if (userEmail) {
      ownershipQueries.push(
        ["bookedStaffEmail", userEmail],
        ["requestedStaffEmail", userEmail],
        ["staffBooking.email", userEmail]
      );
    }

    const state = {
      active: true,
      queryMaps: new Map(),
      pendingShiftListeners:
        ownershipQueries.length,
      timesheetsReady: false,
      shiftUnsubscribers: [],
      timesheetUnsubscriber: null,
    };

    const applyBookings = () => {
      if (!state.active) return;

      const mergedById = new Map();

      state.queryMaps.forEach((resultMap) => {
        resultMap.forEach((shift, id) => {
          mergedById.set(id, shift);
        });
      });

      const merged = [
        ...mergedById.values(),
      ].filter((shift) => {
        const status = String(
          shift.status || ""
        )
          .trim()
          .toLowerCase();

        return status !== "cancelled";
      });

      setBookings(merged);
    };

    const finishLoadingIfReady = () => {
      if (
        state.active &&
        state.pendingShiftListeners === 0 &&
        state.timesheetsReady
      ) {
        setLoading(false);
      }
    };

    ownershipQueries.forEach(
      ([field, value], index) => {
        const key = `${field}:${index}`;
        let initialResultCompleted = false;

        const completeInitialResult = () => {
          if (initialResultCompleted) return;

          initialResultCompleted = true;
          state.pendingShiftListeners =
            Math.max(
              0,
              state.pendingShiftListeners - 1
            );

          finishLoadingIfReady();
        };

        const ownershipQuery = query(
          shiftsRef,
          where(field, "==", value)
        );

        const unsubscribe = onSnapshot(
          ownershipQuery,
          (snapshot) => {
            if (!state.active) return;

            const resultMap = new Map();

            snapshot.docs.forEach((document) => {
              resultMap.set(document.id, {
                id: document.id,
                ...document.data(),
              });
            });

            state.queryMaps.set(
              key,
              resultMap
            );

            applyBookings();
            completeInitialResult();
          },
          (err) => {
            console.error(
              `Bookings listener ${field} error:`,
              err
            );

            if (!state.active) return;

            state.queryMaps.set(
              key,
              new Map()
            );

            setError(
              "Some bookings could not be loaded. Please refresh and try again."
            );

            applyBookings();
            completeInitialResult();
          }
        );

        state.shiftUnsubscribers.push(
          unsubscribe
        );
      }
    );

    const timesheetsRef =
      collection(db, "timesheets");

    const timesheetsQuery = query(
      timesheetsRef,
      where("staffId", "==", uid),
      where(
        "availableAt",
        "<=",
        Timestamp.fromDate(now)
      )
    );

    state.timesheetUnsubscriber = onSnapshot(
      timesheetsQuery,
      (snapshot) => {
        if (!state.active) return;

        const map = {};

        snapshot.docs.forEach((document) => {
          const data = document.data();

          const row = {
            id: document.id,
            ...data,
          };

          const shiftDocumentId = String(
            data.shiftId || ""
          ).trim();

          const shiftPublicId = String(
            data.shiftPublicId || ""
          ).trim();

          if (shiftDocumentId) {
            map[shiftDocumentId] = row;
          }

          if (shiftPublicId) {
            map[shiftPublicId] = row;
          }
        });

        setTimesheetsByShiftId(map);
        state.timesheetsReady = true;
        finishLoadingIfReady();
      },
      (err) => {
        console.error(
          "Timesheets listener error:",
          err
        );

        if (!state.active) return;

        setTimesheetsByShiftId({});
        state.timesheetsReady = true;
        finishLoadingIfReady();
      }
    );

    return () => {
      state.active = false;

      state.shiftUnsubscribers.forEach(
        (unsubscribe) => {
          unsubscribe?.();
        }
      );

      state.timesheetUnsubscriber?.();
    };
  }, [uid, currentUser?.email, nowBucket]);

  const handleCancel = async (shift) => {
    if (!shift?.id) return;

    const startDT = getShiftStartDateTime(shift);
    const hrs = hoursUntil(startDT);

    if (!startDT || hrs == null) {
      alert(
        "We can’t determine this shift start time, so cancellation is disabled. Please contact admin."
      );
      return;
    }

    if (hrs <= 0) {
      alert("You can’t cancel a shift that has already started (or is in the past).");
      return;
    }

    if (hrs < 48) {
      alert(
        "You can’t cancel a booked shift within 48 hours of the start time. Please contact admin."
      );
      return;
    }

    const confirmed = window.confirm("Cancel this booking? This will reopen the shift.");
    if (!confirmed) return;

    setCancellingId(shift.id);
    setError("");

    try {
      const cancelShiftBooking = httpsCallable(
        functions,
        "cancelShiftBookingV2"
      );

      const response = await cancelShiftBooking({
        shiftId: shift.id,
      });

      const result = response?.data || {};

      if (!result.ok) {
        throw new Error(
          result.message ||
          "The booking could not be cancelled."
        );
      }

      alert(
        result.message ||
        "Booking cancelled successfully."
      );

      // The live Firestore listeners will automatically
      // remove the reopened shift from My Bookings.
    } catch (err) {
      console.error(
        "Error cancelling booking:",
        err
      );

      const message =
        err?.details ||
        err?.message ||
        "Could not cancel booking. Please try again.";

      setError(message);
    } finally {
      setCancellingId(null);
    }
  };

  // Client list for filter dropdown
  const clientOptions = useMemo(() => {
    const set = new Set();
    bookings.forEach((s) => set.add(readPlaceName(s)));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [bookings]);

  const filteredAndSortedBookings = useMemo(() => {
    const list = [...bookings].map((shift) => {
      const startDT = getShiftStartDateTime(shift);
      const hrs = hoursUntil(startDT);
      const placeName = readPlaceName(shift);

      // ✅ use tolerant lookup
      const tsDoc = getTimesheetForShift(shift, timesheetsByShiftId);

      const { statusKey } = deriveBadgeAndStatusKey({ shift, hrs, tsDoc });

      return {
        shift,
        startTS: startDT ? startDT.getTime() : 0,
        hrs,
        placeName,
        statusKey,
      };
    });

    const filtered = list.filter((x) => {
      const okClient = clientFilter === "all" ? true : x.placeName === clientFilter;
      const okStatus = statusFilter === "all" ? true : x.statusKey === statusFilter;
      return okClient && okStatus;
    });

    filtered.sort((a, b) => {
      if (sortBy === "dateAsc") return a.startTS - b.startTS;
      if (sortBy === "dateDesc") return b.startTS - a.startTS;
      if (sortBy === "clientAsc") return String(a.placeName).localeCompare(String(b.placeName));
      if (sortBy === "statusAsc") return String(a.statusKey).localeCompare(String(b.statusKey));
      return a.startTS - b.startTS;
    });

    return filtered.map((x) => x.shift);
  }, [bookings, clientFilter, statusFilter, sortBy, timesheetsByShiftId, now]);

  const handleOpenTimesheet = (shift) => {
    const shiftDocumentId = String(
      shift?.id || ""
    ).trim();

    if (!shiftDocumentId) {
      alert(
        "The shift could not be identified. Please refresh and try again."
      );
      return;
    }

    navigate(
      `/timesheets?shiftId=${encodeURIComponent(
        shiftDocumentId
      )}`
    );

    if (
      typeof onOpenTimesheets === "function"
    ) {
      onOpenTimesheets(shiftDocumentId);
    }
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">My Bookings</h2>
        <p className="text-xs text-slate-500">
          Shifts you have booked with Unity Healthcare.
        </p>
      </div>

      {/* ✅ Sort/Filter controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-slate-600">
            Sort by{" "}
            <select
              name="bookingSort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
            >
              <option value="dateAsc">Date (oldest first)</option>
              <option value="dateDesc">Date (newest first)</option>
              <option value="clientAsc">Client (A–Z)</option>
              <option value="statusAsc">Status (A–Z)</option>
            </select>
          </label>

          <label className="text-[11px] text-slate-600">
            Client{" "}
            <select
              name="bookingClientFilter"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
            >
              <option value="all">All</option>
              {clientOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px] text-slate-600">
            Status{" "}
            <select
              name="bookingStatusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="timesheet_submitted">Timesheet submitted</option>
              <option value="submit_timesheet">Submit timesheet</option>
              <option value="pending_admin">Pending admin approval</option>
              <option value="pending">Pending</option>
              <option value="open">Open</option>
              <option value="booked">Booked</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => {
            setSortBy("dateAsc");
            setClientFilter("all");
            setStatusFilter("all");
          }}
          className="self-start sm:self-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Loading your bookings…</div>
      ) : !filteredAndSortedBookings.length ? (
        <div className="text-sm text-slate-600">
          {error
            ? "Bookings could not be displayed."
            : "You have no bookings yet."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredAndSortedBookings.map((shift) => {
            const startDT = getShiftStartDateTime(shift);
            const hrs = hoursUntil(startDT);

            const cancelDisabled =
              cancellingId === shift.id ||
              !startDT ||
              hrs == null ||
              hrs <= 0 ||
              hrs < 48;

            const rateNum = readStaffRate(shift);

            const prettyDate = shift.date?.toDate
              ? shift.date.toDate().toLocaleDateString("en-GB")
              : "";

            const address = readShiftAddress(shift);
            const notes = readShiftNotes(shift);

            const postcode =
              shift.postcode || shift.postCode || "";

            const mapSearch = [address, postcode]
              .filter(Boolean)
              .join(", ");

            const placeName = readPlaceName(shift);

            // ✅ tolerant lookup
            const tsDoc = getTimesheetForShift(shift, timesheetsByShiftId);
            const { badge } = deriveBadgeAndStatusKey({ shift, hrs, tsDoc });

            return (
              <div
                key={shift.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-cyan-300 transition flex flex-col gap-1"
              >
                <details className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900 truncate">
                            {placeName}
                          </h3>
                          <span className="text-slate-400 text-xs select-none group-open:rotate-180 transition inline-flex">
                            ▾
                          </span>
                        </div>

                        {shift.role && (
                          <p className="text-[11px] text-slate-600">
                            Role: <span className="font-semibold">{shift.role}</span>
                          </p>
                        )}
                      </div>

                      <span
                        className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${badge.className}`}
                      >
                        {badge.text}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 mt-1">{prettyDate}</p>

                    <p className="text-xs text-slate-600">
                      {shift.startTime || "?"} – {shift.endTime || "?"}
                    </p>

                    <p className="text-xs text-slate-700">
                      Rate:{" "}
                      <span className="font-semibold">
                        {typeof rateNum === "number" ? `£${rateNum.toFixed(2)}` : "—"}
                      </span>
                      /hr
                    </p>

                    {!cancelDisabled && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        You can cancel up to 48 hours before the shift starts.
                      </p>
                    )}
                    {cancelDisabled && hrs != null && hrs > 0 && hrs < 48 && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        Cancellation locked (less than 48 hours to start).
                      </p>
                    )}
                    {cancelDisabled && hrs != null && hrs <= 0 && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Shift has started / passed — cancellation not available.
                      </p>
                    )}

                    <p className="text-[11px] text-slate-500 mt-2">
                      Click to view shift details
                    </p>
                  </summary>

                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-2">
                      <div className="text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-700">Shift ID:</span>{" "}
                        <span className="font-mono">{shift.shiftId || shift.id}</span>
                      </div>

                      <div className="text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-700">Location:</span>{" "}
                        {placeName}
                      </div>

                      {address ? (
                        <div className="text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">Address:</span>{" "}
                          {address}
                        </div>
                      ) : null}

                      {postcode ? (
                        <div className="text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">
                            Postcode:
                          </span>{" "}
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                              mapSearch
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-cyan-700 underline decoration-cyan-300 underline-offset-2 hover:text-cyan-900"
                            aria-label={`Open ${postcode} in Google Maps`}
                          >
                            {postcode}
                          </a>
                        </div>
                      ) : null}

                      {shift.contactName || shift.siteContactName ? (
                        <div className="text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">Contact:</span>{" "}
                          {shift.contactName || shift.siteContactName}
                          {shift.contactPhone || shift.siteContactPhone
                            ? ` (${shift.contactPhone || shift.siteContactPhone})`
                            : ""}
                        </div>
                      ) : null}

                      {notes ? (
                        <div className="text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">Notes:</span>{" "}
                          {notes}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          No additional notes.
                        </div>
                      )}
                    </div>
                  </div>
                </details>

                <button
                  type="button"
                  onClick={() =>
                    handleOpenTimesheet(shift)
                  }
                  className="mt-3 inline-flex items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-medium text-cyan-800 hover:border-cyan-300 hover:bg-cyan-100"
                >
                  Open timesheets
                </button>

                {!cancelDisabled ? (
                  <button
                    onClick={() => handleCancel(shift)}
                    className="mt-3 inline-flex items-center justify-center rounded-full border border-red-300 bg-red-50 px-3 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                  >
                    Cancel booking
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

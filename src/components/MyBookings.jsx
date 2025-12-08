import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function MyBookings({ currentUser }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState("");

  const loadBookings = async () => {
    if (!currentUser) return;

    setLoading(true);
    setError("");

    try {
      const shiftsRef = collection(db, "shifts");
      const q = query(
        shiftsRef,
        where("bookedBy", "==", currentUser.uid),
        orderBy("date", "asc")
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setBookings(data);
    } catch (err) {
      console.error("Error loading bookings:", err);
      setError(
        "Could not load your bookings. If this keeps happening, an index might be needed in Firestore."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBookings();
  }, [currentUser]);

  const handleCancel = async (bookingId) => {
    if (!window.confirm("Cancel this booking?")) return;

    setCancellingId(bookingId);
    setError("");

    try {
      const shiftRef = doc(db, "shifts", bookingId);
      await updateDoc(shiftRef, {
        status: "open",
        bookedBy: null,
        requestedStaffId: null,
        requestedStaffEmail: null,
      });

      await loadBookings();
      alert("Booking cancelled.");
    } catch (err) {
      console.error("Error cancelling booking:", err);
      setError("Could not cancel booking. Please try again.");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          My Bookings
        </h2>
        <p className="text-xs text-slate-500">
          Shifts you have booked with Unity Healthcare.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">
          Loading your bookings…
        </div>
      ) : !bookings.length ? (
        <div className="text-sm text-slate-600">
          You have no bookings yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {bookings.map((shift) => (
            <div
              key={shift.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-cyan-300 transition flex flex-col gap-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {shift.location}
                  </h3>
                  {shift.role && (
                    <p className="text-[11px] text-slate-600">
                      Role:{" "}
                      <span className="font-semibold">
                        {shift.role}
                      </span>
                    </p>
                  )}
                </div>
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  {shift.status === "pending" ? "Pending" : "Booked"}
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
                <span className="font-semibold">
                  £{shift.hourlyRate}
                </span>
                /hr
              </p>

              <button
                onClick={() => handleCancel(shift.id)}
                disabled={cancellingId === shift.id}
                className="mt-3 inline-flex items-center justify-center rounded-full border border-red-300 bg-red-50 px-4 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                {cancellingId === shift.id
                  ? "Cancelling…"
                  : "Cancel booking"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

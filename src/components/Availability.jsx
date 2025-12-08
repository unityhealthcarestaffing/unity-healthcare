/* src/components/Availability.jsx */
import { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function Availability({ currentUser }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [date, setDate] = useState("");
  const [shiftType, setShiftType] = useState("Day");
  const [notes, setNotes] = useState("");

  const loadAvailability = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError("");

    try {
      const ref = collection(db, "availability");
      // no orderBy => avoids Firestore composite index errors
      const q = query(ref, where("staffId", "==", currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setEntries(data);
    } catch (err) {
      console.error("Error loading availability:", err);
      setError(
        "Could not load availability from the server. You can still add a new entry below."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAvailability();
  }, [currentUser]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    if (!date) {
      setError("Please choose a date for your availability.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const d = new Date(date);
      d.setHours(0, 0, 0, 0);

      await addDoc(collection(db, "availability"), {
        staffId: currentUser.uid,
        staffEmail: currentUser.email || null,
        date: Timestamp.fromDate(d),
        shiftType,
        notes: notes || null,
        createdAt: Timestamp.now(),
      });

      setDate("");
      setShiftType("Day");
      setNotes("");

      await loadAvailability();
      alert("Availability saved.");
    } catch (err) {
      console.error("Error saving availability:", err);
      setError("Could not save availability. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          My Availability
        </h2>
        <p className="text-sm text-slate-500">
          Let Unity know when you are free to work.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h3 className="text-base font-semibold text-slate-900">
          Add availability
        </h3>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-2 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Shift type
            </label>
            <select
              value={shiftType}
              onChange={(e) => setShiftType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
            >
              <option value="Day">Day</option>
              <option value="Night">Night</option>
              <option value="Either">Either</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-700 focus:ring-1 focus:ring-cyan-300"
              placeholder="e.g. I can only work after 7pm, childcare days, preferred locations…"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save availability"}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-base font-semibold text-slate-900">
          My availability entries
        </h3>

        {loading ? (
          <div className="text-sm text-slate-600">Loading…</div>
        ) : !entries.length ? (
          <div className="text-sm text-slate-600">
            You have not added any availability yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="space-y-1 rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
              >
                <p className="font-semibold text-slate-900">
                  {entry.date?.toDate
                    ? entry.date.toDate().toLocaleDateString()
                    : ""}
                </p>
                {entry.shiftType && (
                  <p className="text-slate-700">
                    Shift:{" "}
                    <span className="font-semibold">
                      {entry.shiftType}
                    </span>
                  </p>
                )}
                {entry.notes && (
                  <p className="text-slate-600">Notes: {entry.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

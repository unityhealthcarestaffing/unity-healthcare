// src/components/ClientUploadShift.jsx
import { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  Timestamp,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

/**
 * This upgraded module supports:
 *  1. Single shift upload
 *  2. Multi-day shift upload
 *  3. Weekly templates (Mon–Sun)
 *  4. Repeating patterns (every X day/week)
 *
 * It auto-fills details using the client's profile from Firestore.
 */

export default function ClientUploadShift({ currentUser, onCreated }) {
  const [activeTab, setActiveTab] = useState("single");

  // 🔵 Loaded Client Profile
  const [clientProfile, setClientProfile] = useState(null);
  const [prefillError, setPrefillError] = useState("");

  // 🔵 Single Shift Fields
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [landmark, setLandmark] = useState(""); // matches Firestore field
  const [role, setRole] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");

  // 🔵 Multi-day Fields
  const [multiStart, setMultiStart] = useState("");
  const [multiEnd, setMultiEnd] = useState("");

  // 🔵 Repeating Pattern Fields
  const [repeatDay, setRepeatDay] = useState("monday");
  const [repeatWeeks, setRepeatWeeks] = useState(1);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ===============================================
  // 🔵 Load client profile for auto-prefill
  // ===============================================
  useEffect(() => {
    const fetchClient = async () => {
      if (!currentUser) return;

      try {
        const ref = doc(db, "clients", currentUser.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setPrefillError("Could not load saved client details.");
          return;
        }

        const data = snap.data();
        setClientProfile(data);

        // Prefill fields using EXACT Firestore fields
        setLocation(
          (prev) => prev || data.organisationName || ""
        );
        setAddress(
          (prev) => prev || data.organisationAddress || ""
        );
        setPostcode(
          (prev) => prev || data.organisationPostcode || ""
        );
        setLandmark(
          (prev) => prev || data.landmark || ""
        );
      } catch (err) {
        setPrefillError("Prefill failed. Fill form manually.");
      }
    };

    fetchClient();
  }, [currentUser]);

  // ======================================================
  // 🔵 Validation Helper
  // ======================================================
  const validateShift = () => {
    if (!location || !date || !startTime || !endTime || !role) {
      return "Please complete all required fields.";
    }

    if (Number.isNaN(Number(hourlyRate)) || hourlyRate <= 0) {
      return "Hourly rate must be a valid number.";
    }

    if (new Date(date) < new Date().setHours(0, 0, 0, 0)) {
      return "Shift date cannot be in the past.";
    }

    if (endTime <= startTime) {
      return "End time must be later than start time.";
    }

    return null;
  };

  // ======================================================
  // 🔵 Create a shift document
  // ======================================================
  const createShift = async (shiftDate) => {
    return addDoc(collection(db, "shifts"), {
      // required fields
      clientId: currentUser.uid,
      clientEmail: currentUser.email,
      date: Timestamp.fromDate(new Date(shiftDate)),
      startTime,
      endTime,
      hourlyRate: Number(hourlyRate),
      role,
      status: "open",

      // auto-filled client details
      location,
      address: address || null,
      postcode: postcode || null,
      landmarks: landmark || null,

      // reporting metadata
      createdAt: Timestamp.now(),
      createdBy: currentUser.uid,
      clientOrganisation: clientProfile?.organisationName || null,
      clientName: clientProfile?.contactName || null,
    });
  };

  // ======================================================
  // 🔵 SINGLE SHIFT SUBMIT
  // ======================================================
  const submitSingle = async (e) => {
    e.preventDefault();
    setError("");

    const validation = validateShift();
    if (validation) {
      setError(validation);
      return;
    }

    try {
      setSaving(true);
      await createShift(date);
      onCreated?.();
      alert("Shift created.");
      resetForm();
    } catch (err) {
      setError("Could not create shift.");
    } finally {
      setSaving(false);
    }
  };

  // ======================================================
  // 🔵 MULTI-DAY SUBMIT
  // ======================================================
  const submitMulti = async (e) => {
    e.preventDefault();
    setError("");

    const validation = validateShift();
    if (validation) {
      setError(validation);
      return;
    }

    const start = new Date(multiStart);
    const end = new Date(multiEnd);

    if (isNaN(start) || isNaN(end) || end < start) {
      setError("Invalid date range.");
      return;
    }

    try {
      setSaving(true);

      const days = [];
      let d = new Date(start);
      while (d <= end) {
        days.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }

      for (const d of days) {
        await createShift(d);
      }

      onCreated?.();
      alert(`Created ${days.length} shifts.`);
      resetForm();
    } catch (err) {
      setError("Could not create multi-day shifts.");
    } finally {
      setSaving(false);
    }
  };

  // ======================================================
  // 🔵 REPEATING PATTERN SUBMIT
  // ======================================================
  const submitRepeating = async (e) => {
    e.preventDefault();
    setError("");

    const validation = validateShift();
    if (validation) {
      setError(validation);
      return;
    }

    const daysMap = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
      sunday: 0,
    };

    const targetDay = daysMap[repeatDay];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the next occurrence of the chosen weekday
    let next = new Date(today);
    while (next.getDay() !== targetDay) {
      next.setDate(next.getDate() + 1);
    }

    try {
      setSaving(true);

      const created = [];
      for (let i = 0; i < repeatWeeks; i++) {
        const shiftDate = new Date(next);
        shiftDate.setDate(next.getDate() + i * 7);
        await createShift(shiftDate);
        created.push(shiftDate);
      }

      onCreated?.();
      alert(`Created ${created.length} weekly recurring shifts.`);
      resetForm();
    } catch (err) {
      setError("Repeating pattern failed.");
    } finally {
      setSaving(false);
    }
  };

  // ======================================================
  // 🔵 RESET FORM
  // ======================================================
  const resetForm = () => {
    setDate("");
    setStartTime("");
    setEndTime("");
    setHourlyRate("");
  };

  // ======================================================
  // 🔵 UI
  // ======================================================
  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Create Shifts</h2>

      {prefillError && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
          {prefillError}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-300 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {["single", "multi", "repeat"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs rounded-full ${
              activeTab === tab
                ? "bg-cyan-700 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            {tab === "single" && "Single Shift"}
            {tab === "multi" && "Multi-Day"}
            {tab === "repeat" && "Repeating Pattern"}
          </button>
        ))}
      </div>

      {/* Common Fields */}
      <div className="space-y-2 text-xs bg-slate-50 p-3 rounded-md border border-slate-200">
        <div>
          <label>Location (Ward)</label>
          <input
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div>
          <label>Address</label>
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div>
          <label>Postcode</label>
          <input
            className="input"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </div>

        <div>
          <label>Landmark</label>
          <input
            className="input"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
          />
        </div>

        <div>
          <label>Role (required)</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">Select role</option>
            <option value="HCA">Healthcare Assistant (HCA)</option>
            <option value="Support Worker">Support Worker</option>
            <option value="Nurse">Nurse</option>
            <option value="RGN">Registered General Nurse (RGN)</option>
            <option value="RMN">Registered Mental Health Nurse (RMN)</option>
          </select>
        </div>

        <div>
          <label>Hourly rate (£)</label>
          <input
            type="number"
            className="input"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
          />
        </div>
      </div>

      {/* TAB 1 — Single */}
      {activeTab === "single" && (
        <form onSubmit={submitSingle} className="space-y-2 text-xs">
          <div>
            <label>Date</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label>Start</label>
              <input
                type="time"
                className="input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label>End</label>
              <input
                type="time"
                className="input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <button
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? "Saving…" : "Create Shift"}
          </button>
        </form>
      )}

      {/* TAB 2 — Multi */}
      {activeTab === "multi" && (
        <form onSubmit={submitMulti} className="space-y-2 text-xs">
          <div>
            <label>Start Date</label>
            <input
              type="date"
              className="input"
              value={multiStart}
              onChange={(e) => setMultiStart(e.target.value)}
            />
          </div>
          <div>
            <label>End Date</label>
            <input
              type="date"
              className="input"
              value={multiEnd}
              onChange={(e) => setMultiEnd(e.target.value)}
            />
          </div>

          <button disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Create Multiple Shifts"}
          </button>
        </form>
      )}

      {/* TAB 3 — Repeating */}
      {activeTab === "repeat" && (
        <form onSubmit={submitRepeating} className="space-y-2 text-xs">
          <div>
            <label>Repeat every:</label>
            <select
              className="input"
              value={repeatDay}
              onChange={(e) => setRepeatDay(e.target.value)}
            >
              <option value="monday">Monday</option>
              <option value="tuesday">Tuesday</option>
              <option value="wednesday">Wednesday</option>
              <option value="thursday">Thursday</option>
              <option value="friday">Friday</option>
              <option value="saturday">Saturday</option>
              <option value="sunday">Sunday</option>
            </select>
          </div>

          <div>
            <label>For how many weeks?</label>
            <input
              type="number"
              className="input"
              value={repeatWeeks}
              min="1"
              max="26"
              onChange={(e) => setRepeatWeeks(e.target.value)}
            />
          </div>

          <button disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Create Recurring Shifts"}
          </button>
        </form>
      )}
    </div>
  );
}

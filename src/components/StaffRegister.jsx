// src/components/StaffRegister.jsx
import { useState } from "react";
import { auth, db } from "../firebaseConfig";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, Timestamp } from "firebase/firestore";

export default function StaffRegister() {
  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setOk("");

    // Mandatory fields
    if (
      !fullName ||
      !address ||
      !postcode ||
      !phone ||
      !role ||
      !email ||
      !password
    ) {
      setError("Please complete all required fields.");
      return;
    }

    try {
      setSaving(true);

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      await setDoc(doc(db, "users", uid), {
        role: "staff",
        fullName,
        homeAddress: address,
        postcode,
        phone,
        staffRole: role,
        email,
        status: "pending",
        isActive: false,
        createdAt: Timestamp.now(),
      });

      setOk("Staff registered. Unity admin will verify and activate your account.");
      setFullName("");
      setAddress("");
      setPostcode("");
      setPhone("");
      setRole("");
      setEmail("");
      setPassword("");
    } catch (err) {
      console.error("Staff registration error:", err);
      setError("Registration failed. Email may already exist.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-sm md:text-base">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-lg">
          {ok}
        </div>
      )}

      <div>
        <label className="font-medium text-sm">Full Name *</label>
        <input
          className="uh-input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      <div>
        <label className="font-medium text-sm">Home Address *</label>
        <input
          className="uh-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>

      <div>
        <label className="font-medium text-sm">Postcode *</label>
        <input
          className="uh-input"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
        />
      </div>

      <div>
        <label className="font-medium text-sm">Phone Number *</label>
        <input
          className="uh-input"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div>
        <label className="font-medium text-sm">Role *</label>
        <select
          className="uh-input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">Select role</option>
          <option value="Nurse">Nurse</option>
          <option value="HCA">Healthcare Assistant</option>
          <option value="Support Worker">Support Worker</option>
          <option value="RGN">RGN</option>
          <option value="RMN">RMN</option>
        </select>
      </div>

      <div>
        <label className="font-medium text-sm">Email *</label>
        <input
          className="uh-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="font-medium text-sm">Password *</label>
        <input
          className="uh-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button
        disabled={saving}
        className="w-full bg-cyan-700 text-white py-2 rounded-lg font-semibold hover:bg-cyan-800 disabled:opacity-60"
      >
        {saving ? "Registering…" : "Register Staff"}
      </button>
    </form>
  );
}

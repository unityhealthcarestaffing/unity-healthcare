// src/components/ClientOnboarding.jsx
import { useMemo, useState } from "react";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { signOut } from "firebase/auth";
import { auth, db, storage } from "../firebaseConfig";

const BUSINESS_TYPES = [
  "Care Home",
  "Nursing Home",
  "Supported Living",
  "Domiciliary Care",
  "Hospital / NHS",
  "Private Clinic",
  "Residential School",
  "Other",
];

const SERVICES_NEEDED = [
  "Healthcare Assistants (HCA)",
  "Support Workers",
  "Registered Nurses (RGN)",
  "Mental Health Nurses (RMN)",
  "Specialist Support",
  "Other",
];

const BILLING_OPTIONS = ["Weekly", "Fortnightly", "Monthly", "Other"];
const TOTAL_STEPS = 3;

/**
 * Deterministic 4-digit code from UID.
 * No extra collections, no reads for uniqueness.
 */
function codeFromUid(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return String(1000 + (h % 9000)); // 1000–9999
}

export default function ClientOnboarding({ currentUser }) {
  const user = currentUser || auth.currentUser;

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const [files, setFiles] = useState({
    cqc: null,
    insurance: null,
    idProof: null,
    contract: null,
    other: null,
  });

  const [form, setForm] = useState({
    organisationName: "",
    tradingName: "",
    businessType: "",
    companyNumber: "",
    website: "",

    addressLine1: "",
    addressLine2: "",
    cityTown: "",
    county: "",
    postcode: "",
    landmark: "",

    contactName: "",
    contactRole: "",
    contactEmail: "",
    contactPhone: "",

    invoiceEmail: "",
    invoiceAddressSameAsOrg: "yes",
    invoiceAddressLine1: "",
    invoiceAddressLine2: "",
    invoiceCityTown: "",
    invoiceCounty: "",
    invoicePostcode: "",
    billingCycle: "Weekly",
    poNumber: "",

    servicesNeeded: [],
    approxShiftsPerWeek: "",
    notes: "",

    // ✅ NEW: proposed rates per role (must be filled for selected services)
    proposedRates: {}, // { [serviceName]: "23" }
  });

  const progress = useMemo(() => (step / TOTAL_STEPS) * 100, [step]);

  const handleChange = (field, value) =>
    setForm((p) => ({ ...p, [field]: value }));

  const toggleService = (name) => {
    setForm((p) => {
      const exists = p.servicesNeeded.includes(name);
      const nextServices = exists
        ? p.servicesNeeded.filter((x) => x !== name)
        : [...p.servicesNeeded, name];

      // Keep proposedRates tidy: remove rate when service is unselected
      const nextRates = { ...(p.proposedRates || {}) };
      if (exists) {
        delete nextRates[name];
      }

      return {
        ...p,
        servicesNeeded: nextServices,
        proposedRates: nextRates,
      };
    });
  };

  const handleProposedRateChange = (service, value) => {
    // Keep as string but numeric-ish
    const cleaned = String(value ?? "").replace(/[^\d.]/g, "");
    setForm((p) => ({
      ...p,
      proposedRates: { ...(p.proposedRates || {}), [service]: cleaned },
    }));
  };

  const handleFile = (key, file) => setFiles((p) => ({ ...p, [key]: file || null }));

  const goNext = () => step < TOTAL_STEPS && setStep((s) => s + 1);
  const goBack = () => step > 1 && setStep((s) => s - 1);

  const uploadFileToStorage = async (uid, folder, file) => {
    if (!file) return null;

    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const path = `clientOnboarding/${uid}/${folder}/${Date.now()}-${safeName}`;

    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const validateStep = () => {
    if (step === 1) {
      if (!form.organisationName?.trim()) return "Please enter organisation name.";
      if (!form.businessType) return "Please select business type.";
      if (!form.contactName?.trim() || !form.contactPhone?.trim())
        return "Please provide contact name and phone.";
      return "";
    }
    if (step === 2) {
      if (!form.addressLine1?.trim() || !form.cityTown?.trim() || !form.postcode?.trim())
        return "Please complete address line 1, city/town and postcode.";
      return "";
    }
    if (step === 3) {
      if (!form.invoiceEmail?.trim()) return "Please provide an invoice email address.";
      if (!form.servicesNeeded.length) return "Please select at least one service needed.";

      // ✅ NEW: proposed rate per selected service is mandatory
      const rates = form.proposedRates || {};
      const missing = form.servicesNeeded.filter((s) => {
        const v = String(rates[s] ?? "").trim();
        if (!v) return true;
        const n = Number(v);
        return !Number.isFinite(n) || n <= 0;
      });

      if (missing.length) {
        return `Please enter your proposed hourly rate for: ${missing.join(", ")}.`;
      }

      return "";
    }
    return "";
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    const liveUser = auth.currentUser;

    if (!liveUser?.uid) {
      setError("Session not found. Please sign out and sign in again.");
      return;
    }

    const uid = liveUser.uid;
    const email = liveUser.email; // ✅ always use auth email

    if (!email) {
      setError("Your account has no email address. Please sign out and sign in again.");
      return;
    }

    const stepError = validateStep();
    if (stepError) {
      setError(stepError);
      return;
    }

    // Only require verification if uploading files
    const anyFileSelected = Object.values(files).some(Boolean);
    if (anyFileSelected && !liveUser.emailVerified) {
      setError(
        "Please verify your email before uploading documents. If you want to submit without documents, remove the selected files and try again."
      );
      return;
    }

    try {
      setSaving(true);

      // 1) Get existing clientCode (IMPORTANT: DO NOT pad/modify it)
      const clientRef = doc(db, "clients", uid);
      let existingClientCode = null;

      try {
        const clientSnap = await getDoc(clientRef);
        existingClientCode = clientSnap.exists() ? clientSnap.data()?.clientCode : null;
      } catch (readErr) {
        // If rules block reading, we can still continue with computed code
        console.warn("Could not read clients/{uid} (continuing):", readErr);
      }

      const clientCode =
        existingClientCode && String(existingClientCode).trim()
          ? String(existingClientCode).trim()
          : codeFromUid(uid);

      // 2) Upload docs (optional)
      const [cqcUrl, insuranceUrl, idProofUrl, contractUrl, otherUrl] = await Promise.all([
        uploadFileToStorage(uid, "cqc", files.cqc),
        uploadFileToStorage(uid, "insurance", files.insurance),
        uploadFileToStorage(uid, "idProof", files.idProof),
        uploadFileToStorage(uid, "contract", files.contract),
        uploadFileToStorage(uid, "other", files.other),
      ]);

      const orgAddress = {
        addressLine1: form.addressLine1?.trim(),
        addressLine2: form.addressLine2?.trim() || "",
        cityTown: form.cityTown?.trim(),
        county: form.county?.trim() || "",
        postcode: form.postcode?.trim(),
        landmark: form.landmark?.trim() || "",
      };

      const invoiceSame = form.invoiceAddressSameAsOrg === "yes";
      const invoiceAddress = invoiceSame
        ? orgAddress
        : {
            addressLine1: form.invoiceAddressLine1?.trim(),
            addressLine2: form.invoiceAddressLine2?.trim() || "",
            cityTown: form.invoiceCityTown?.trim(),
            county: form.invoiceCounty?.trim() || "",
            postcode: form.invoicePostcode?.trim(),
            landmark: "",
          };

      // ✅ NEW: store proposed rates only for selected services
      const proposedRatesClean = {};
      for (const s of form.servicesNeeded) {
        const raw = String(form.proposedRates?.[s] ?? "").trim();
        proposedRatesClean[s] = raw;
      }

      // ✅ 3) CLIENT DOC WRITE (keep it clean; no admin fields)
      const clientPayload = {
        uid,
        email,
        accountType: "client",
        clientCode, // set-once style

        organisationName: form.organisationName?.trim(),
        tradingName: form.tradingName?.trim() || "",
        businessType: form.businessType,
        companyNumber: form.companyNumber?.trim() || "",
        website: form.website?.trim() || "",

        contact: {
          name: form.contactName?.trim(),
          role: form.contactRole?.trim() || "",
          email: form.contactEmail?.trim() || email,
          phone: form.contactPhone?.trim(),
        },

        organisationAddress: orgAddress,
        invoiceAddress,
        invoiceEmail: form.invoiceEmail?.trim(),
        billingCycle: form.billingCycle,
        poNumber: form.poNumber?.trim() || "",

        servicesNeeded: form.servicesNeeded,
        // ✅ NEW: proposed rates per role (client submitted)
        proposedRates: proposedRatesClean,
        // ✅ NEW: admin will approve / review (no admin fields written here)
        ratesStatus: "pending_admin_review",

        approxShiftsPerWeek: String(form.approxShiftsPerWeek || "").trim(),
        notes: form.notes?.trim() || "",

        documents: {
          cqcUrl,
          insuranceUrl,
          idProofUrl,
          contractUrl,
          otherUrl,
        },

        registrationCompleted: true,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(clientRef, clientPayload, { merge: true });
      } catch (clientWriteErr) {
        console.error("Blocked writing clients/{uid}:", clientWriteErr);
        const c = String(clientWriteErr?.code || "");
        throw new Error(
          c.includes("permission-denied")
            ? "Firestore blocked writing your client profile (clients/{uid}). Please publish your Firestore Rules and sign out/in, then try again."
            : "Could not save your client profile. Please try again."
        );
      }

      // ✅ 4) USERS MIRROR (non-blocking; do not break registration)
      try {
        const userRef = doc(db, "users", uid);
        await setDoc(
          userRef,
          {
            uid,
            email,
            role: "client",
            clientCode,
            organisationName: form.organisationName?.trim(),
            clientOnboardingCompleted: true,
            // optional mirror for admin convenience
            proposedRates: proposedRatesClean,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (usersWriteErr) {
        console.warn("Could not update users/{uid} (ignored):", usersWriteErr);
      }

      setDone(true);
    } catch (err) {
      console.error("Client onboarding submit error:", err);

      const msg =
        String(err?.message || "").trim() ||
        "Could not submit your registration. Please check your internet and try again.";

      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleReturnToLogin = async () => {
    try {
      await signOut(auth);
    } finally {
      window.location.href = "/";
    }
  };

  if (done) {
    return (
      <div className="min-h-dvh bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold text-slate-900">Registration submitted</h1>
          <p className="text-sm text-slate-600">
            Thanks — your client registration has been submitted. An admin must approve your
            account before you can create shifts.
          </p>
          <button
            type="button"
            onClick={handleReturnToLogin}
            className="mt-2 w-full py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
          >
            Return to login
          </button>
          <p className="text-xs text-slate-500">After approval, you can sign in again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-sm p-6 md:p-8 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900">Client registration</h1>
            <p className="text-xs text-slate-500 mt-1">
              Complete the form below. Your account stays <strong>blocked</strong> until admin
              approval.
            </p>
          </div>

          <button
            type="button"
            onClick={handleReturnToLogin}
            className="text-xs text-slate-600 hover:text-slate-900 underline"
          >
            Return to login
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Step {step} of {TOTAL_STEPS}
            </span>
            <span>
              {step === 1 && "Organisation & contact"}
              {step === 2 && "Address & billing"}
              {step === 3 && "Services & documents"}
            </span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-2 bg-cyan-700 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-6">
          {step === 1 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Organisation name *
                </label>
                <input
                  className="uh-input"
                  value={form.organisationName}
                  onChange={(e) => handleChange("organisationName", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Trading name (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.tradingName}
                  onChange={(e) => handleChange("tradingName", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Business type *
                </label>
                <select
                  className="uh-input bg-white"
                  value={form.businessType}
                  onChange={(e) => handleChange("businessType", e.target.value)}
                >
                  <option value="">Select type</option>
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Company number (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.companyNumber}
                  onChange={(e) => handleChange("companyNumber", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Website (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.website}
                  onChange={(e) => handleChange("website", e.target.value)}
                  placeholder="https://"
                />
              </div>

              <div className="md:col-span-2 pt-2">
                <p className="text-xs font-semibold text-slate-800">Main contact</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contact name *
                </label>
                <input
                  className="uh-input"
                  value={form.contactName}
                  onChange={(e) => handleChange("contactName", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contact role (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.contactRole}
                  onChange={(e) => handleChange("contactRole", e.target.value)}
                  placeholder="e.g. Manager"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contact email (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.contactEmail}
                  onChange={(e) => handleChange("contactEmail", e.target.value)}
                  placeholder={auth.currentUser?.email || "email"}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Contact phone *
                </label>
                <input
                  className="uh-input"
                  value={form.contactPhone}
                  onChange={(e) => handleChange("contactPhone", e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <p className="text-xs font-semibold text-slate-800">Organisation address</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Address line 1 *
                </label>
                <input
                  className="uh-input"
                  value={form.addressLine1}
                  onChange={(e) => handleChange("addressLine1", e.target.value)}
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Address line 2 (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.addressLine2}
                  onChange={(e) => handleChange("addressLine2", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  City/Town *
                </label>
                <input
                  className="uh-input"
                  value={form.cityTown}
                  onChange={(e) => handleChange("cityTown", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  County (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.county}
                  onChange={(e) => handleChange("county", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Postcode *
                </label>
                <input
                  className="uh-input"
                  value={form.postcode}
                  onChange={(e) => handleChange("postcode", e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Landmark (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.landmark}
                  onChange={(e) => handleChange("landmark", e.target.value)}
                  placeholder="e.g. near Tesco / next to..."
                />
              </div>

              <div className="md:col-span-2 pt-2">
                <p className="text-xs font-semibold text-slate-800">Billing</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Invoice email *
                </label>
                <input
                  className="uh-input"
                  value={form.invoiceEmail}
                  onChange={(e) => handleChange("invoiceEmail", e.target.value)}
                  placeholder="finance@organisation.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Billing cycle
                </label>
                <select
                  className="uh-input bg-white"
                  value={form.billingCycle}
                  onChange={(e) => handleChange("billingCycle", e.target.value)}
                >
                  {BILLING_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Is invoice address same as organisation address?
                </label>
                <select
                  className="uh-input bg-white"
                  value={form.invoiceAddressSameAsOrg}
                  onChange={(e) =>
                    handleChange("invoiceAddressSameAsOrg", e.target.value)
                  }
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              {form.invoiceAddressSameAsOrg === "no" && (
                <>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Invoice address line 1 *
                    </label>
                    <input
                      className="uh-input"
                      value={form.invoiceAddressLine1}
                      onChange={(e) =>
                        handleChange("invoiceAddressLine1", e.target.value)
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Invoice address line 2 (optional)
                    </label>
                    <input
                      className="uh-input"
                      value={form.invoiceAddressLine2}
                      onChange={(e) =>
                        handleChange("invoiceAddressLine2", e.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Invoice City/Town *
                    </label>
                    <input
                      className="uh-input"
                      value={form.invoiceCityTown}
                      onChange={(e) =>
                        handleChange("invoiceCityTown", e.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Invoice County (optional)
                    </label>
                    <input
                      className="uh-input"
                      value={form.invoiceCounty}
                      onChange={(e) =>
                        handleChange("invoiceCounty", e.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Invoice Postcode *
                    </label>
                    <input
                      className="uh-input"
                      value={form.invoicePostcode}
                      onChange={(e) =>
                        handleChange("invoicePostcode", e.target.value)
                      }
                    />
                  </div>
                </>
              )}

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Purchase Order number (optional)
                </label>
                <input
                  className="uh-input"
                  value={form.poNumber}
                  onChange={(e) => handleChange("poNumber", e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-800">Services needed *</p>
                <p className="text-[11px] text-slate-500 mt-1">Select all that apply.</p>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {SERVICES_NEEDED.map((s) => {
                    const checked = form.servicesNeeded.includes(s);
                    return (
                      <label
                        key={s}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer ${
                          checked ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleService(s)} />
                        <span className="text-slate-700">{s}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* ✅ NEW: Proposed rates block (mandatory for selected services) */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-800">Proposed hourly rates *</p>
                <p className="text-[11px] text-slate-600 mt-1">
                  Our typical rates range from <strong>£21 to £40</strong> per hour depending on requirements.
                  Please enter your <strong>proposed hourly rate</strong> for each selected role below.
                </p>
                <p className="text-[11px] text-slate-600 mt-1">
                  If the proposed rate is approved by admin, it becomes <strong>binding</strong> as part of your contract.
                  If it is not acceptable, we will review and contact you.
                </p>

                {!form.servicesNeeded.length ? (
                  <div className="mt-3 text-xs text-slate-500">
                    Select at least one service above to enter rates.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {form.servicesNeeded.map((service) => (
                      <div
                        key={service}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          {service} — proposed rate (£/hr) *
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-600">£</span>
                          <input
                            className="uh-input"
                            inputMode="decimal"
                            value={form.proposedRates?.[service] ?? ""}
                            onChange={(e) => handleProposedRateChange(service, e.target.value)}
                            placeholder="e.g. 25"
                            aria-label={`${service} proposed hourly rate`}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Enter a positive number (e.g. 21, 28.5).
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Approx shifts per week (optional)
                  </label>
                  <input
                    className="uh-input"
                    value={form.approxShiftsPerWeek}
                    onChange={(e) => handleChange("approxShiftsPerWeek", e.target.value)}
                    placeholder="e.g. 10"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    className="uh-input min-h-[90px]"
                    value={form.notes}
                    onChange={(e) => handleChange("notes", e.target.value)}
                    placeholder="Any requirements, shift patterns, specialisms..."
                  />
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
                <p className="text-xs font-semibold text-slate-800">Upload documents (recommended)</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Upload what you have now. You can also email documents later.
                </p>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <FileInput
                    label="CQC certificate (optional)"
                    accept="image/*,.pdf"
                    onChange={(f) => handleFile("cqc", f)}
                  />
                  <FileInput
                    label="Insurance certificate (optional)"
                    accept="image/*,.pdf"
                    onChange={(f) => handleFile("insurance", f)}
                  />
                  <FileInput
                    label="ID proof (optional)"
                    accept="image/*,.pdf"
                    onChange={(f) => handleFile("idProof", f)}
                  />
                  <FileInput
                    label="Signed contract (optional)"
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(f) => handleFile("contract", f)}
                  />
                  <FileInput
                    label="Other document (optional)"
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(f) => handleFile("other", f)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleReturnToLogin}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              ← Return to login
            </button>

            <div className="flex gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="px-4 py-2 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50"
                >
                  Back
                </button>
              )}

              {step < TOTAL_STEPS && (
                <button
                  type="button"
                  onClick={() => {
                    const stepError = validateStep();
                    if (stepError) setError(stepError);
                    else {
                      setError("");
                      goNext();
                    }
                  }}
                  className="px-4 py-2 rounded-full bg-cyan-700 text-white text-xs font-semibold hover:bg-cyan-800"
                >
                  Next
                </button>
              )}

              {step === TOTAL_STEPS && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? "Submitting…" : "Submit registration"}
                </button>
              )}
            </div>
          </div>
        </form>

        <style>{`
          .uh-input {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            outline: none;
            font-size: 0.9rem;
            background: white;
          }
          .uh-input:focus {
            border-color: #0e7490;
            box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.25);
          }
        `}</style>
      </div>
    </div>
  );
}

function FileInput({ label, accept, onChange }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-white hover:file:bg-slate-50"
      />
    </div>
  );
}

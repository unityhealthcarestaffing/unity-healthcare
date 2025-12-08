// src/components/StaffOnboarding.jsx
import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebaseConfig";
import { useNavigate } from "react-router-dom";

const TOTAL_STEPS = 4;

export default function StaffOnboarding() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [form, setForm] = useState({
    // STEP 1 – Eligibility & personal
    fullName: "",
    email: "",
    phone: "",
    roleApplied: "",
    has3MonthsExperience: "",
    rightToWorkStatus: "",
    niNumber: "",
    // STEP 2 – Experience & availability
    experienceSummary: "",
    totalExperienceMonths: "",
    currentRole: "",
    availability: "",
    preferredLocations: "",
    canWorkNights: "",
    canDrive: "",
    // STEP 3 – Referee
    refereeName: "",
    refereeEmail: "",
    refereePhone: "",
    refereeRelationship: "",
    // Internal helper
    heardAboutUs: "",
  });

  const [files, setFiles] = useState({
    cvFile: null,
    rightToWorkFile: null,
    dbsFile: null,
    trainingFile: null,
  });

  const progress = (step / TOTAL_STEPS) * 100;

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (field, file) => {
    setFiles((prev) => ({ ...prev, [field]: file }));
  };

  const goNext = () => {
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };

  const goBack = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const uploadFileToStorage = async (folder, file) => {
    if (!file) return null;
    const path = `${folder}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  const validateBeforeSubmit = () => {
    if (!form.fullName || !form.email || !form.phone) {
      return "Please complete your name, email and phone number.";
    }
    if (!form.roleApplied) {
      return "Please select the role you are applying for.";
    }
    if (!form.has3MonthsExperience) {
      return "Please confirm whether you have at least 3 months experience.";
    }
    if (!form.refereeName || !form.refereeEmail) {
      return "Please provide your referee’s name and email.";
    }
    if (!files.cvFile) {
      return "Please upload your CV.";
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    try {
      setSubmitting(true);

      // Upload documents to storage
      const [cvUrl, rtWorkUrl, dbsUrl, trainingUrl] = await Promise.all([
        uploadFileToStorage("staffApplications/cv", files.cvFile),
        uploadFileToStorage("staffApplications/rightToWork", files.rightToWorkFile),
        uploadFileToStorage("staffApplications/dbs", files.dbsFile),
        uploadFileToStorage("staffApplications/training", files.trainingFile),
      ]);

      const payload = {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        roleApplied: form.roleApplied,
        has3MonthsExperience: form.has3MonthsExperience,
        rightToWorkStatus: form.rightToWorkStatus || null,
        niNumber: form.niNumber || null,
        experienceSummary: form.experienceSummary || null,
        totalExperienceMonths: form.totalExperienceMonths || null,
        currentRole: form.currentRole || null,
        availability: form.availability || null,
        preferredLocations: form.preferredLocations || null,
        canWorkNights: form.canWorkNights || null,
        canDrive: form.canDrive || null,
        refereeName: form.refereeName,
        refereeEmail: form.refereeEmail,
        refereePhone: form.refereePhone || null,
        refereeRelationship: form.refereeRelationship || null,
        heardAboutUs: form.heardAboutUs || null,
        documents: {
          cvUrl,
          rightToWorkUrl: rtWorkUrl,
          dbsUrl,
          trainingUrl,
        },
        status: "new", // for admin to triage
        createdAt: serverTimestamp(),
        source: "website",
      };

      const docRef = await addDoc(
        collection(db, "staffApplications"),
        payload
      );

      // Optional: call backend to send referee email if you configure it
      const refereeFunctionUrl =
        import.meta.env.VITE_REFEREE_EMAIL_FUNCTION_URL || "";
      if (refereeFunctionUrl && form.refereeEmail) {
        try {
          await fetch(refereeFunctionUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              applicationId: docRef.id,
              applicantName: form.fullName,
              refereeName: form.refereeName,
              refereeEmail: form.refereeEmail,
            }),
          });
        } catch (err) {
          console.warn("Referee email function failed (non-blocking):", err);
        }
      }

      setSubmitSuccess(true);
    } catch (err) {
      console.error("Error submitting staff application:", err);
      setSubmitError(
        "Something went wrong while submitting your application. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitSuccess) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">
            Thank you for applying
          </h1>
          <p className="text-sm text-slate-600">
            We&apos;ve received your application to join Unity Healthcare
            Staffing. Our recruitment team will review your details and may
            contact your referee using the information you provided.
          </p>
          <p className="text-sm text-slate-600">
            If you meet our minimum requirement of at least{" "}
            <span className="font-semibold">
              3 months recent healthcare experience
            </span>{" "}
            and have the right to work in the UK, a member of the team will be
            in touch shortly.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => navigate("/")}
              className="px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
            >
              Return to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-6">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Join Unity Healthcare Staffing
            </h1>
            <p className="text-sm text-slate-600 max-w-xl mt-1">
              Complete our online recruitment form to join our bank of nurses,
              HCAs and support workers. We normally require at least{" "}
              <span className="font-semibold">3 months recent UK experience</span>{" "}
              in a healthcare setting.
            </p>
          </div>
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <p className="font-semibold text-slate-700">Minimum criteria</p>
            <ul className="list-disc list-inside space-y-0.5 mt-1">
              <li>Right to work in the UK</li>
              <li>At least 3 months recent healthcare experience</li>
              <li>Relevant references on request</li>
            </ul>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Step {step} of {TOTAL_STEPS}
            </span>
            <span>
              {step === 1 && "Personal & eligibility"}
              {step === 2 && "Experience & availability"}
              {step === 3 && "Referee details"}
              {step === 4 && "Documents & review"}
            </span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-2 bg-cyan-700 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* FORM BODY */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {submitError}
            </div>
          )}

          {/* STEP 1 – PERSONAL & ELIGIBILITY */}
          {step === 1 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full name (as on your ID) *
                </label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => handleChange("fullName", e.target.value)}
                  className="uh-input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Email address *
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  className="uh-input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mobile number *
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  className="uh-input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Role you are applying for *
                </label>
                <select
                  value={form.roleApplied}
                  onChange={(e) => handleChange("roleApplied", e.target.value)}
                  className="uh-input bg-white"
                  required
                >
                  <option value="">Select role</option>
                  <option value="HCA">Healthcare Assistant (HCA)</option>
                  <option value="Support Worker">Support Worker</option>
                  <option value="RGN">Registered General Nurse (RGN)</option>
                  <option value="RMN">Registered Mental Health Nurse (RMN)</option>
                  <option value="Nurse">Nurse (Other)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Do you have at least 3 months recent healthcare experience? *
                </label>
                <select
                  value={form.has3MonthsExperience}
                  onChange={(e) =>
                    handleChange("has3MonthsExperience", e.target.value)
                  }
                  className="uh-input bg-white"
                  required
                >
                  <option value="">Select option</option>
                  <option value="yes">Yes – 3+ months</option>
                  <option value="no">
                    No (we may not be able to progress your application)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Right to work status
                </label>
                <select
                  value={form.rightToWorkStatus}
                  onChange={(e) =>
                    handleChange("rightToWorkStatus", e.target.value)
                  }
                  className="uh-input bg-white"
                >
                  <option value="">Select option</option>
                  <option value="ukCitizen">UK citizen</option>
                  <option value="settledStatus">EU settled / pre-settled</option>
                  <option value="visa">Visa holder</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  National Insurance number (optional)
                </label>
                <input
                  type="text"
                  value={form.niNumber}
                  onChange={(e) => handleChange("niNumber", e.target.value)}
                  className="uh-input"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  How did you hear about Unity? (optional)
                </label>
                <input
                  type="text"
                  value={form.heardAboutUs}
                  onChange={(e) => handleChange("heardAboutUs", e.target.value)}
                  className="uh-input"
                  placeholder="e.g. Friend, Indeed, Facebook, Google"
                />
              </div>
            </div>
          )}

          {/* STEP 2 – EXPERIENCE & AVAILABILITY */}
          {step === 2 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Brief summary of your healthcare experience
                </label>
                <textarea
                  value={form.experienceSummary}
                  onChange={(e) =>
                    handleChange("experienceSummary", e.target.value)
                  }
                  className="uh-input min-h-[80px]"
                  placeholder="Tell us where you’ve worked, patient groups, main duties, etc."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Approx. total experience (months)
                </label>
                <input
                  type="number"
                  value={form.totalExperienceMonths}
                  onChange={(e) =>
                    handleChange("totalExperienceMonths", e.target.value)
                  }
                  className="uh-input"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Current role / employer (optional)
                </label>
                <input
                  type="text"
                  value={form.currentRole}
                  onChange={(e) =>
                    handleChange("currentRole", e.target.value)
                  }
                  className="uh-input"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Availability (days, nights, weekends)
                </label>
                <textarea
                  value={form.availability}
                  onChange={(e) =>
                    handleChange("availability", e.target.value)
                  }
                  className="uh-input min-h-[60px]"
                  placeholder="e.g. Monday–Friday days, alternate weekends, etc."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Preferred locations
                </label>
                <input
                  type="text"
                  value={form.preferredLocations}
                  onChange={(e) =>
                    handleChange("preferredLocations", e.target.value)
                  }
                  className="uh-input"
                  placeholder="e.g. Bangor, Anglesey, North Wales"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Can you work night shifts?
                </label>
                <select
                  value={form.canWorkNights}
                  onChange={(e) =>
                    handleChange("canWorkNights", e.target.value)
                  }
                  className="uh-input bg-white"
                >
                  <option value="">Select option</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="maybe">Sometimes / by agreement</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Do you drive?
                </label>
                <select
                  value={form.canDrive}
                  onChange={(e) => handleChange("canDrive", e.target.value)}
                  className="uh-input bg-white"
                >
                  <option value="">Select option</option>
                  <option value="yes">Yes – own car available</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 3 – REFEREE DETAILS */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Please provide details for a professional referee (e.g. line
                manager, ward manager). We may contact them by email to request
                a reference.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Referee full name *
                  </label>
                  <input
                    type="text"
                    value={form.refereeName}
                    onChange={(e) =>
                      handleChange("refereeName", e.target.value)
                    }
                    className="uh-input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Referee email address * (work email preferred)
                  </label>
                  <input
                    type="email"
                    value={form.refereeEmail}
                    onChange={(e) =>
                      handleChange("refereeEmail", e.target.value)
                    }
                    className="uh-input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Referee phone (optional)
                  </label>
                  <input
                    type="tel"
                    value={form.refereePhone}
                    onChange={(e) =>
                      handleChange("refereePhone", e.target.value)
                    }
                    className="uh-input"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Relationship to you (e.g. Ward manager, Supervisor)
                  </label>
                  <input
                    type="text"
                    value={form.refereeRelationship}
                    onChange={(e) =>
                      handleChange("refereeRelationship", e.target.value)
                    }
                    className="uh-input"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                By submitting these details, you confirm that you have
                permission to share this referee&apos;s contact information for
                recruitment purposes.
              </p>
            </div>
          )}

          {/* STEP 4 – DOCUMENTS & REVIEW */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Upload your CV (PDF/Word) *
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) =>
                      handleFileChange("cvFile", e.target.files?.[0] || null)
                    }
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Right to work document (passport/BRP) – optional
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      handleFileChange(
                        "rightToWorkFile",
                        e.target.files?.[0] || null
                      )
                    }
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    DBS certificate – optional
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      handleFileChange("dbsFile", e.target.files?.[0] || null)
                    }
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Training certificates (e.g. mandatory training) – optional
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      handleFileChange(
                        "trainingFile",
                        e.target.files?.[0] || null
                      )
                    }
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-800">
                  Please review before submitting:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Your contact details are correct.</li>
                  <li>
                    You have honestly stated your experience (minimum 3 months
                    is normally required).
                  </li>
                  <li>Your referee is aware they may be contacted.</li>
                  <li>
                    You consent to Unity Healthcare Staffing storing and
                    processing this information for recruitment purposes.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* FOOTER BUTTONS */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to login
            </button>

            <div className="flex gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="px-4 py-1.5 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50"
                >
                  Back
                </button>
              )}

              {step < TOTAL_STEPS && (
                <button
                  type="button"
                  onClick={goNext}
                  className="px-4 py-1.5 rounded-full bg-cyan-700 text-white text-xs font-semibold hover:bg-cyan-800"
                >
                  Next
                </button>
              )}

              {step === TOTAL_STEPS && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit application"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* LOCAL INPUT STYLES */}
      <style>{`
        .uh-input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          outline: none;
          font-size: 0.85rem;
          background-color: white;
        }
        .uh-input:focus {
          border-color: #0e7490;
          box-shadow: 0 0 0 1px #22d3ee33;
        }
      `}</style>
    </div>
  );
}

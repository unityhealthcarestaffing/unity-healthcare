// src/components/StaffOnboarding.jsx
import { useMemo, useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { signOut } from "firebase/auth";
import { db, storage, auth } from "../firebaseConfig";

const TOTAL_STEPS = 5;

// Employment helper
const makeEmploymentRow = () => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  employerName: "",
  jobTitle: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  mainDuties: "",
});

const makeReferee = () => ({
  name: "",
  email: "",
  phone: "",
  relationship: "",
});

export default function StaffOnboarding() {
  const currentUser = auth.currentUser;

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [applicantDeclaration, setApplicantDeclaration] = useState(false);

  const [form, setForm] = useState({
    // STEP 1
    surname: "",
    otherNames: "",
    phone: "",
    roleApplied: "",
    has3MonthsExperience: "",
    rightToWorkStatus: "",
    niNumber: "",
    safeguardingInvestigation: "",
    safeguardingDetails: "",
    heardAboutUs: "",

    // Address
    addressLine1: "",
    addressLine2: "",
    cityTown: "",
    county: "",
    postcode: "",

    // STEP 2
    experienceSummary: "",
    totalExperienceMonths: "",
    currentRole: "",
    availability: "",
    preferredLocations: "",
    canWorkNights: "",
    canDrive: "",
  });

  const [employmentHistory, setEmploymentHistory] = useState([makeEmploymentRow()]);
  const [referees, setReferees] = useState([makeReferee(), makeReferee()]);

  const [files, setFiles] = useState({
    cvFile: null,
    rightToWorkFile: null,
    dbsFile: null,
    trainingFile: null,
    shareCodeFile: null,
  });

  const progress = useMemo(() => (step / TOTAL_STEPS) * 100, [step]);

  const handleChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleRefereeChange = (index, field, value) => {
    setReferees((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleFileChange = (field, file) => setFiles((prev) => ({ ...prev, [field]: file }));

  // ✅ Always works
  const backToLogin = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Sign out failed:", e);
    } finally {
      window.location.href = "/";
    }
  };

  // ✅ Storage rules path: staffApplications/{uid}/{docType}/{fileName}
  const uploadFileToStorage = async (docType, file) => {
    if (!file) return null;
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("No authenticated user for upload.");

    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const path = `staffApplications/${uid}/${docType}/${Date.now()}-${safeName}`;

    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  // Employment handlers
  const updateEmployment = (rowId, field, value) => {
    setEmploymentHistory((rows) =>
      rows.map((r) => {
        if (r.id !== rowId) return r;
        if (field === "isCurrent") return { ...r, isCurrent: value, endDate: value ? "" : r.endDate };
        return { ...r, [field]: value };
      })
    );
  };

  const addEmploymentRow = () => setEmploymentHistory((rows) => [...rows, makeEmploymentRow()]);
  const removeEmploymentRow = (rowId) =>
    setEmploymentHistory((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.id !== rowId)));

  // Validation
  const validateEmploymentHistory = () => {
    const valid = employmentHistory.some((r) => {
      const hasBasics =
        r.employerName?.trim() &&
        r.jobTitle?.trim() &&
        r.startDate &&
        (r.isCurrent || r.endDate) &&
        r.mainDuties?.trim();
      return Boolean(hasBasics);
    });
    if (!valid) return "Please add at least one employment history entry (employer, job title, dates and main duties).";

    const partiallyFilled = employmentHistory.some((r) => {
      const any = r.employerName || r.jobTitle || r.startDate || r.endDate || r.mainDuties;
      const complete =
        r.employerName?.trim() &&
        r.jobTitle?.trim() &&
        r.startDate &&
        (r.isCurrent || r.endDate) &&
        r.mainDuties?.trim();
      return Boolean(any && !complete);
    });
    if (partiallyFilled) return "Some employment history rows are incomplete. Please complete them or remove them.";
    return "";
  };

  const validateStep = (whichStep) => {
    if (whichStep === 1) {
      if (!form.surname?.trim() || !form.otherNames?.trim()) return "Please enter your surname and other names (as on your ID).";
      if (!form.phone?.trim()) return "Please enter your mobile number.";
      if (!form.roleApplied) return "Please select the role you are applying for.";
      if (!form.has3MonthsExperience) return "Please confirm whether you have at least 3 months experience.";
      if (!form.rightToWorkStatus) return "Please select your right to work status.";
      if (!form.niNumber?.trim()) return "Please enter your National Insurance number.";
      if (!form.safeguardingInvestigation)
        return "Please answer the safeguarding investigation question.";
      if (
        form.safeguardingInvestigation === "yes" &&
        !form.safeguardingDetails?.trim()
      ) {
        return "Please provide details of the safeguarding investigation, restriction or referral.";
      }
      if (!form.addressLine1?.trim() || !form.cityTown?.trim() || !form.postcode?.trim())
        return "Please complete your address line 1, city/town and postcode.";
    }

    if (whichStep === 2) {
      const empErr = validateEmploymentHistory();
      if (empErr) return empErr;
    }

    if (whichStep === 3) {
      const r1 = referees[0];
      const r2 = referees[1];
      if (!r1?.name?.trim() || !r1?.email?.trim()) return "Please provide Referee 1 name and email.";
      if (!r2?.name?.trim() || !r2?.email?.trim()) return "Please provide Referee 2 name and email.";
    }

    if (whichStep === 4) {
      if (!files.cvFile) return "Please upload your CV.";
    }

    if (whichStep === 5) {
      if (!applicantDeclaration) {
        return "Please confirm that the information in your application is complete and correct.";
      }
    }

    return "";
  };

  const goNext = () => {
    setSubmitError("");
    const err = validateStep(step);
    if (err) return setSubmitError(err);
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };

  const goBack = () => {
    setSubmitError("");
    if (step > 1) setStep((s) => s - 1);
  };

  const validateBeforeSubmit = () => {
    for (let s = 1; s <= TOTAL_STEPS; s += 1) {
      const err = validateStep(s);
      if (err) return err;
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");

    if (!auth.currentUser) {
      setSubmitError("We could not find your login session. Please sign out and sign in again.");
      return;
    }

    const validationError = validateBeforeSubmit();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    try {
      setSubmitting(true);

      const [cvUrl, rtWorkUrl, dbsUrl, trainingUrl, shareCodeUrl] = await Promise.all([
        uploadFileToStorage("cv", files.cvFile),
        uploadFileToStorage("rightToWork", files.rightToWorkFile),
        uploadFileToStorage("dbs", files.dbsFile),
        uploadFileToStorage("training", files.trainingFile),
        uploadFileToStorage("shareCode", files.shareCodeFile),
      ]);

      const r1 = referees[0];
      const r2 = referees[1];

      const payload = {
        uid: auth.currentUser.uid,
        surname: form.surname,
        otherNames: form.otherNames,
        fullName: `${form.otherNames} ${form.surname}`.trim(),
        email: auth.currentUser.email,
        phone: form.phone,
        roleApplied: form.roleApplied,
        has3MonthsExperience: form.has3MonthsExperience,
        rightToWorkStatus: form.rightToWorkStatus,
        niNumber: form.niNumber.trim().toUpperCase(),
        safeguardingInvestigation: form.safeguardingInvestigation,
        safeguardingDetails:
          form.safeguardingInvestigation === "yes"
            ? form.safeguardingDetails.trim()
            : null,
        declarationConfirmed: true,
        declarationConfirmedAt: serverTimestamp(),

        address: {
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || null,
          cityTown: form.cityTown,
          county: form.county || null,
          postcode: form.postcode,
        },

        employmentHistory: employmentHistory.map((r) => ({
          employerName: r.employerName,
          jobTitle: r.jobTitle,
          startDate: r.startDate,
          endDate: r.isCurrent ? null : r.endDate,
          isCurrent: !!r.isCurrent,
          mainDuties: r.mainDuties,
        })),

        experienceSummary: form.experienceSummary || null,
        totalExperienceMonths: form.totalExperienceMonths || null,
        currentRole: form.currentRole || null,
        availability: form.availability || null,
        preferredLocations: form.preferredLocations || null,
        canWorkNights: form.canWorkNights || null,
        canDrive: form.canDrive || null,

        referees: [
          { name: r1.name, email: r1.email, phone: r1.phone || null, relationship: r1.relationship || null },
          { name: r2.name, email: r2.email, phone: r2.phone || null, relationship: r2.relationship || null },
        ],

        // Backward compatible
        refereeName: r1.name,
        refereeEmail: r1.email,
        refereePhone: r1.phone || null,
        refereeRelationship: r1.relationship || null,

        heardAboutUs: form.heardAboutUs || null,

        documents: {
          cvUrl,
          rightToWorkUrl: rtWorkUrl,
          dbsUrl,
          trainingUrl,
          shareCodeUrl,
        },

        status: "new",
        createdAt: serverTimestamp(),
        source: "website",
      };

      await addDoc(collection(db, "staffApplications"), payload);

      // ✅ No /users write here. No permission errors. No circles.
      setSubmitSuccess(true);
    } catch (err) {
      console.error("Error submitting staff application:", err);
      const msg =
        String(err?.code || "").includes("storage/unauthorized")
          ? "Upload blocked (Storage permission). Please publish the updated Firebase Storage Rules."
          : "Something went wrong while submitting your application. Please try again.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentUser && !submitSuccess) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Please sign in</h1>
          <p className="text-sm text-slate-600">
            To complete your staff registration, please sign in to your Unity Healthcare account first.
          </p>
          <button
            type="button"
            onClick={backToLogin}
            className="mt-2 px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Thank you for applying</h1>
          <p className="text-sm text-slate-600">
            We&apos;ve received your application to join Unity Healthcare Staffing. Our recruitment team will review your
            details and may contact your referees using the information you provided.
          </p>
          <p className="text-sm text-slate-600">
            If you meet our minimum requirement of at least{" "}
            <span className="font-semibold">3 months recent healthcare experience</span> and have the right to work in
            the UK, a member of the team will be in touch shortly.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              onClick={backToLogin}
              className="px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
            >
              Return to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepTitle =
    step === 1
      ? "Personal, address & eligibility"
      : step === 2
      ? "Employment history & availability"
      : step === 3
      ? "Referee details"
      : step === 4
      ? "Documents"
      : "Review & declaration";

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-6">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Join Unity Healthcare Staffing</h1>
            <p className="text-sm text-slate-600 max-w-xl mt-1">
              Complete our online recruitment form to join our bank of nurses, HCAs and support workers. We normally
              require at least{" "}
              <span className="font-semibold">3 months recent UK experience</span> in a healthcare setting.
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
            <span>{stepTitle}</span>
          </div>
          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-2 bg-cyan-700 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* FORM BODY */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {submitError}
            </div>
          )}

          {/* STEP 5 - REVIEW */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Review your application
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Check the information below. Use the Back button to correct anything
                  before submitting.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Personal and eligibility
                  </h3>
                  <dl className="mt-3 space-y-2 text-xs text-slate-700">
                    <div><dt className="font-semibold">Name</dt><dd>{`${form.otherNames} ${form.surname}`.trim()}</dd></div>
                    <div><dt className="font-semibold">Mobile</dt><dd>{form.phone}</dd></div>
                    <div><dt className="font-semibold">Role</dt><dd>{form.roleApplied}</dd></div>
                    <div><dt className="font-semibold">Right to work</dt><dd>{form.rightToWorkStatus}</dd></div>
                    <div><dt className="font-semibold">National Insurance number</dt><dd>{form.niNumber}</dd></div>
                    <div>
                      <dt className="font-semibold">Safeguarding investigation</dt>
                      <dd>{form.safeguardingInvestigation === "yes" ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Address</h3>
                  <p className="mt-3 text-xs text-slate-700">
                    {form.addressLine1}
                    {form.addressLine2 ? `, ${form.addressLine2}` : ""}
                    <br />
                    {form.cityTown}
                    {form.county ? `, ${form.county}` : ""}
                    <br />
                    {form.postcode}
                  </p>
                </div>
              </div>

              {form.safeguardingInvestigation === "yes" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <h3 className="text-sm font-semibold text-amber-900">
                    Safeguarding information supplied
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-amber-900">
                    {form.safeguardingDetails}
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Employment history
                </h3>
                <div className="mt-3 space-y-3">
                  {employmentHistory.map((row, index) => (
                    <div key={row.id} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                      <p className="font-semibold">
                        {index + 1}. {row.jobTitle} — {row.employerName}
                      </p>
                      <p>
                        {row.startDate} to {row.isCurrent ? "Present" : row.endDate}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Professional referees
                </h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {referees.map((referee, index) => (
                    <div key={index} className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                      <p className="font-semibold">Referee {index + 1}</p>
                      <p>{referee.name}</p>
                      <p>{referee.email}</p>
                      {referee.phone && <p>{referee.phone}</p>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Documents selected
                </h3>
                <ul className="mt-3 space-y-1 text-xs text-slate-700">
                  <li>CV: {files.cvFile?.name || "Not selected"}</li>
                  <li>Right-to-work document: {files.rightToWorkFile?.name || "Not selected"}</li>
                  <li>DBS: {files.dbsFile?.name || "Not selected"}</li>
                  <li>Training document: {files.trainingFile?.name || "Not selected"}</li>
                  <li>Share-code document: {files.shareCodeFile?.name || "Not selected"}</li>
                </ul>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={applicantDeclaration}
                  onChange={(e) => setApplicantDeclaration(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-cyan-700"
                />
                <span>
                  I confirm that I have reviewed this application and that the
                  information and documents provided are complete and correct to the
                  best of my knowledge. I understand that false or misleading
                  information may affect my application or engagement.
                </span>
              </label>
            </div>
          )}

          {/* STEP 1 */}
          {step === 1 && (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Names split */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Surname (as on your ID) *</label>
                <input type="text" value={form.surname} onChange={(e) => handleChange("surname", e.target.value)} className="uh-input" required />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Other names (as on your ID) *</label>
                <input type="text" value={form.otherNames} onChange={(e) => handleChange("otherNames", e.target.value)} className="uh-input" required />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mobile number *</label>
                <input type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} className="uh-input" required />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Role you are applying for *</label>
                <select value={form.roleApplied} onChange={(e) => handleChange("roleApplied", e.target.value)} className="uh-input bg-white" required>
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
                <select value={form.has3MonthsExperience} onChange={(e) => handleChange("has3MonthsExperience", e.target.value)} className="uh-input bg-white" required>
                  <option value="">Select option</option>
                  <option value="yes">Yes – 3+ months</option>
                  <option value="no">No (we may not be able to progress your application)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Right to work status *</label>
                <select value={form.rightToWorkStatus} onChange={(e) => handleChange("rightToWorkStatus", e.target.value)} className="uh-input bg-white" required>
                  <option value="">Select option</option>
                  <option value="ukCitizen">UK citizen</option>
                  <option value="settledStatus">EU settled / pre-settled</option>
                  <option value="visa">Visa holder</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">National Insurance number *</label>
                <input
                  type="text"
                  value={form.niNumber}
                  onChange={(e) => handleChange("niNumber", e.target.value.toUpperCase())}
                  className="uh-input"
                  placeholder="e.g. QQ123456C"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Are you currently the subject of any safeguarding investigation,
                  disciplinary investigation, restriction or referral? *
                </label>
                <select
                  value={form.safeguardingInvestigation}
                  onChange={(e) => {
                    handleChange("safeguardingInvestigation", e.target.value);
                    if (e.target.value !== "yes") {
                      handleChange("safeguardingDetails", "");
                    }
                  }}
                  className="uh-input bg-white"
                  required
                >
                  <option value="">Select option</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>

              {form.safeguardingInvestigation === "yes" && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Please provide details *
                  </label>
                  <textarea
                    value={form.safeguardingDetails}
                    onChange={(e) => handleChange("safeguardingDetails", e.target.value)}
                    className="uh-input min-h-[100px]"
                    placeholder="Provide relevant details, dates, organisations involved and the current position."
                    required
                  />
                </div>
              )}

              <div className="md:col-span-2 pt-2">
                <p className="text-xs font-semibold text-slate-800">Address (required)</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Address line 1 *</label>
                <input type="text" value={form.addressLine1} onChange={(e) => handleChange("addressLine1", e.target.value)} className="uh-input" required />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Address line 2 (optional)</label>
                <input type="text" value={form.addressLine2} onChange={(e) => handleChange("addressLine2", e.target.value)} className="uh-input" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">City / Town *</label>
                <input type="text" value={form.cityTown} onChange={(e) => handleChange("cityTown", e.target.value)} className="uh-input" required />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">County (optional)</label>
                <input type="text" value={form.county} onChange={(e) => handleChange("county", e.target.value)} className="uh-input" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Postcode *</label>
                <input type="text" value={form.postcode} onChange={(e) => handleChange("postcode", e.target.value)} className="uh-input" required />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">How did you hear about Unity? (optional)</label>
                <input type="text" value={form.heardAboutUs} onChange={(e) => handleChange("heardAboutUs", e.target.value)} className="uh-input" />
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Employment history (required)</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Add your recent employment(s). Include employer, job title, dates and main duties.
                    </p>
                  </div>
                  <button type="button" onClick={addEmploymentRow} className="px-3 py-1.5 rounded-full bg-cyan-700 text-white text-xs font-semibold hover:bg-cyan-800">
                    + Add previous employment
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {employmentHistory.map((row, idx) => (
                    <div key={row.id} className="bg-white border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">Employment {idx + 1}</p>
                        {employmentHistory.length > 1 && (
                          <button type="button" onClick={() => removeEmploymentRow(row.id)} className="text-xs text-red-600 hover:underline">
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 mt-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Employer name *</label>
                          <input type="text" value={row.employerName} onChange={(e) => updateEmployment(row.id, "employerName", e.target.value)} className="uh-input" />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Job title / role *</label>
                          <input type="text" value={row.jobTitle} onChange={(e) => updateEmployment(row.id, "jobTitle", e.target.value)} className="uh-input" />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Start date *</label>
                          <input type="date" value={row.startDate} onChange={(e) => updateEmployment(row.id, "startDate", e.target.value)} className="uh-input" />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            End date {row.isCurrent ? "(not required)" : "*"}
                          </label>
                          <input type="date" value={row.endDate} onChange={(e) => updateEmployment(row.id, "endDate", e.target.value)} className="uh-input" disabled={row.isCurrent} />
                          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                            <input type="checkbox" checked={row.isCurrent} onChange={(e) => updateEmployment(row.id, "isCurrent", e.target.checked)} />
                            I currently work here
                          </label>
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">Main duties / responsibilities *</label>
                          <textarea value={row.mainDuties} onChange={(e) => updateEmployment(row.id, "mainDuties", e.target.value)} className="uh-input min-h-[80px]" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Brief summary of your healthcare experience (optional)
                  </label>
                  <textarea value={form.experienceSummary} onChange={(e) => handleChange("experienceSummary", e.target.value)} className="uh-input min-h-[80px]" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Approx. total experience (months) (optional)</label>
                  <input type="number" value={form.totalExperienceMonths} onChange={(e) => handleChange("totalExperienceMonths", e.target.value)} className="uh-input" min="0" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Current role / employer (optional)</label>
                  <input type="text" value={form.currentRole} onChange={(e) => handleChange("currentRole", e.target.value)} className="uh-input" />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Availability (days, nights, weekends) (optional)</label>
                  <textarea value={form.availability} onChange={(e) => handleChange("availability", e.target.value)} className="uh-input min-h-[60px]" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Preferred locations (optional)</label>
                  <input type="text" value={form.preferredLocations} onChange={(e) => handleChange("preferredLocations", e.target.value)} className="uh-input" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Can you work night shifts? (optional)</label>
                  <select value={form.canWorkNights} onChange={(e) => handleChange("canWorkNights", e.target.value)} className="uh-input bg-white">
                    <option value="">Select option</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="maybe">Sometimes / by agreement</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Do you drive? (optional)</label>
                  <select value={form.canDrive} onChange={(e) => handleChange("canDrive", e.target.value)} className="uh-input bg-white">
                    <option value="">Select option</option>
                    <option value="yes">Yes – own car available</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="space-y-5">
              <p className="text-xs text-slate-600">
                Please provide details for <span className="font-semibold">two</span> professional referees.
              </p>

              {[0, 1].map((i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <p className="text-sm font-semibold text-slate-900">Referee {i + 1}</p>

                  <div className="grid gap-4 md:grid-cols-2 mt-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Referee full name *</label>
                      <input type="text" value={referees[i].name} onChange={(e) => handleRefereeChange(i, "name", e.target.value)} className="uh-input" required />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Referee email address *</label>
                      <input type="email" value={referees[i].email} onChange={(e) => handleRefereeChange(i, "email", e.target.value)} className="uh-input" required />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Referee phone (optional)</label>
                      <input type="tel" value={referees[i].phone} onChange={(e) => handleRefereeChange(i, "phone", e.target.value)} className="uh-input" />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Relationship to you</label>
                      <input type="text" value={referees[i].relationship} onChange={(e) => handleRefereeChange(i, "relationship", e.target.value)} className="uh-input" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Upload your CV (PDF/Word) *</label>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) => handleFileChange("cvFile", e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Right to work document – optional</label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange("rightToWorkFile", e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Right to work share code document – optional</label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange("shareCodeFile", e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">DBS certificate – optional</label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange("dbsFile", e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Training certificates – optional</label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange("trainingFile", e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {/* FOOTER */}
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={backToLogin} className="text-xs text-slate-500 hover:text-slate-700">
              ← Back to login
            </button>

            <div className="flex gap-2">
              {step > 1 && (
                <button type="button" onClick={goBack} className="px-4 py-1.5 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50">
                  Back
                </button>
              )}

              {step < TOTAL_STEPS && (
                <button type="button" onClick={goNext} className="px-4 py-1.5 rounded-full bg-cyan-700 text-white text-xs font-semibold hover:bg-cyan-800">
                  Next
                </button>
              )}

              {step === TOTAL_STEPS && (
                <button type="submit" disabled={submitting} className="px-5 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60">
                  {submitting ? "Submitting…" : "Submit application"}
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

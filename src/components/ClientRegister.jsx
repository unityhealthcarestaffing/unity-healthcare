// src/components/ClientRegister.jsx
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { auth, db, storage } from "../firebaseConfig";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

export default function ClientRegister() {
  const navigate = useNavigate();

  // Wizard step
  const [step, setStep] = useState(1);
  const totalSteps = 6;

  // Form snapshot used for review + saving, but NOT bound to inputs
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    organisationName: "",
    tradingName: "",
    organisationAddress: "",
    organisationPostcode: "",
    cityTown: "",
    landmark: "",
    website: "",
    phoneNumber: "",
    clientType: "",
    contactName: "",
    contactRole: "",
    contactEmail: "",
    contactPhone: "",
    accountsEmail: "",
    invoiceAddress: "",
    vatNumber: "",
    paymentTerms: "",
  });

  // Files
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [isUploading, setIsUploading] = useState(false);

  // General state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const suggestedDocs = [
    "Contract",
    "CQC Certificate",
    "Insurance",
    "Company Registration",
    "Policies",
  ];

  // --- REFS for all inputs (uncontrolled) ---

  // Step 1
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);

  // Step 2
  const orgNameRef = useRef(null);
  const tradingNameRef = useRef(null);
  const orgAddressRef = useRef(null);
  const orgPostcodeRef = useRef(null);
  const cityRef = useRef(null);
  const landmarkRef = useRef(null);
  const websiteRef = useRef(null);
  const phoneRef = useRef(null);
  const clientTypeRef = useRef(null);

  // Step 3
  const contactNameRef = useRef(null);
  const contactRoleRef = useRef(null);
  const contactEmailRef = useRef(null);
  const contactPhoneRef = useRef(null);

  // Step 4
  const accountsEmailRef = useRef(null);
  const invoiceAddressRef = useRef(null);
  const vatNumberRef = useRef(null);
  const paymentTermsRef = useRef(null);

  // ---------- Helper: commit current step fields into formData ----------

  const persistStepValues = () => {
    const current = { ...formData };

    if (step === 1) {
      current.email = emailRef.current?.value.trim() || "";
      current.password = passwordRef.current?.value || "";
      current.confirmPassword = confirmPasswordRef.current?.value || "";
    } else if (step === 2) {
      current.organisationName = orgNameRef.current?.value.trim() || "";
      current.tradingName = tradingNameRef.current?.value.trim() || "";
      current.organisationAddress = orgAddressRef.current?.value.trim() || "";
      current.organisationPostcode =
        orgPostcodeRef.current?.value.trim() || "";
      current.cityTown = cityRef.current?.value.trim() || "";
      current.landmark = landmarkRef.current?.value.trim() || "";
      current.website = websiteRef.current?.value.trim() || "";
      current.phoneNumber = phoneRef.current?.value.trim() || "";
      current.clientType = clientTypeRef.current?.value || "";
    } else if (step === 3) {
      current.contactName = contactNameRef.current?.value.trim() || "";
      current.contactRole = contactRoleRef.current?.value.trim() || "";
      current.contactEmail = contactEmailRef.current?.value.trim() || "";
      current.contactPhone = contactPhoneRef.current?.value.trim() || "";
    } else if (step === 4) {
      current.accountsEmail = accountsEmailRef.current?.value.trim() || "";
      current.invoiceAddress =
        invoiceAddressRef.current?.value.trim() || "";
      current.vatNumber = vatNumberRef.current?.value.trim() || "";
      current.paymentTerms = paymentTermsRef.current?.value || "";
    }

    setFormData(current);
    return current;
  };

  // ---------- Validation per step ----------

  const validateStep = (data) => {
    if (step === 1) {
      if (!data.email || !data.password) {
        return "Email and password are required.";
      }
      if (data.password.length < 6) {
        return "Password should be at least 6 characters.";
      }
      if (data.password !== (data.confirmPassword || "")) {
        return "Passwords do not match.";
      }
    }
    if (step === 2) {
      if (
        !data.organisationName ||
        !data.organisationAddress ||
        !data.organisationPostcode
      ) {
        return "Organisation name, address and postcode are required.";
      }
    }
    if (step === 3) {
      if (!data.contactName || !data.contactEmail) {
        return "Primary contact name and email are required.";
      }
    }
    return null;
  };

  // ---------- Wizard navigation ----------

  const handleNext = () => {
    const snapshot = persistStepValues();
    const validationError = validateStep(snapshot);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setStep((s) => Math.min(totalSteps, s + 1));
  };

  const handleBack = () => {
    persistStepValues();
    setError("");
    setStep((s) => Math.max(1, s - 1));
  };

  // ---------- File handling ----------

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const merged = [...prev];
      for (const f of selected) {
        if (!existingNames.has(f.name)) merged.push(f);
      }
      return merged;
    });
  };

  const handleRemoveFile = (name) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
    setUploadProgress((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  // ---------- Final submit ----------

  const handleSubmit = async () => {
    // Make sure we have the latest data from all steps
    const snapshot = persistStepValues();

    // Run validations for all relevant steps
    const allChecks = [
      validateStep({ ...snapshot, confirmPassword: snapshot.confirmPassword }),
    ];
    const firstError = allChecks.find(Boolean);
    if (firstError) {
      setError(firstError);
      setStep(1);
      return;
    }

    setError("");

    try {
      setSubmitting(true);

      // 1) Create Auth user
      const cred = await createUserWithEmailAndPassword(
        auth,
        snapshot.email,
        snapshot.password
      );
      const user = cred.user;
      const uid = user.uid;

      // 2) Send verification email with redirect back to /client-verify
      const actionCodeSettings = {
        url: `${window.location.origin}/client-verify`,
        // handleCodeInApp: false  // default is fine here
      };
      await sendEmailVerification(user, actionCodeSettings);

      // 3) Upload documents (if any)
      const uploadedDocs = [];
      if (files.length > 0) {
        setIsUploading(true);
        for (const file of files) {
          const storageRef = ref(storage, `clientDocuments/${uid}/${file.name}`);
          const uploadTask = uploadBytesResumable(storageRef, file);

          await new Promise((resolve, reject) => {
            uploadTask.on(
              "state_changed",
              (snapshotUpload) => {
                const progress =
                  (snapshotUpload.bytesTransferred /
                    snapshotUpload.totalBytes) *
                  100;
                setUploadProgress((prev) => ({
                  ...prev,
                  [file.name]: Math.round(progress),
                }));
              },
              (err) => reject(err),
              () => {
                getDownloadURL(uploadTask.snapshot.ref)
                  .then((url) => {
                    uploadedDocs.push({
                      name: file.name,
                      url,
                      uploadedAt: Timestamp.now(),
                    });
                    resolve();
                  })
                  .catch(reject);
              }
            );
          });
        }
        setIsUploading(false);
      }

      // 4) Create client profile document
      const clientData = {
        uid,
        email: snapshot.email,
        createdAt: Timestamp.now(),
        verified: false, // will be true after email + admin activation
        status: "pending",
        isActive: false,

        organisationName: snapshot.organisationName,
        tradingName: snapshot.tradingName || null,
        organisationAddress: snapshot.organisationAddress,
        organisationPostcode: snapshot.organisationPostcode,
        cityTown: snapshot.cityTown || null,
        landmark: snapshot.landmark || null,
        website: snapshot.website || null,
        phoneNumber: snapshot.phoneNumber || null,
        clientType: snapshot.clientType || null,

        contactName: snapshot.contactName,
        contactRole: snapshot.contactRole || null,
        contactEmail: snapshot.contactEmail,
        contactPhone: snapshot.contactPhone || null,

        accountsEmail: snapshot.accountsEmail || null,
        invoiceAddress: snapshot.invoiceAddress || null,
        vatNumber: snapshot.vatNumber || null,
        paymentTerms: snapshot.paymentTerms || null,

        documents: uploadedDocs,
      };

      await setDoc(doc(db, "clients", uid), clientData);

      // 5) Also store base user record in /users
      await setDoc(doc(db, "users", uid), {
        uid,
        email: snapshot.email,
        role: "client",
        accountType: "client",
        status: "pending",
        isActive: false,
        createdAt: Timestamp.now(),
      });

      // 6) Take them to the "Check your email" screen
      navigate("/client-verify");
    } catch (err) {
      console.error("Client registration failed:", err);
      let msg =
        "Registration failed. Please check your details and try again.";

      if (err.code === "auth/email-already-in-use") {
        msg =
          "This email is already registered. If you believe this is an error, please contact Unity Healthcare.";
      } else if (err.code === "auth/weak-password") {
        msg = "Password should be at least 6 characters.";
      }

      setError(msg);
    } finally {
      setSubmitting(false);
      setIsUploading(false);
    }
  };

  // ---------- UI helpers ----------

  const totalStepsLabel = `Step ${step} of ${totalSteps}`;

  function StepHeader() {
    return (
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>{totalStepsLabel}</span>
          <span>Client Onboarding</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 rounded-full bg-cyan-700 transition-all"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  function Card({ title, subtitle, children }) {
    return (
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div>
          <h2 className="font-semibold text-slate-900 text-lg">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-600 mt-1">{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    );
  }

  // ---------- Step components (uncontrolled inputs with defaultValue) ----------

  function StepAccount() {
    return (
      <Card
        title="Account Details"
        subtitle="These details will be used to sign in to the client portal."
      >
        <input
          ref={emailRef}
          type="email"
          className="uh-input"
          placeholder="Email address *"
          defaultValue={formData.email}
        />
        <input
          ref={passwordRef}
          type="password"
          className="uh-input"
          placeholder="Password *"
          defaultValue={formData.password}
        />
        <input
          ref={confirmPasswordRef}
          type="password"
          className="uh-input"
          placeholder="Confirm password *"
          defaultValue={formData.confirmPassword || ""}
        />
      </Card>
    );
  }

  function StepOrganisation() {
    return (
      <Card
        title="Organisation Details"
        subtitle="Tell us about your organisation so we can set you up correctly."
      >
        <input
          ref={orgNameRef}
          className="uh-input"
          placeholder="Organisation name *"
          defaultValue={formData.organisationName}
        />
        <input
          ref={tradingNameRef}
          className="uh-input"
          placeholder="Trading name (optional)"
          defaultValue={formData.tradingName}
        />
        <input
          ref={orgAddressRef}
          className="uh-input"
          placeholder="Organisation address *"
          defaultValue={formData.organisationAddress}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            ref={orgPostcodeRef}
            className="uh-input"
            placeholder="Postcode *"
            defaultValue={formData.organisationPostcode}
          />
          <input
            ref={cityRef}
            className="uh-input"
            placeholder="City / Town"
            defaultValue={formData.cityTown}
          />
        </div>
        <input
          ref={landmarkRef}
          className="uh-input"
          placeholder="Nearby landmark (optional)"
          defaultValue={formData.landmark}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            ref={websiteRef}
            className="uh-input"
            placeholder="Website (optional)"
            defaultValue={formData.website}
          />
          <input
            ref={phoneRef}
            className="uh-input"
            placeholder="Main phone number (optional)"
            defaultValue={formData.phoneNumber}
          />
        </div>
        <select
          ref={clientTypeRef}
          className="uh-input"
          defaultValue={formData.clientType}
        >
          <option value="">Type of client (optional)</option>
          <option value="NHS Service">NHS Service</option>
          <option value="Hospital">Hospital</option>
          <option value="Nursing Home">Nursing Home</option>
          <option value="Supported Living">Supported Living</option>
          <option value="Domiciliary Care">Domiciliary Care</option>
          <option value="Mental Health Unit">Mental Health Unit</option>
          <option value="Private Client">Private Client</option>
          <option value="Other">Other</option>
        </select>
      </Card>
    );
  }

  function StepContact() {
    return (
      <Card
        title="Primary Contact"
        subtitle="Who should we speak to regarding bookings and shifts?"
      >
        <input
          ref={contactNameRef}
          className="uh-input"
          placeholder="Full name *"
          defaultValue={formData.contactName}
        />
        <input
          ref={contactRoleRef}
          className="uh-input"
          placeholder="Job title (optional)"
          defaultValue={formData.contactRole}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            ref={contactEmailRef}
            type="email"
            className="uh-input"
            placeholder="Direct email *"
            defaultValue={formData.contactEmail}
          />
          <input
            ref={contactPhoneRef}
            className="uh-input"
            placeholder="Direct phone (optional)"
            defaultValue={formData.contactPhone}
          />
        </div>
      </Card>
    );
  }

  function StepBilling() {
    return (
      <Card
        title="Billing & Invoicing"
        subtitle="These details help us issue invoices correctly."
      >
        <input
          ref={accountsEmailRef}
          className="uh-input"
          placeholder="Accounts / invoices email (optional)"
          defaultValue={formData.accountsEmail}
        />
        <input
          ref={invoiceAddressRef}
          className="uh-input"
          placeholder="Invoice address (optional)"
          defaultValue={formData.invoiceAddress}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            ref={vatNumberRef}
            className="uh-input"
            placeholder="VAT number (optional)"
            defaultValue={formData.vatNumber}
          />
          <select
            ref={paymentTermsRef}
            className="uh-input"
            defaultValue={formData.paymentTerms}
          >
            <option value="">Payment terms (optional)</option>
            <option value="7 days">7 days</option>
            <option value="14 days">14 days</option>
            <option value="28 days">28 days</option>
            <option value="30 days">30 days</option>
            <option value="45 days">45 days</option>
          </select>
        </div>
      </Card>
    );
  }

  function StepDocuments() {
    return (
      <Card
        title="Supporting Documents"
        subtitle="Upload any relevant documents. You can also send more later."
      >
        <p className="text-xs text-slate-600">
          Suggested: {suggestedDocs.join(", ")}.
        </p>
        <input
          type="file"
          multiple
          onChange={handleFileSelect}
          className="text-xs mt-2"
        />
        {files.length > 0 && (
          <div className="mt-3 space-y-1">
            {files.map((file) => (
              <div
                key={file.name}
                className="flex justify-between items-center text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1"
              >
                <div className="flex-1 mr-2">
                  <p className="truncate">{file.name}</p>
                  {uploadProgress[file.name] != null && (
                    <div className="mt-1">
                      <div className="w-full bg-slate-200 rounded-full h-1.5">
                        <div
                          className="bg-cyan-700 h-1.5 rounded-full"
                          style={{
                            width: `${uploadProgress[file.name]}%`,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {uploadProgress[file.name]}%
                      </p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.name)}
                  className="text-[11px] text-rose-600 hover:underline"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
        {files.length === 0 && (
          <p className="text-[11px] text-slate-500 mt-2">
            You can skip this step for now and upload documents later if needed.
          </p>
        )}
      </Card>
    );
  }

  function StepReview() {
    const d = formData; // shorter alias
    return (
      <Card
        title="Review & Submit"
        subtitle="Please confirm your details before submitting your registration."
      >
        <div className="text-xs md:text-sm space-y-3">
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">Account</h3>
            <p>
              Email:{" "}
              {d.email || <span className="text-slate-400">Not set</span>}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-1">
              Organisation
            </h3>
            <p>
              {d.organisationName || (
                <span className="text-slate-400">No name</span>
              )}
            </p>
            <p>{d.organisationAddress}</p>
            <p>
              {d.organisationPostcode} {d.cityTown && `· ${d.cityTown}`}
            </p>
            {d.clientType && <p>Type: {d.clientType}</p>}
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-1">
              Primary Contact
            </h3>
            <p>{d.contactName}</p>
            {d.contactRole && <p>{d.contactRole}</p>}
            <p>{d.contactEmail}</p>
            {d.contactPhone && <p>{d.contactPhone}</p>}
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-1">Billing</h3>
            {d.accountsEmail && <p>Accounts email: {d.accountsEmail}</p>}
            {d.invoiceAddress && <p>Invoice address: {d.invoiceAddress}</p>}
            {d.vatNumber && <p>VAT: {d.vatNumber}</p>}
            {d.paymentTerms && <p>Payment terms: {d.paymentTerms}</p>}
          </div>

          <div>
            <h3 className="font-semibold text-slate-800 mb-1">
              Documents
            </h3>
            {files.length ? (
              <ul className="list-disc list-inside">
                {files.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 text-xs">
                No documents selected. You can provide them later.
              </p>
            )}
          </div>

          <p className="text-[11px] text-slate-500 mt-2">
            By submitting this form you confirm that the details provided are
            accurate and that you are authorised to act on behalf of this
            organisation.
          </p>
        </div>
      </Card>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 1:
        return <StepAccount />;
      case 2:
        return <StepOrganisation />;
      case 3:
        return <StepContact />;
      case 4:
        return <StepBilling />;
      case 5:
        return <StepDocuments />;
      case 6:
      default:
        return <StepReview />;
    }
  };

  const isLastStep = step === totalSteps;

  // ---------- Root render ----------

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
            Client Onboarding
          </h1>
          <p className="text-sm md:text-base text-slate-600 mt-1">
            Register your organisation to book shifts with Unity Healthcare
            Staffing.
          </p>
        </div>

        <StepHeader />

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {renderStep()}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1 || submitting}
              className="px-4 py-2 rounded-full border border-slate-300 bg-white text-xs md:text-sm text-slate-700 disabled:opacity-40"
            >
              Back
            </button>

            {!isLastStep ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={submitting}
                className="px-5 py-2 rounded-full bg-cyan-700 text-white text-xs md:text-sm font-semibold hover:bg-cyan-800 disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || isUploading}
                className="px-5 py-2 rounded-full bg-cyan-700 text-white text-xs md:text-sm font-semibold hover:bg-cyan-800 disabled:opacity-50"
              >
                {submitting || isUploading
                  ? "Submitting registration…"
                  : "Submit registration"}
              </button>
            )}
          </div>

          {(submitting || isUploading) && (
            <p className="text-[11px] text-slate-500 mt-2 text-right">
              Please do not close this window while we create your account
              and upload your documents.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

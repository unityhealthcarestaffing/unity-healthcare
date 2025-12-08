// src/components/StaffConfirm.jsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function StaffConfirm() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState("checking"); // checking | success | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    const appId = searchParams.get("app");
    const token = searchParams.get("token");

    const run = async () => {
      if (!appId || !token) {
        setState("error");
        setMessage("Invalid confirmation link.");
        return;
      }

      try {
        const ref = doc(db, "staffApplications", appId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setState("error");
          setMessage("Application not found.");
          return;
        }

        const data = snap.data();
        if (data.emailConfirmed) {
          setState("success");
          setMessage("Your application email is already confirmed. Thank you.");
          return;
        }

        if (data.emailConfirmToken !== token) {
          setState("error");
          setMessage("This confirmation link is no longer valid.");
          return;
        }

        await updateDoc(ref, {
          emailConfirmed: true,
          emailConfirmToken: null,
        });

        setState("success");
        setMessage(
          "Thank you. Your email has been confirmed and your application is now complete."
        );
      } catch (err) {
        console.error("Error confirming staff application:", err);
        setState("error");
        setMessage("We could not confirm your application. Please contact us.");
      }
    };

    run();
  }, [searchParams]);

  const title =
    state === "checking"
      ? "Confirming your application…"
      : state === "success"
      ? "Email confirmed"
      : "Something went wrong";

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-600">{message}</p>
        {state !== "checking" && (
          <a
            href="/"
            className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-cyan-700 text-white text-sm font-semibold hover:bg-cyan-800"
          >
            Go to Unity Healthcare
          </a>
        )}
      </div>
    </div>
  );
}

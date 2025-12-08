// src/components/ClientPortal.jsx
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import ClientShifts from "./ClientShifts"; // ✅ your original client portal

export default function ClientPortal({ currentUser }) {
  const [clientRecord, setClientRecord] = useState(null);
  const [clientLoading, setClientLoading] = useState(true);
  const [clientError, setClientError] = useState("");

  useEffect(() => {
    const loadClient = async () => {
      if (!currentUser) {
        setClientRecord(null);
        setClientLoading(false);
        return;
      }

      setClientLoading(true);
      setClientError("");

      try {
        const clientRef = doc(db, "clients", currentUser.uid);
        const snap = await getDoc(clientRef);

        if (!snap.exists()) {
          setClientRecord(null);
          setClientError(
            "We couldn’t find your client profile in our system. Please contact Unity admin."
          );
        } else {
          setClientRecord({ id: snap.id, ...snap.data() });
        }
      } catch (err) {
        console.error("Error loading client record:", err);
        setClientError(
          "We couldn’t load your client account details. Please try again later."
        );
      } finally {
        setClientLoading(false);
      }
    };

    loadClient();
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="card">
        <p className="text-sm text-slate-600">
          You must be signed in to view the client portal.
        </p>
      </div>
    );
  }

  if (clientLoading) {
    return (
      <div className="card">
        <p className="text-sm text-slate-600">
          Checking your client account status…
        </p>
      </div>
    );
  }

  if (clientError) {
    return (
      <div className="card">
        <p className="text-sm text-red-600">{clientError}</p>
      </div>
    );
  }

  if (!clientRecord) {
    return (
      <div className="card">
        <p className="text-sm text-slate-600">
          We couldn’t find a client profile for your account. Please contact
          Unity admin.
        </p>
      </div>
    );
  }

  if (clientRecord.status !== "active") {
    return (
      <div className="card max-w-xl">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">
          Account awaiting activation
        </h2>
        <p className="text-sm text-slate-600 mb-2">
          Your email has been verified, but your client account is still{" "}
          <span className="font-semibold">
            {clientRecord.status || "pending"}
          </span>
          .
        </p>
        <p className="text-xs text-slate-500">
          Unity admin will review your details and activate your account. Once
          activated, you’ll be able to post shifts and manage bookings here.
        </p>
      </div>
    );
  }

  // ✅ Account is active – show your original single/multiple UI
  return <ClientShifts currentUser={currentUser} />;
}

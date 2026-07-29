const emulatorHost =
  process.env.FIRESTORE_EMULATOR_HOST || "";

console.log(
  "FIRESTORE_EMULATOR_HOST:",
  emulatorHost || "MISSING"
);

if (!emulatorHost) {
  console.error(
    "FAILED: Firestore emulator environment variable is missing."
  );

  process.exit(1);
}

console.log(
  "SUCCESS: Firestore emulator command executed."
);

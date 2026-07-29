"use strict";

const net = require("node:net");

const expectedPorts = [
  {
    name: "Functions",
    host: "127.0.0.1",
    port: 5001,
  },

  {
    name: "Firestore",
    host: "127.0.0.1",
    port: 8080,
  },

  {
    name: "Authentication",
    host: "127.0.0.1",
    port: 9099,
  },
];

function connectToPort({
  name,
  host,
  port,
}) {
  return new Promise(
    (resolve, reject) => {
      const socket =
        net.createConnection({
          host,
          port,
        });

      const timeout =
        setTimeout(() => {
          socket.destroy();

          reject(
            new Error(
              `${name} emulator did not respond on ${host}:${port}.`
            )
          );
        }, 5000);

      socket.once(
        "connect",
        () => {
          clearTimeout(timeout);
          socket.end();

          console.log(
            `SUCCESS: ${name} emulator is listening on ${host}:${port}.`
          );

          resolve();
        }
      );

      socket.once(
        "error",
        (error) => {
          clearTimeout(timeout);

          reject(
            new Error(
              `${name} emulator connection failed: ${error.message}`
            )
          );
        }
      );
    }
  );
}

async function main() {
  for (
    const emulator of
    expectedPorts
  ) {
    await connectToPort(
      emulator
    );
  }

  const exportedFunctions =
    require(
      "../functions/index.js"
    );

  const requiredFunctions = [
    "backfillShiftIdsV2",
    "adminCreateShiftV2",
    "adminAssignShiftV2",
    "manageAdminAccessV2",
  ];

  for (
    const functionName of
    requiredFunctions
  ) {
    if (
      typeof exportedFunctions[
        functionName
      ] !== "function"
    ) {
      throw new Error(
        `${functionName} did not load as a function.`
      );
    }

    console.log(
      `SUCCESS: ${functionName} loaded correctly.`
    );
  }

  console.log("");
  console.log(
    "SUCCESS: Authentication, Firestore and Functions emulators are ready."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
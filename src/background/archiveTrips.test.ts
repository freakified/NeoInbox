/**
 * Finding past trips from the Trips view: one action that imports the
 * archive (listing it, then reading each message once), then reads the
 * travel mail in it for reservations.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../test/boot";
import { ARCHIVE, personalMail, shapes } from "../test/fixtures";
import { settle, type FakeMessageSpec, type FakeMessengerOptions } from "../test/fakeMessenger";

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

let app: Booted | undefined;
afterEach(async () => {
  await app?.db.delete();
  app = undefined;
});

const open = async (options: FakeMessengerOptions): Promise<Booted> => {
  const booted = await boot(options);
  await booted.store().init();
  await booted.backfill.runBackfill();
  await settle();
  return booted;
};

/** A round trip to Tokyo booked a month before it, `daysAgo` days back. */
const pastFlight = (daysAgo: number, over: FakeMessageSpec = {}): FakeMessageSpec => {
  const out = Date.now() - daysAgo * DAY;
  const leg = (n: string, from: string, to: string, at: number) => ({
    "@type": "FlightReservation",
    reservationNumber: "KYT8Q2",
    reservationFor: {
      "@type": "Flight",
      flightNumber: n,
      airline: { "@type": "Airline", iataCode: "JL" },
      departureAirport: { "@type": "Airport", iataCode: from },
      arrivalAirport: { "@type": "Airport", iataCode: to },
      departureTime: new Date(at).toISOString(),
      arrivalTime: new Date(at + 11 * 3600_000).toISOString(),
    },
  });
  return personalMail({
    author: "JAL <info@jal.example>",
    subject: "Your booking confirmation KYT8Q2",
    date: out - 30 * DAY,
    html:
      `<script type="application/ld+json">${JSON.stringify([
        leg("1", "SFO", "HND", out),
        leg("2", "HND", "SFO", out + 9 * DAY),
      ])}</script><p>Confirmation code: KYT8Q2</p>`,
    ...over,
  });
};

const background = async () => ({
  ...(await import("./extract")),
  ...(await import("./archiveImport")),
  ...(await import("./archiveJob")),
});

describe("finding past trips in archived mail", () => {
  it("imports the archive first, then finds the trip in it", async () => {
    app = await open(shapes.withArchive([], [pastFlight(300), personalMail({ subject: "Lunch?" })]));
    const { runTripScan } = await background();

    await runTripScan({ archive: true, importSince: Date.now() - 2 * YEAR });
    await settle();

    expect(Object.values(app.store().tripsById).map((t) => t.name)).toEqual(["Trip to Tokyo"]);
    expect(app.store().tripScan).toMatchObject({ running: false, archive: true });
    expect(app.store().tripScan?.scannedBackTo).toBeTypeOf("number");
    // Each archived message read once by the import, and the travel mail
    // once more by the trip scan.
    expect(app.mail.calls.getFull).toHaveLength(3);
  });

  it("doesn't import again when the archive already reaches that far", async () => {
    app = await open(shapes.withArchive([], [pastFlight(300)]));
    const { runArchiveImport, runTripScan } = await background();
    await runArchiveImport(Date.now() - 5 * YEAR);
    await settle();
    app.mail.calls.enumeratedFolders.length = 0;

    await runTripScan({ archive: true, importSince: Date.now() - 2 * YEAR });
    await settle();

    expect(app.mail.calls.enumeratedFolders).not.toContain(ARCHIVE);
    expect(app.store().archiveImport).toMatchObject({ imported: 0, sorted: 0 });
    expect(Object.keys(app.store().tripsById)).toHaveLength(1);
  });

  it("keeps the widest import as the archive's reach", async () => {
    app = await open(shapes.withArchive([], [personalMail()]));
    const { runArchiveImport, archiveCovers, getArchiveImportStatus } = await background();
    const fiveYears = Date.now() - 5 * YEAR;
    await runArchiveImport(fiveYears);
    await runArchiveImport(Date.now() - YEAR);

    expect(await getArchiveImportStatus()).toMatchObject({ coveredSince: fiveYears });
    expect(await archiveCovers(Date.now() - 2 * YEAR)).toBe(true);
    expect(await archiveCovers(null)).toBe(false);
  });

  it("gives up on a body that keeps failing to fetch", async () => {
    app = await open(shapes.withArchive([], [pastFlight(300, { bodyUnavailable: true })]));
    const { runTripScan } = await background();

    for (let run = 0; run < 7; run++) {
      await runTripScan({ archive: true, importSince: null });
      await settle();
    }

    // The import tries the body once a run, since it can't sort the message
    // without it; the trip scan gives up after five.
    expect(app.mail.calls.getFull).toHaveLength(7 + 5);
    expect(await app.db.reservations.toArray()).toMatchObject([{ status: "none", fetchFailures: 5 }]);
  });

  it("picks an interrupted scan back up after a restart", async () => {
    app = await open(shapes.withArchive([], [pastFlight(300)]));
    // What a quit mid-scan leaves behind.
    app.mail.storageData["neoinbox-archive-job"] = { kind: "trips", importSince: null };
    const { resumeArchiveJob } = await background();

    await resumeArchiveJob();
    await settle();

    expect(Object.values(app.store().tripsById).map((t) => t.name)).toEqual(["Trip to Tokyo"]);
    expect(app.mail.storageData["neoinbox-archive-job"]).toBeUndefined();
  });
});

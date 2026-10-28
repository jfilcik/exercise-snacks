export type CalendarSource = { type: "bookings"; url: string } | { type: "google" };

export function parseBookingUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new Error("Paste a complete public Microsoft personal Bookings meeting-type URL."); }
  if (url.protocol !== "https:" || !["bookings.cloud.microsoft", "outlook.office.com"].includes(url.hostname) ||
      url.port || url.username || url.password) {
    throw new Error("Use an HTTPS personal Bookings link from bookings.cloud.microsoft or outlook.office.com.");
  }
  const match = /^\/bookwithme\/user\/([^/]+)\/meetingtype\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match) throw new Error("Copy the link for one public personal Bookings meeting type, not a shared/team booking page.");
  let mailbox: string;
  try { mailbox = decodeURIComponent(match[1]); }
  catch { throw new Error("The Bookings link contains an invalid mailbox address."); }
  if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(mailbox)) {
    throw new Error("The Bookings link contains an unsupported mailbox address.");
  }
  return {
    mailbox, meetingType: match[2],
    url: `https://bookings.cloud.microsoft/bookwithme/user/${encodeURIComponent(mailbox)}/meetingtype/${match[2]}?anonymous`,
  };
}

export function parseCalendarSource(value: unknown): CalendarSource | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Choose Microsoft Bookings or Google Calendar.");
  const source = value as Record<string, unknown>;
  if (source.type === "google") return { type: "google" };
  if (source.type === "bookings" && typeof source.url === "string") {
    return { type: "bookings", url: parseBookingUrl(source.url).url };
  }
  throw new Error("Choose a calendar source and add its required settings.");
}

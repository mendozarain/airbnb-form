const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function localDate(value: Date, timeZone: string) {
  const formatter =
    DATE_FORMATTERS.get(timeZone) ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  DATE_FORMATTERS.set(timeZone, formatter);
  const parts = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysToDateOnly(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function zonedDateTime(value: string, hour: number, timeZone: string) {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = targetAsUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const offset = timeZoneOffset(new Date(guess), timeZone);
    guess = targetAsUtc - offset;
  }
  return new Date(guess);
}

export function deliveryDueAt(checkIn: string, timeZone: string) {
  return zonedDateTime(addDaysToDateOnly(checkIn, -1), 14, timeZone);
}

export function endOfCheckInDay(checkIn: string, timeZone: string) {
  return zonedDateTime(addDaysToDateOnly(checkIn, 1), 0, timeZone);
}

function timeZoneOffset(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return representedAsUtc - value.getTime();
}

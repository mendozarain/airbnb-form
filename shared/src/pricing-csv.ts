export type PricingCsvDay = {
  date: string;
  airbnbPrice: number;
  minStay: number;
  available: boolean;
  occupancyRatio: number;
  event?: string | null;
  reasons: string[];
  platformPrices?: Array<{ channelType: string; price: number }>;
};

export type PricingCsvRestrictions = {
  channelType: string;
  listingId: string;
  restrictions: Array<{ start_date: string; end_date: string; min_stay_on_arrival: number }>;
};

export function pricingPreviewCsv(input: { days: PricingCsvDay[]; restrictions?: PricingCsvRestrictions[] }) {
  const channels = uniqueChannels(input.days);
  const header = [
    "date",
    "available",
    "min_stay",
    "airbnb_price",
    "event",
    "occupancy_ratio",
    "reasons",
    ...channels.map((channel) => `${channel}_price`)
  ];
  const lines = [header.join(",")];
  for (const day of input.days) {
    const prices = new Map(
      (day.platformPrices ?? []).map((item) => [item.channelType.toLowerCase(), item.price])
    );
    lines.push(
      [
        day.date,
        day.available ? "yes" : "no",
        String(day.minStay),
        String(day.airbnbPrice),
        csvCell(day.event ?? ""),
        day.occupancyRatio.toFixed(3),
        csvCell(day.reasons.join(" | ")),
        ...channels.map((channel) => String(prices.get(channel) ?? ""))
      ].join(",")
    );
  }
  lines.push("");
  lines.push("channel_type,listing_id,start_date,end_date,min_stay_on_arrival");
  for (const listing of input.restrictions ?? []) {
    for (const range of listing.restrictions) {
      lines.push(
        [
          csvCell(listing.channelType),
          csvCell(listing.listingId),
          range.start_date,
          range.end_date,
          String(range.min_stay_on_arrival)
        ].join(",")
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function uniqueChannels(days: PricingCsvDay[]) {
  const channels: string[] = [];
  for (const day of days) {
    for (const price of day.platformPrices ?? []) {
      const channel = price.channelType.toLowerCase();
      if (!channels.includes(channel)) channels.push(channel);
    }
  }
  return channels;
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

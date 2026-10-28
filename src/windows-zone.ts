import zones from "cldr-core/supplemental/windowsZones.json" with { type: "json" };
import { validateTimeZone } from "./time.ts";

export function windowsToIana(zone: string): string {
  const mapped = zones.supplemental.windowsZones.mapTimezones.find(
    ({ mapZone }) => mapZone._other === zone && mapZone._territory === "001",
  );
  return validateTimeZone(mapped?.mapZone._type.split(" ")[0] ?? zone);
}

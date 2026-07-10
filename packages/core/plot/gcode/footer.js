// G-code program footer — reads the machine profile (default DDCS). Join convention preserved (no trailing
// extra \n; the profile's trailing "" element supplies the final newline).
import { DDCS } from "./profiles.js";

export function footer(settings, profile = DDCS) {
    return profile.footer(settings).join("\n");
}

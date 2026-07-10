// G-code program header — reads the machine profile (default DDCS). The DDCS strings now live in profiles.js
// (declared); this keeps the join convention (lines joined by \n + a trailing \n) so the bytes are unchanged.
import { DDCS } from "./profiles.js";

export function header(settings, profile = DDCS) {
    return profile.header(settings).join("\n") + "\n";
}

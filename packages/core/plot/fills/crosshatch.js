// Two perpendicular hatches.

import * as hatch from "./hatch.js";

export function generate(shape, opts = {}) {
    const angle = opts.angle ?? 45;
    return hatch.generate(shape, { ...opts, angle })
        .concat(hatch.generate(shape, { ...opts, angle: angle + 90 }));
}

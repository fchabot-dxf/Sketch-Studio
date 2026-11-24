// tests/helpers/review-built.js -- TASK 880 (owner turn 3485): the Export view's 3D build is no longer told on screen (the "N triangles · N levels · built in N ms"
// line went to the debug log only). A live test waits for the build through the view's own seam, main.js currentReviewView().lastBuild (what the perf runs
// read): built = a board with triangles, and the info line is not waiting for the paths (its turning ring) or for a Recalculate (its action button).
//   reviewBuilt({ when, levels }) -> a JS expression (a promise of true / false) for cdp waitFor: `when` = an extra page condition checked first,
//   `levels` = the build's exact level count.
//   REVIEW_BUILD -> a JS expression: the last build ({ triangles, levels, ms, ... }).
export const reviewBuilt = ({ when = 'true', levels = null } = {}) => `(async () => {
  if (!(${when})) return false;
  const v = (await import('/apps/shaper/src/main.js')).currentReviewView();
  const info = document.getElementById('review-info');
  return !!(v && v.lastBuild && v.lastBuild.triangles > 0${levels != null ? ` && v.lastBuild.levels === ${levels}` : ''}) && !info.querySelector('.sk-wait-spin, .sk-wait-action');
})()`;

export const REVIEW_BUILT = reviewBuilt();

export const REVIEW_BUILD = `import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().lastBuild)`;

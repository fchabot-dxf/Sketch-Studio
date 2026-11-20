// scripts/site-about.cjs — TASK 828 (owner turn 2828: "in a about page we can list the different related apps"): the About page of every site.
// about.html at the repo root is the page's frame (styles, light / dark); the LIST is written into it at build time from the existing declarations, nothing typed twice:
//   which apps, in what order, their name, description and icon   packages/ui/app-registry.js (APPS; an entry with `about: false` is left out: Trace, owner turn 2876)
//   each app's address                                            SITE_HOST of build-site.cjs
//   the Fusion add-in line + download link                        ADDIN_DOWNLOAD of build-site.cjs; it sits INSIDE its app's entry (owner turn 2889), no entry of its own
//   the build stamp                                               the same minute build-site stamps into analytics.js
'use strict';
const fs = require('fs');
const path = require('path');
const { APPS: REGISTRY } = require('../packages/ui/app-registry.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const APPS_MARK = '<!--ABOUT:APPS-->', BUILD_MARK = '<!--ABOUT:BUILD-->';

const aboutApps = () => REGISTRY.filter((a) => a.about !== false);

function appItem(app, { hostOf, addinUrl, addinLine, addinApp }) {
  const host = hostOf[app.id];
  if (!host) throw new Error(`site-about: no SITE_HOST address for the app "${app.id}"`);
  const icon = 'data:image/svg+xml,' + encodeURIComponent(app.icon);
  const addin = app.id === addinApp
    ? `\n      <p class="addin">${esc(addinLine)} <a href="${esc(addinUrl)}">Download the add-in (.zip)</a></p>` : '';
  return `<li class="app" data-app="${app.id}">
    <img src="${icon}" alt="" width="56" height="56">
    <div>
      <h2>${esc(app.name)}</h2>
      <p>${esc(app.description)}</p>
      <p><a href="https://${host}/">${host}</a></p>${addin}
    </div>
  </li>`;
}

// the About page text from its frame
function aboutHtml(frame, opts) {
  if (!frame.includes(APPS_MARK) || !frame.includes(BUILD_MARK)) throw new Error(`site-about: about.html must hold ${APPS_MARK} and ${BUILD_MARK}`);
  return frame.replace(APPS_MARK, () => aboutApps().map((a) => appItem(a, opts)).join('\n')).replace(BUILD_MARK, () => `Build ${esc(opts.build)}`);
}

// write the list into <out>/about.html (copied there as the frame)
function writeAbout(out, opts) {
  const file = path.join(out, 'about.html');
  fs.writeFileSync(file, aboutHtml(fs.readFileSync(file, 'utf8'), opts));
}

module.exports = { aboutApps, aboutHtml, writeAbout, APPS_MARK, BUILD_MARK };

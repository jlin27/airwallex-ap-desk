import { writeFile } from "node:fs/promises";

/**
 * Two palette directions for the AP Desk Bill review screen.
 * Anatomy, type ramp, radii and control heights are lifted from app/globals.css —
 * only the token values change, so the comparison is a recolour and not a redesign.
 */

const AIRWALLEX = {
  key: "airwallex",
  label: "Direction A · Airwallex-like",
  ink: "#12100f", ink2: "#3d3936", muted: "#6b6764", faint: "#9b9793",
  canvas: "#f7f7f6", panel: "#ffffff", line: "#e6e4e1", lineStrong: "#d3cfcb",
  nav: "#12100f", navInk: "#f2f0ee", navMuted: "#9b9490", navActive: "#262220",
  accent: "#ff5a1f", accentSoft: "#fff1ea", accentInk: "#ffffff",
  ok: "#0e7a53", okSoft: "#e7f4ee",
  warn: "#a1660a", warnSoft: "#fdf3df",
  bad: "#c0392b", badSoft: "#fbeceb",
  mark: "#ff5a1f", markInk: "#ffffff",
};

const STRIPE = {
  key: "stripe",
  label: "Direction B · Stripe-like",
  ink: "#0a2540", ink2: "#425466", muted: "#5b6b7f", faint: "#8898aa",
  canvas: "#f6f9fc", panel: "#ffffff", line: "#e3e8ee", lineStrong: "#cfd7e0",
  nav: "#0a2540", navInk: "#eef3f8", navMuted: "#8fa2b7", navActive: "#14385c",
  accent: "#635bff", accentSoft: "#efeefe", accentInk: "#ffffff",
  ok: "#0e7c5a", okSoft: "#e6f4ef",
  warn: "#9a6700", warnSoft: "#fdf3da",
  bad: "#cd3d64", badSoft: "#fbecf0",
  mark: "#635bff", markInk: "#ffffff",
};

const css = (p) => `
  * { box-sizing: border-box; }
  body { margin: 0; background: ${p.canvas}; color: ${p.ink};
    font-family: "Geist", system-ui, Arial, sans-serif; }
  a { color: ${p.accent}; } a:hover { color: ${p.ink}; }
  .shell { width: 1440px; height: 900px; display: grid; grid-template-columns: 224px minmax(0,1fr); overflow: hidden; }

  .nav { height: 900px; padding: 22px 15px; background: ${p.nav}; color: ${p.navInk}; display: flex; flex-direction: column; }
  .brand { min-height: 42px; padding: 0 9px; display: flex; align-items: center; gap: 11px; font-weight: 780; letter-spacing: -.025em; }
  .mark { width: 31px; height: 31px; display: grid; place-items: center; border-radius: 8px; background: ${p.mark}; color: ${p.markInk}; font-size: 10px; font-weight: 900; }
  .rail { margin-top: 32px; display: grid; }
  .step { display: grid; grid-template-columns: 25px minmax(0,1fr); align-items: center; gap: 11px; }
  .step i { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 50%; font: 800 10px "Geist Mono", monospace; font-style: normal; }
  .step strong, .step small { display: block; white-space: nowrap; }
  .step strong { font-size: 12px; letter-spacing: -.01em; }
  .step small { margin-top: 3px; font-size: 9px; }
  .step.done i { background: ${p.okSoft}; color: ${p.ok}; } .step.done strong { color: ${p.navInk}; } .step.done small { color: ${p.navMuted}; }
  .step.on i { background: ${p.accent}; color: ${p.accentInk}; } .step.on strong { color: #fff; } .step.on small { color: ${p.navMuted}; }
  .step.off i { background: ${p.navActive}; color: ${p.navMuted}; } .step.off strong { color: ${p.navMuted}; } .step.off small { color: ${p.navMuted}; opacity: .7; }
  .conn { width: 1px; height: 16px; margin: 4px 0 4px 12px; background: ${p.navActive}; }
  .navfoot { margin-top: auto; }
  .badge { min-height: 42px; padding: 0 11px; display: flex; align-items: center; gap: 8px; border: 1px solid ${p.navActive}; border-radius: 7px; color: ${p.navMuted}; font: 700 10px "Geist Mono", monospace; text-transform: uppercase; letter-spacing: .05em; }
  .badge i { width: 7px; height: 7px; border-radius: 50%; background: ${p.ok}; }
  .who { margin-top: 15px; padding: 15px 7px 0; border-top: 1px solid ${p.navActive}; display: flex; align-items: center; gap: 10px; }
  .who > span { width: 31px; height: 31px; display: grid; place-items: center; border-radius: 50%; background: ${p.navActive}; font-size: 10px; font-weight: 800; color: ${p.navInk}; }
  .who strong { display: block; font-size: 11px; } .who small { display: block; margin-top: 3px; color: ${p.navMuted}; font-size: 10px; }

  .main { min-width: 0; padding: 30px 40px; }
  .eyebrow { margin: 0 0 8px; color: ${p.faint}; font: 750 10px "Geist Mono", monospace; text-transform: uppercase; letter-spacing: .08em; }
  h1 { margin: 0 0 7px; font-size: 24px; font-weight: 600; line-height: 1.15; letter-spacing: -.035em; }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  .head p:last-child { margin: 0; color: ${p.muted}; font-size: 14px; }
  .btn { min-height: 38px; padding: 0 13px; display: inline-flex; align-items: center; border: 1px solid ${p.badSoft}; border-radius: 7px; background: ${p.panel}; color: ${p.bad}; font-size: 12px; font-weight: 700; }

  .work { margin-top: 22px; display: grid; grid-template-columns: minmax(300px,.78fr) minmax(420px,1.25fr) minmax(300px,.82fr); border: 1px solid ${p.line}; border-radius: 10px; background: ${p.panel}; box-shadow: 0 8px 28px rgba(10,20,30,.05); overflow: hidden; height: 700px; }
  .queue { border-right: 1px solid ${p.line}; background: ${p.canvas}; }
  .qhead { padding: 17px 18px 12px; }
  .qhead h2 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.025em; }
  .tabs { padding: 0 12px 12px; display: flex; flex-wrap: wrap; gap: 3px; border-bottom: 1px solid ${p.line}; }
  .tabs span { min-height: 30px; padding: 0 7px; display: inline-flex; align-items: center; gap: 5px; border-radius: 5px; color: ${p.faint}; font-size: 10px; font-weight: 700; }
  .tabs span.on { background: ${p.accentSoft}; color: ${p.accent}; }
  .tabs b { color: ${p.faint}; font-weight: 700; }
  .tabs span.on b { color: ${p.accent}; }
  .row { min-height: 104px; padding: 15px 14px; display: grid; grid-template-columns: 34px minmax(0,1fr) auto; align-items: start; gap: 10px; border-bottom: 1px solid ${p.line}; }
  .row.sel { background: ${p.panel}; box-shadow: inset 3px 0 ${p.accent}; }
  .av { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid ${p.lineStrong}; border-radius: 8px; background: ${p.panel}; color: ${p.ink2}; font-size: 10px; font-weight: 850; }
  .rmain strong { display: block; margin-top: 1px; font-size: 12px; }
  .rmain small { display: block; margin-top: 5px; color: ${p.muted}; font-size: 9px; }
  .tag { width: fit-content; margin-top: 10px; padding: 4px 6px; display: block; border-radius: 4px; font-size: 8px; font-style: normal; font-weight: 800; text-transform: uppercase; letter-spacing: .035em; }
  .tag.warn { background: ${p.warnSoft}; color: ${p.warn}; }
  .tag.ok { background: ${p.okSoft}; color: ${p.ok}; }
  .tag.bad { background: ${p.badSoft}; color: ${p.bad}; }
  .amt { text-align: right; font-size: 11px; font-weight: 750; }
  .amt small { display: block; margin-top: 4px; color: ${p.faint}; font-size: 8px; }

  .detail { border-right: 1px solid ${p.line}; min-width: 0; }
  .dhead { padding: 24px 25px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; border-bottom: 1px solid ${p.line}; }
  .dhead h2 { margin: 0 0 7px; font-size: 21px; font-weight: 600; letter-spacing: -.035em; }
  .dhead p { margin: 0; color: ${p.muted}; font-size: 11px; }
  .damt { text-align: right; min-width: 125px; }
  .damt span, .damt small { display: block; color: ${p.muted}; font-size: 9px; }
  .damt strong { display: block; margin: 5px 0; font-size: 20px; letter-spacing: -.035em; }
  .facts { padding: 23px 25px 25px; }
  .ftitle { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .ftitle h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -.025em; }
  .live { padding: 5px 7px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid ${p.okSoft}; border-radius: 12px; background: ${p.okSoft}; color: ${p.ok}; font: 700 8px "Geist Mono", monospace; text-transform: uppercase; }
  .live i { width: 5px; height: 5px; border-radius: 50%; background: ${p.ok}; }
  .frows { margin-top: 16px; border: 1px solid ${p.line}; border-radius: 8px; overflow: hidden; }
  .frows > div { min-height: 66px; padding: 12px 13px; display: flex; align-items: center; gap: 11px; border-bottom: 1px solid ${p.line}; }
  .frows > div:last-child { border-bottom: 0; }
  .fi { flex: 0 0 auto; width: 23px; height: 23px; display: grid; place-items: center; border-radius: 50%; font-size: 10px; font-weight: 850; }
  .fi.ok { background: ${p.okSoft}; color: ${p.ok}; }
  .fi.warn { background: ${p.warnSoft}; color: ${p.warn}; }
  .fi.none { background: ${p.canvas}; color: ${p.faint}; }
  .frows strong { display: block; font-size: 11px; }
  .frows small { display: block; margin-top: 4px; color: ${p.muted}; font-size: 9px; }

  .agent { min-width: 0; padding: 22px 20px; background: ${p.canvas}; display: flex; flex-direction: column; }
  .ahead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .model { padding: 4px 6px; border-radius: 4px; background: ${p.accentSoft}; color: ${p.accent}; font: 700 8px "Geist Mono", monospace; text-transform: uppercase; }
  .pill { display: inline-block; margin-top: 18px; padding: 5px 7px; border-radius: 5px; background: ${p.warnSoft}; color: ${p.warn}; font-size: 8px; font-weight: 850; text-transform: uppercase; letter-spacing: .04em; }
  .agent h2 { margin: 14px 0 7px; font-size: 17px; font-weight: 600; line-height: 1.35; letter-spacing: -.025em; }
  .src { margin: 0 0 16px; color: ${p.muted}; font-size: 9px; }
  .reasons { margin: 0 0 17px; padding: 0; list-style: none; display: grid; gap: 9px; }
  .reasons li { display: flex; align-items: flex-start; gap: 8px; color: ${p.ink2}; font-size: 10px; line-height: 1.45; }
  .reasons li > span { flex: 0 0 auto; min-width: 8px; font-weight: 850; text-align: center; }
`;

const composer = (p) => `
      <form class="ask" style="margin-top:20px;padding:13px;border:1px solid ${p.lineStrong};border-radius:8px;background:${p.panel}">
        <p style="margin:0 0 10px;color:${p.ink2};font-size:11px;font-weight:700">Ask the agent about Northstar Cloud</p>
        <div style="margin:0 0 10px;display:flex;flex-wrap:wrap;gap:6px">
          <span style="padding:6px 8px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.ink2};font-size:8px;font-weight:700">Why was this flagged?</span>
          <span style="padding:6px 8px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.ink2};font-size:8px;font-weight:700">What evidence would clear it?</span>
          <span style="padding:6px 8px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.ink2};font-size:8px;font-weight:700">Draft a request</span>
        </div>
        <div style="min-height:58px;padding:9px 10px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.canvas};color:${p.faint};font-size:10px">Example: The submitter says usage increased after launch. Is that enough?</div>
        <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:10px">
          <small style="color:${p.faint};font-size:8px">Anything entered here is treated as unverified.</small>
          <span style="min-height:34px;padding:0 13px;display:inline-flex;align-items:center;border-radius:7px;background:${p.accent};color:${p.accentInk};font-size:10px;font-weight:750">Ask assistant</span>
        </div>
      </form>`;

const popup = (p) => `
    <div style="position:absolute;right:34px;bottom:34px;width:372px;border:1px solid ${p.lineStrong};border-radius:12px;background:${p.panel};box-shadow:0 18px 48px rgba(10,20,30,.18);overflow:hidden">
      <div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid ${p.line}">
        <div>
          <strong style="display:block;font-size:13px;letter-spacing:-.02em">AP assistant</strong>
          <small style="display:block;margin-top:3px;color:${p.muted};font-size:9px">Northstar Cloud &middot; NC-0901</small>
        </div>
        <span style="width:22px;height:22px;display:grid;place-items:center;border-radius:5px;background:${p.canvas};color:${p.muted};font-size:13px">&times;</span>
      </div>
      <div style="padding:14px 16px;border-bottom:1px solid ${p.line}">
        <div style="padding-left:11px;border-left:3px solid ${p.accent}">
          <strong style="font-size:10px">AI assistant</strong>
          <p style="margin:6px 0 0;color:${p.ink2};font-size:10px;line-height:1.55">The 38% increase is verified against two prior bills. A renewal notice or approval record would let a person clear it.</p>
        </div>
      </div>
      <div style="padding:12px 16px">
        <div style="min-height:44px;padding:9px 10px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.canvas};color:${p.faint};font-size:10px">Ask about this bill&hellip;</div>
      </div>
    </div>
    <div style="position:absolute;right:34px;bottom:34px;width:52px;height:52px;display:none"></div>`;

function screen(p, { assistant }) {
  const isPopup = assistant === "popup";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@700;800&family=Geist:wght@400;600;750;800;900&display=swap">
  <style>${css(p)}</style>
</helmet>
<div class="shell" style="position:relative">
  <aside class="nav">
    <div class="brand"><span class="mark">AP</span><span>AP Desk</span></div>
    <div class="rail">
      <div class="step done"><i>1</i><span><strong>Inbox</strong><small>Read an invoice</small></span></div>
      <span class="conn"></span>
      <div class="step on"><i>2</i><span><strong>Review</strong><small>4 open &middot; 2 need attention</small></span></div>
      <span class="conn"></span>
      <div class="step off"><i>3</i><span><strong>Decision</strong><small>After exceptions clear</small></span></div>
    </div>
    <div class="navfoot">
      <div class="badge"><i></i><span>Airwallex Sandbox</span></div>
      <div class="who"><span>DO</span><div><strong>Demo operator</strong><small>Unauthenticated session</small></div></div>
    </div>
  </aside>

  <main class="main">
    <header class="head">
      <div>
        <p class="eyebrow">Accounts payable</p>
        <h1>Bill review</h1>
        <p>AI reviews incoming bills, explains exceptions, and recommends the safest next step.</p>
      </div>
      <span class="btn">Reset demo</span>
    </header>

    <div class="work">
      <section class="queue">
        <div class="qhead"><p class="eyebrow">Inbox</p><h2>Bills to review</h2></div>
        <div class="tabs">
          <span class="on">All <b>4</b></span><span>Attention <b>2</b></span><span>Ready <b>1</b></span><span>On hold <b>0</b></span><span>Closed <b>1</b></span>
        </div>
        <div class="row">
          <span class="av">SN</span>
          <div class="rmain"><strong>Studio North</strong><small>SN-552 &middot; Due Sep 27, 2026</small><i class="tag bad">Duplicate confirmed</i></div>
          <div class="amt">$500.00<small>USD</small></div>
        </div>
        <div class="row sel">
          <span class="av">NC</span>
          <div class="rmain"><strong>Northstar Cloud</strong><small>NC-0901 &middot; Due Sep 25, 2026</small><i class="tag warn">Amount changed</i></div>
          <div class="amt">$138.00<small>USD</small></div>
        </div>
        <div class="row">
          <span class="av">CA</span>
          <div class="rmain"><strong>Codex AP Feasibility Vendor</strong><small>CODEX-1789 &middot; Due Sep 29, 2026</small><i class="tag warn">Beneficiary missing</i></div>
          <div class="amt">$1.00<small>USD</small></div>
        </div>
        <div class="row">
          <span class="av">AU</span>
          <div class="rmain"><strong>OB-1001 AU Payroll Bureau</strong><small>PAY-0901 &middot; Due Sep 22, 2026</small><i class="tag ok">Ready to validate</i></div>
          <div class="amt">A$100.00<small>AUD</small></div>
        </div>
      </section>

      <section class="detail">
        <div class="dhead">
          <div><p class="eyebrow">Invoice NC-0901</p><h2>Northstar Cloud</h2><p>Cloud infrastructure subscription</p></div>
          <div class="damt"><span>Amount due</span><strong>$138.00</strong><small>Due Sep 25, 2026</small></div>
        </div>
        <div class="facts">
          <div class="ftitle">
            <div><p class="eyebrow">Server checks</p><h3>Verified financial facts</h3></div>
            <span class="live"><i></i> Live API data</span>
          </div>
          <div class="frows">
            <div><span class="fi ok">&#10003;</span><div><strong>Duplicate check</strong><small>No matching vendor and invoice number</small></div></div>
            <div><span class="fi warn">!</span><div><strong>Amount history</strong><small>38% above the $100.00 prior average</small></div></div>
            <div><span class="fi warn">!</span><div><strong>Beneficiary and route</strong><small>No verified payout route</small></div></div>
            <div><span class="fi none">&mdash;</span><div><strong>Wallet funds</strong><small>Checked after beneficiary matching</small></div></div>
          </div>
        </div>
      </section>

      <aside class="agent">
        <div class="ahead"><p class="eyebrow">AP exception agent</p><span class="model">Live model</span></div>
        <div>
          <span class="pill">Amount changed</span>
          <h2>Confirm the reason for the higher charge before proceeding.</h2>
          <p class="src">Server decision &middot; explained by the model &middot; high confidence</p>
          <ul class="reasons">
            <li><span style="color:${p.warn}">!</span><span>The current amount is $138, against a $100 average across two prior bills &mdash; a 38% increase.</span></li>
            <li><span style="color:${p.bad}">&times;</span><span>No duplicate match, but the beneficiary did not match and no transfer route is available.</span></li>
          </ul>
        </div>${isPopup ? "" : composer(p)}
      </aside>
    </div>
  </main>${isPopup ? popup(p) : ""}
</div>
</x-dc>
</body>
</html>
`;
}

const swatch = (p) => {
  const items = [
    ["Ink", p.ink], ["Body", p.ink2], ["Muted", p.muted],
    ["Canvas", p.canvas], ["Panel", p.panel], ["Line", p.line],
    ["Nav", p.nav], ["Accent", p.accent], ["Accent soft", p.accentSoft],
    ["Success", p.ok], ["Warning", p.warn], ["Danger", p.bad],
  ];
  return `
    <section style="flex:1;min-width:0">
      <p style="margin:0 0 4px;font:750 10px 'Geist Mono',monospace;text-transform:uppercase;letter-spacing:.08em;color:${p.accent}">${p.label}</p>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:16px">
        ${items.map(([n, v]) => `<div>
          <div style="height:56px;border-radius:7px;background:${v};border:1px solid rgba(0,0,0,.09)"></div>
          <strong style="display:block;margin-top:8px;font-size:11px;font-weight:600;color:#12100f">${n}</strong>
          <code style="display:block;margin-top:2px;font:11px 'Geist Mono',monospace;color:#6b6764">${v}</code>
        </div>`).join("")}
      </div>
    </section>`;
};

const palettes = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;700&family=Geist:wght@400;600;750&display=swap">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #ffffff; color: #12100f; font-family: "Geist", system-ui, Arial, sans-serif; }
    a { color: #ff5a1f; } a:hover { color: #12100f; }
  </style>
</helmet>
<div style="width:1440px;height:660px;padding:52px 56px;display:flex;flex-direction:column;gap:26px;background:#ffffff">
  <div>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;letter-spacing:-.03em">Two palette directions</h1>
    <p style="margin:0;max-width:76ch;color:#6b6764;font-size:14px;line-height:1.55">Same anatomy, type ramp, radii and control heights as the shipped app &mdash; only the token values change. Stripe&rsquo;s values are their published brand colours; the Airwallex set is an approximation from their marketing site, not an extracted brand palette.</p>
  </div>
  <div style="display:flex;gap:56px">
    ${swatch(AIRWALLEX)}
    ${swatch(STRIPE)}
  </div>
  <div style="margin-top:auto;padding-top:20px;border-top:1px solid #e6e4e1;display:flex;gap:56px">
    <p style="flex:1;margin:0;color:#6b6764;font-size:12.5px;line-height:1.6"><strong style="color:#12100f">Trade-off:</strong> the orange accent sits close to the warning and danger hues. In an app whose whole job is status, an accent that reads as a state is a real cost &mdash; it has to be rationed to primary actions only.</p>
    <p style="flex:1;margin:0;color:#6b6764;font-size:12.5px;line-height:1.6"><strong style="color:#12100f">Trade-off:</strong> indigo sits well clear of red, amber and green, so semantic colour stays unambiguous. The cost is that it reads as developer-tool rather than finance, and the navy ground is heavier than the current near-white.</p>
  </div>
</div>
</x-dc>
</body>
</html>
`;

const canvas = {
  artboards: [
    { file: "Palettes.dc.html", x: 0, y: 0, w: 1440, h: 660, title: "Palettes" },
    { file: "Main.dc.html", x: 0, y: 840, w: 1440, h: 900, title: "A · Airwallex-like" },
    { file: "Stripe.dc.html", x: 1560, y: 840, w: 1440, h: 900, title: "B · Stripe-like" },
    { file: "Popup.dc.html", x: 3120, y: 840, w: 1440, h: 900, title: "Assistant as popup" },
  ],
  annotations: [
    { id: "note-palettes", x: 1560, y: 40, w: 430, text: "Both directions keep the app's existing anatomy, spacing and control sizes. Only colour changes, so you can judge the palette rather than a redesign.\n\nStripe's hexes are their published brand values. The Airwallex set is my approximation — their site exposes no hexes in markup, so treat it as a direction, not a brand match." },
    { id: "note-a", x: 0, y: 1820, w: 420, text: "DIRECTION A — white ground, near-black nav, orange accent.\n\nCloser to Airwallex's own marketing surface. The risk is visible in the queue: orange as the selection colour sits one hue away from the amber 'Amount changed' tag. Ration it to primary actions and selection only." },
    { id: "note-b", x: 1560, y: 1820, w: 420, text: "DIRECTION B — Stripe's #F6F9FC ground, #0A2540 navy, #635BFF indigo.\n\nThe accent is nowhere near any status colour, so the semantic palette stays unambiguous — which matters more here than brand proximity, because the whole screen is status. My recommendation of the two." },
    { id: "note-popup", x: 3120, y: 1820, w: 460, text: "THE POPUP QUESTION — shown in Direction A so it's a like-for-like comparison with the leftmost board.\n\nWhat it costs: the assistant is bill-scoped, and detaching it breaks the adjacency between the evidence and the question. The panel header has to re-state which bill it's about, because the floating window no longer sits beside it.\n\nIt also reads as a general-purpose helper — the 2023 bolt-on pattern — which is the opposite of the claim this app makes about scope." },
  ],
  launch: { view: "canvas" },
};

await writeFile(new URL("Palettes.dc.html", import.meta.url), palettes, "utf8");
await writeFile(new URL("Main.dc.html", import.meta.url), screen(AIRWALLEX, { assistant: "rail" }), "utf8");
await writeFile(new URL("Stripe.dc.html", import.meta.url), screen(STRIPE, { assistant: "rail" }), "utf8");
await writeFile(new URL("Popup.dc.html", import.meta.url), screen(AIRWALLEX, { assistant: "popup" }), "utf8");
await writeFile(new URL("canvas.json", import.meta.url), JSON.stringify(canvas, null, 2) + "\n", "utf8");
console.log("built 4 artboards + canvas.json");

/* ---------------------------------------------------------------------------
 * Merged layout: the server's check and the model's explanation share one row,
 * so the architecture is visible in the layout. Only the deciding check carries
 * prose — explaining a check that passed is what made the old panel redundant.
 * The assistant takes the whole right column.
 * ------------------------------------------------------------------------- */
function merged(p) {
  const check = (tone, glyph, name, status, fact, why) => `
        <div class="chk ${tone}">
          <span class="ci">${glyph}</span>
          <div>
            <div class="crow"><strong>${name}</strong><em>${status}</em></div>
            <small>${fact}</small>
            ${why ? `<p class="why">${why}</p>` : ""}
          </div>
        </div>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@700;800&family=Geist:wght@400;600;750;800;900&display=swap">
  <style>${css(p)}
  .work.merged { grid-template-columns: minmax(270px,.66fr) minmax(460px,1.35fr) minmax(330px,.86fr); }
  .decision { padding: 22px 25px 20px; border-bottom: 1px solid ${p.line}; }
  .dpill { display: inline-block; padding: 5px 7px; border-radius: 5px; background: ${p.warnSoft}; color: ${p.warn}; font-size: 8px; font-weight: 850; text-transform: uppercase; letter-spacing: .04em; }
  .decision h2 { margin: 13px 0 7px; font-size: 19px; font-weight: 600; line-height: 1.35; letter-spacing: -.03em; }
  .decision p { margin: 0; color: ${p.muted}; font-size: 9px; }
  .checks { padding: 6px 25px 22px; }
  .chk { padding: 15px 0; display: grid; grid-template-columns: 23px minmax(0,1fr); gap: 12px; border-bottom: 1px solid ${p.line}; }
  .chk:last-child { border-bottom: 0; }
  .ci { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 50%; font-size: 10px; font-weight: 850; }
  .chk.ok .ci { background: ${p.okSoft}; color: ${p.ok}; }
  .chk.warn .ci { background: ${p.warnSoft}; color: ${p.warn}; }
  .chk.none .ci { background: ${p.canvas}; color: ${p.faint}; }
  .crow { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .crow strong { font-size: 12px; }
  .crow em { font-style: normal; font: 800 8px "Geist Mono", monospace; text-transform: uppercase; letter-spacing: .05em; color: ${p.faint}; }
  .chk.warn .crow em { color: ${p.warn}; }
  .chk.ok .crow em { color: ${p.ok}; }
  .chk small { display: block; margin-top: 5px; color: ${p.muted}; font-size: 10px; }
  .why { margin: 9px 0 0; padding-left: 11px; border-left: 2px solid ${p.accent}; color: ${p.ink2}; font-size: 11px; line-height: 1.55; }
  .payout { margin-top: auto; padding: 18px 25px; border-top: 1px solid ${p.line}; }
  .pbtn { width: 100%; min-height: 41px; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; background: ${p.lineStrong}; color: ${p.panel}; font-size: 11px; font-weight: 750; }
  .pnote { margin: 9px 0 0; color: ${p.muted}; font-size: 9px; text-align: center; }
  .chat { min-width: 0; background: ${p.canvas}; display: flex; flex-direction: column; }
  .chead { padding: 20px 20px 16px; border-bottom: 1px solid ${p.line}; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .chead h3 { margin: 4px 0 0; font-size: 15px; font-weight: 600; letter-spacing: -.025em; }
  .msgs { flex: 1 1 auto; padding: 20px; display: grid; gap: 16px; align-content: start; }
  .msg { padding-left: 11px; border-left: 3px solid ${p.accent}; }
  .msg.you { border-left-color: ${p.warn}; }
  .msg strong { font-size: 10px; }
  .msg span { margin-left: 6px; padding: 3px 5px; border-radius: 4px; background: ${p.accentSoft}; color: ${p.accent}; font: 700 7px "Geist Mono", monospace; text-transform: uppercase; }
  .msg span.unv { background: ${p.warnSoft}; color: ${p.warn}; }
  .msg p { margin: 7px 0 0; color: ${p.ink2}; font-size: 10.5px; line-height: 1.6; }
  .cfoot { padding: 14px 20px 18px; border-top: 1px solid ${p.line}; }
  </style>
</helmet>
<div class="shell">
  <aside class="nav">
    <div class="brand"><span class="mark">AP</span><span>AP Desk</span></div>
    <div class="rail">
      <div class="step done"><i>1</i><span><strong>Inbox</strong><small>Read an invoice</small></span></div>
      <span class="conn"></span>
      <div class="step on"><i>2</i><span><strong>Review</strong><small>4 open &middot; 2 need attention</small></span></div>
      <span class="conn"></span>
      <div class="step off"><i>3</i><span><strong>Decision</strong><small>After exceptions clear</small></span></div>
    </div>
    <div class="navfoot">
      <div class="badge"><i></i><span>Airwallex Sandbox</span></div>
      <div class="who"><span>DO</span><div><strong>Demo operator</strong><small>Unauthenticated session</small></div></div>
    </div>
  </aside>

  <main class="main">
    <header class="head">
      <div>
        <p class="eyebrow">Accounts payable</p>
        <h1>Bill review</h1>
        <p>AI reviews incoming bills, explains exceptions, and recommends the safest next step.</p>
      </div>
      <span class="btn">Reset demo</span>
    </header>

    <div class="work merged">
      <section class="queue">
        <div class="qhead"><p class="eyebrow">Inbox</p><h2>Bills to review</h2></div>
        <div class="tabs">
          <span class="on">All <b>4</b></span><span>Attention <b>2</b></span><span>Ready <b>1</b></span><span>On hold <b>0</b></span>
        </div>
        <div class="row">
          <span class="av">SN</span>
          <div class="rmain"><strong>Studio North</strong><small>SN-552 &middot; Due Sep 27</small><i class="tag bad">Duplicate confirmed</i></div>
          <div class="amt">$500.00<small>USD</small></div>
        </div>
        <div class="row sel">
          <span class="av">NC</span>
          <div class="rmain"><strong>Northstar Cloud</strong><small>NC-0901 &middot; Due Sep 25</small><i class="tag warn">Amount changed</i></div>
          <div class="amt">$138.00<small>USD</small></div>
        </div>
        <div class="row">
          <span class="av">CA</span>
          <div class="rmain"><strong>Codex AP Feasibility Vendor</strong><small>CODEX-1789 &middot; Due Sep 29</small><i class="tag warn">Beneficiary missing</i></div>
          <div class="amt">$1.00<small>USD</small></div>
        </div>
        <div class="row">
          <span class="av">AU</span>
          <div class="rmain"><strong>OB-1001 AU Payroll Bureau</strong><small>PAY-0901 &middot; Due Sep 22</small><i class="tag ok">Ready to validate</i></div>
          <div class="amt">A$100.00<small>AUD</small></div>
        </div>
      </section>

      <section class="detail" style="display:flex;flex-direction:column">
        <div class="dhead">
          <div><p class="eyebrow">Invoice NC-0901</p><h2>Northstar Cloud</h2><p>Cloud infrastructure subscription</p></div>
          <div class="damt"><span>Amount due</span><strong>$138.00</strong><small>Due Sep 25, 2026</small></div>
        </div>

        <div class="decision">
          <span class="dpill">Amount changed</span>
          <h2>Confirm the reason for the higher charge before proceeding.</h2>
          <p>Server decision &middot; explained by the model &middot; high confidence</p>
        </div>

        <div class="checks">
          ${check("ok", "&#10003;", "Duplicate check", "Passed", "No matching vendor and invoice number.", "")}
          ${check("warn", "!", "Amount history", "Exception", "38% above the $100.00 average across 2 prior bills.", "The increase is verified against NC-0801 and NC-0701. A renewal notice or approval record would give a person grounds to clear it — chat text alone will not.")}
          ${check("warn", "!", "Beneficiary and route", "Exception", "No verified payout route for this vendor.", "")}
          ${check("none", "&mdash;", "Wallet funds", "Not checked", "Funding cannot be evaluated until a payout route is known.", "")}
        </div>

        <div class="payout">
          <span class="pbtn">Validate payout with Airwallex</span>
          <p class="pnote">Payout validation is disabled until finance reviews the 38% increase.</p>
        </div>
      </section>

      <aside class="chat">
        <div class="chead">
          <div><p class="eyebrow">Bill assistant</p><h3>Ask about this bill</h3></div>
          <span class="model">Live model</span>
        </div>
        <div class="msgs">
          <div class="msg you">
            <strong>You</strong><span class="unv">Unverified</span>
            <p>Platform told me the capacity upgrade explains this. Can I approve it?</p>
          </div>
          <div class="msg">
            <strong>AI assistant</strong><span>Verified facts</span>
            <p>That context may explain the increase, but nothing on file verifies it. The 38% variance still needs a human decision — approving it records this session against the reason you give. The server will not clear it on my word.</p>
          </div>
        </div>
        <div class="cfoot">
          <div style="margin:0 0 10px;display:flex;flex-wrap:wrap;gap:6px">
            <span style="padding:6px 8px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.ink2};font-size:8px;font-weight:700">Why was this flagged?</span>
            <span style="padding:6px 8px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.ink2};font-size:8px;font-weight:700">What evidence would clear it?</span>
            <span style="padding:6px 8px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.ink2};font-size:8px;font-weight:700">Draft a request</span>
          </div>
          <div style="min-height:56px;padding:9px 10px;border:1px solid ${p.lineStrong};border-radius:6px;background:${p.panel};color:${p.faint};font-size:10px">Ask a question or add context&hellip;</div>
          <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:10px">
            <small style="color:${p.faint};font-size:8px">Treated as unverified.</small>
            <span style="min-height:34px;padding:0 13px;display:inline-flex;align-items:center;border-radius:7px;background:${p.accent};color:${p.accentInk};font-size:10px;font-weight:750">Ask assistant</span>
          </div>
        </div>
      </aside>
    </div>
  </main>
</div>
</x-dc>
</body>
</html>
`;
}

await writeFile(new URL("Merged.dc.html", import.meta.url), merged(STRIPE), "utf8");

const canvas2 = {
  artboards: [
    { file: "Merged.dc.html", x: 0, y: 0, w: 1440, h: 900, title: "Proposed · B + merged" },
    { file: "Stripe.dc.html", x: 1560, y: 0, w: 1440, h: 900, title: "Current · B" },
    { file: "Palettes.dc.html", x: 3120, y: 0, w: 1440, h: 660, title: "Palettes" },
    { file: "Main.dc.html", x: 0, y: 1080, w: 1440, h: 900, title: "A · Airwallex-like" },
    { file: "Popup.dc.html", x: 1560, y: 1080, w: 1440, h: 900, title: "Assistant as popup" },
  ],
  annotations: [
    { id: "note-merged", x: 0, y: 980, w: 440, text: "PROPOSED — one row per check, carrying both the server's result and, on the deciding check only, the model's explanation.\n\nThat last constraint is what stops it bloating. Explaining a check that passed is what made the old two-pane version redundant: the middle pane listed four facts and the right pane restated them as prose.\n\nThe accent rule now does real work — the indigo bar marks the sentence the model wrote. Everything else on the row is the server." },
    { id: "note-current", x: 1560, y: 980, w: 420, text: "CURRENT — the same facts appear twice. Middle pane: four check rows. Right pane: the same content as prose reasons.\n\nCompare the right column: the assistant is squeezed below the reasoning, which is why it reads as an afterthought." },
    { id: "note-decision", x: 3120, y: 760, w: 430, text: "Direction B confirmed. Stripe's published values: #0A2540 ink, #635BFF accent, #F6F9FC ground.\n\nThe reason it wins here is that indigo sits clear of red, amber and green — and this screen is almost entirely status." },
  ],
  launch: { view: "canvas" },
};
await writeFile(new URL("canvas.json", import.meta.url), JSON.stringify(canvas2, null, 2) + "\n", "utf8");
console.log("built Merged.dc.html + updated canvas.json");

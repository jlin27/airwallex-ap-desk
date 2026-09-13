import { readFile, writeFile, readdir } from "node:fs/promises";

const dir = new URL("./", import.meta.url);
const css = await readFile(new URL("_shell.css", dir), "utf8");
const sidebarTemplate = await readFile(new URL("_sidebar.html", dir), "utf8");

const STEPS = [
  { key: "intake", label: "Intake", hint: "Paste invoice" },
  { key: "validate", label: "Validate", hint: "Server checks" },
  { key: "queue", label: "Queue", hint: "Exceptions found" },
  { key: "resolve", label: "Resolve", hint: "Decide + record" },
  { key: "payout", label: "Payout", hint: "Airwallex" },
];

function rail(activeIndex) {
  const parts = [];
  STEPS.forEach((step, index) => {
    const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
    const mark = index < activeIndex ? "&#10003;" : String(index + 1);
    parts.push(`<div class="flowStep ${state}"><i>${mark}</i><div><strong>${step.label}</strong><small>${step.hint}</small></div></div>`);
    if (index < STEPS.length - 1) {
      parts.push(`<span class="flowLine ${index < activeIndex ? "done" : ""}"></span>`);
    }
  });
  return `<div class="flowRail">${parts.join("")}</div>`;
}

const files = (await readdir(dir)).filter((name) => name.endsWith(".body.html"));

for (const file of files) {
  const raw = await readFile(new URL(file, dir), "utf8");
  const name = file.replace(".body.html", "");
  const close = raw.indexOf("-->");
  const meta = JSON.parse(raw.slice(raw.indexOf("<!--") + 4, close).trim());
  const body = raw.slice(close + 3).trim();

  const sidebar = sidebarTemplate
    .replace("__NAV_INTAKE__", meta.nav === "intake" ? "active" : "")
    .replace("__NAV_BILLS__", meta.nav === "bills" ? "active" : "")
    .replace("__NAV_EXC__", meta.nav === "exceptions" ? "active" : "")
    .replace("__NAV_AUDIT__", meta.nav === "audit" ? "active" : "")
    .replace("__BILLCOUNT__", String(meta.billCount ?? 6));

  const out = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800;900&family=Geist+Mono:wght@700;800&display=swap">
  <style>
${css}
${meta.css || ""}
  </style>
</helmet>
<div class="apShell">
${sidebar}
  <main class="apMain" id="top">
${body.replace("__RAIL__", meta.step === null ? "" : rail(meta.step))}
  </main>
</div>
</x-dc>
</body>
</html>
`;
  await writeFile(new URL(`${name}.dc.html`, dir), out, "utf8");
  console.log(`built ${name}.dc.html`);
}

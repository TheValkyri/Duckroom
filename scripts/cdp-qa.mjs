// Dev-only CDP driver for localhost mobile QA (no new deps — Node 24 WebSocket).
// Usage: node scripts/cdp-qa.mjs <plan-file.json> [tabId]
// Plan commands: navigate / viewport / eval / screenshot / wait
import { readFileSync } from "node:fs";
const TAB = process.argv[3] ?? "A4E9FD8DC0456604EC8F1FCA1B54E1B4";
const WS_URL = `ws://127.0.0.1:9222/devtools/page/${TAB}`;

const plan = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
const results = [];
let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function log(line) {
  process.stdout.write(line + "\n");
}

const consoleErrors = [];

async function main() {
  ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push("EXCEPTION: " + (msg.params.exceptionDetails?.text ?? "") +
        " " + (msg.params.exceptionDetails?.exception?.description ?? ""));
    }
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  });
  // KHÔNG bật touch emulation: nó nuốt click chuột synthetic của CDP ở
  // một số build Chrome → harness tự khoá mình. Viewport mobile là đủ.

  for (const step of plan) {
    try {
      if (step.viewport) {
        await send("Emulation.setDeviceMetricsOverride", {
          width: step.viewport[0], height: step.viewport[1],
          deviceScaleFactor: step.viewport[2] ?? 2, mobile: step.viewport[0] < 768,
        });
        log(`[viewport] ${step.viewport[0]}x${step.viewport[1]}`);
      }
      if (step.navigate) {
        await send("Page.navigate", { url: `http://localhost:5173${step.navigate}` });
        await new Promise((r) => setTimeout(r, step.settle ?? 2500));
        log(`[navigate] ${step.navigate}`);
      }
      if (step.wait) {
        await new Promise((r) => setTimeout(r, step.wait));
        log(`[wait] ${step.wait}ms`);
      }
      if (step.tap) {
        // Trusted input via mouse events (dispatchTouchEvent with empty
        // touchPoints hangs on some Chrome builds).
        const [x, y] = step.tap;
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        log(`[tap] ${x},${y}`);
        await new Promise((res) => setTimeout(res, step.settle ?? 800));
      }
      if (step.tapSelector) {
        // Resolve selector fresh (post-animation), then tap its center —
        // avoids stale coordinates after route/list entrance animations.
        const r = await send("Runtime.evaluate", {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(step.tapSelector)}); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x + b.width/2), Math.round(b.y + b.height/2)]; })()`,
          returnByValue: true,
        });
        const coords = r?.result?.value;
        if (!coords) {
          log(`[tapSelector] MISSING ${step.tapSelector}`);
        } else {
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed", x: coords[0], y: coords[1], button: "left", clickCount: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: coords[0], y: coords[1], button: "left", clickCount: 1,
          });
          log(`[tapSelector] ${step.tapSelector} @ ${coords.join(",")}`);
          await new Promise((res) => setTimeout(res, step.settle ?? 800));
        }
      }
      if (step.eval) {
        const r = await send("Runtime.evaluate", {
          expression: step.eval,
          returnByValue: true,
          awaitPromise: true,
        });
        const val = r?.result?.value;
        const out = typeof val === "object" ? JSON.stringify(val) : String(val);
        log(`[eval${step.name ? ":" + step.name : ""}] ${out}`);
        results.push({ name: step.name ?? "eval", value: val });
      }
      if (step.screenshot) {
        const r = await send("Page.captureScreenshot", { format: "png" });
        const fs = await import("node:fs");
        fs.writeFileSync(step.screenshot, Buffer.from(r.data, "base64"));
        log(`[screenshot] ${step.screenshot}`);
      }
    } catch (err) {
      log(`[ERROR ${step.name ?? ""}] ${err.message}`);
      results.push({ name: step.name ?? "step", error: err.message });
    }
  }
  log("[console-errors] " + (consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 10)) : "none"));
  ws.close();
}

main().catch((e) => {
  log("[FATAL] " + e.message);
  process.exit(1);
});

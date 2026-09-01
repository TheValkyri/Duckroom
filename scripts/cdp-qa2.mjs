// CDP driver (port 9224 instance for this session)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
const TAB = process.argv[3] ?? "964D34B1DECB5BD63A7CB6DD91D2610C";
const WS_URL = `ws://127.0.0.1:9224/devtools/page/${TAB}`;
const plan = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));

const results = [];
let ws;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const log = (s) => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push("EXC: " + (msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text));
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  for (const step of plan) {
    try {
      if (step.viewport) {
        await send("Emulation.setDeviceMetricsOverride", { width: step.viewport[0], height: step.viewport[1], deviceScaleFactor: step.viewport[2] ?? 2, mobile: step.viewport[0] < 768 });
        log(`[viewport] ${step.viewport[0]}x${step.viewport[1]}`);
      }
      if (step.navigate) {
        await send("Page.navigate", { url: `http://localhost:5173${step.navigate}` });
        await sleep(step.settle ?? 2500);
        log(`[navigate] ${step.navigate}`);
      }
      if (step.wait) { await sleep(step.wait); log(`[wait] ${step.wait}ms`); }
      if (step.tapSelector) {
        const r = await send("Runtime.evaluate", {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(step.tapSelector)}); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x + b.width/2), Math.round(b.y + b.height/2)]; })()`,
          returnByValue: true,
        });
        const c = r?.result?.value;
        if (!c) log(`[tapSelector] MISSING ${step.tapSelector}`);
        else {
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x: c[0], y: c[1], button: "left", clickCount: 1 });
          await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c[0], y: c[1], button: "left", clickCount: 1 });
          log(`[tapSelector] ${step.tapSelector} @ ${c.join(",")}`);
          await sleep(step.settle ?? 800);
        }
      }
      if (step.eval) {
        const r = await send("Runtime.evaluate", { expression: step.eval, returnByValue: true, awaitPromise: true });
        const v = r?.result?.value;
        log(`[eval${step.name ? ":" + step.name : ""}] ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
        results.push({ name: step.name ?? "eval", value: v });
      }
      if (step.measureFPS) {
        // Measure long tasks + fps sample over N seconds
        const r = await send("Runtime.evaluate", {
          awaitPromise: true, returnByValue: true,
          expression: `(async () => {
            const ms = ${step.measureFPS};
            let frames = 0; let longTasks = 0;
            const t0 = performance.now();
            const obs = new PerformanceObserver((l) => { longTasks += l.getEntries().length; });
            obs.observe({ entryTypes: ["longtask"] });
            const start = performance.now();
            await new Promise((res) => {
              const tick = () => { frames++; if (performance.now() - start < ms) requestAnimationFrame(tick); else res(); };
              requestAnimationFrame(tick);
            });
            const dur = performance.now() - t0;
            obs.disconnect();
            return { fps: Math.round(frames / (dur / 1000)), frames, longTasks, dur: Math.round(dur) };
          })()`,
        });
        const v = r?.result?.value;
        log(`[fps${step.name ? ":" + step.name : ""}] ${JSON.stringify(v)}`);
        results.push({ name: "fps:" + (step.name ?? ""), value: v });
      }
      if (step.screenshot) {
        const r = await send("Page.captureScreenshot", { format: "png" });
        const dir = step.screenshot.split("/").slice(0, -1).join("/");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(step.screenshot, Buffer.from(r.data, "base64"));
        log(`[screenshot] ${step.screenshot}`);
      }
    } catch (err) {
      log(`[ERROR ${step.name ?? ""}] ${err.message}`);
      results.push({ name: step.name ?? "step", error: err.message });
    }
  }
  log("[console-errors] " + (consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 8)) : "none"));
  ws.close();
}
main().catch((e) => { log("[FATAL] " + e.message); process.exit(1); });

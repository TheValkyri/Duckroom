const html = await (await fetch("https://duckroom.vercel.app/")).text();
const jsUrl = html.match(/src="([^"]*index-[^"]*\.js)"/)?.[1];
const j = await (await fetch("https://duckroom.vercel.app" + jsUrl)).text();
console.log("has .12 (minified 0.12):", j.includes(".12"));
console.log("has *0.12 pattern:", j.includes("*0.12") || j.includes("* .12"));
console.log("has 360 arithmetic:", j.includes("360"), "| sample:", j.match(/.{40}360.{40}/)?.[0] ?? "n/a");
console.log("has w*0.12 style:", j.match(/0\.12|\.12[),* ]/)?.[0] ?? "not-found");

const html = await (await fetch("https://duckroom.vercel.app/")).text();
const jsUrl = html.match(/src="([^"]*index-[^"]*\.js)"/)?.[1];
const j = await (await fetch("https://duckroom.vercel.app" + jsUrl)).text();
console.log("undo label (string in bundle):", j.includes("Hoàn tác"));
console.log("undo action recreate:", j.includes("Đã khôi phục"));
console.log("search hist key:", j.includes("duckroom.searchHistory."));
console.log("search hist fn:", j.includes("Tìm kiếm gần đây"));
// undo + search-history live trong ROUTE CHUNK my-library/library, không phải index
const routes = html.match(/src="([^"]*my-library[^"]*\.js)"/)?.[1];
console.log("my-library chunk in html:", routes ?? "not-inline");
if (routes) {
  const r = await (await fetch("https://duckroom.vercel.app" + routes)).text();
  console.log("undo in my-library chunk:", r.includes("Hoàn tác"));
  console.log("history listbox in library chunk:", r.includes("Tìm kiếm gần đây"));
}

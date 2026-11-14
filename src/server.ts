import { app } from "./app";
import { config } from "./lib/config";
import { syncClosedLists } from "./lib/closed-lists";

app.listen(config.port, async () => {
  console.log(`Sathsangath API running on http://localhost:${config.port}/api/v1`);
  // Education and profession are closed lists: make the tag categories match the code, so
  // `GET /public/tags` — and with it the mobile app's pickers — serve the canonical values.
  await syncClosedLists();
});

const fs = require("fs");
const app = require("./app");
const config = require("./config");

for (const directory of [config.uploads.root, config.uploads.photos, config.uploads.files, config.uploads.pdf]) {
  fs.mkdirSync(directory, { recursive: true });
}

app.listen(config.port, config.host, () => {
  // Keep startup logging minimal for terminal use.
  console.log(`Dispatch Link listening on http://${config.host}:${config.port}`);
});

// Backward-compatible entry point for recurring-task logic.
// The HTTP API lives in routes/recurring.js and instance generation is
// implemented in services/scheduler.js.
module.exports = require("./services/scheduler");

const { execFile } = require("child_process");

function notify(title, message) {
  if (process.platform !== "linux") {
    console.warn("Desktop notifications currently use Linux notify-send.");
    return;
  }

  execFile(
    "notify-send",
    ["-a", "Daily Task Planner", title, message],
    (error) => {
      if (error) console.error("Notification error:", error.message);
    }
  );
}

module.exports = { notify };

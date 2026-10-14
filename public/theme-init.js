// Runs before first paint so the page never flashes the wrong theme.
// The app stores the preference as JSON ("light", "dark" or "system").
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem("wa-theme") || "null");
    if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
  } catch (error) {
    // Storage can be unavailable (private mode); fall back to the system theme.
  }
})();

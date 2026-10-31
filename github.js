// ----------------------
// Entry point for GitHub.
//
// The only thing actually published to GitHub pages is the `github.html`
// file, which then loads this file for the rest of configuration.
//
// With this, we don't need to wait for Github cache to clear.
// ----------------------

(async() => {
    await loadScript("https://raw.githubusercontent.com/5GameMaker/ghg-mpgarden/refs/heads/master/amx.js");
    await loadScript("https://raw.githubusercontent.com/5GameMaker/ghg-mpgarden/refs/heads/master/index.js");
})();

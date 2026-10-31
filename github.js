// ----------------------
// Entry point for GitHub.
//
// The only thing actually published to GitHub pages is the `github.html`
// file, which then loads this file for the rest of configuration.
//
// With this, we don't need to wait for Github cache to clear.
// ----------------------

{
    const src = Object.getOwnPropertyDescriptor(Image.prototype, "src");
    const srcSet = src.set;
    const newSrc = {
        ...src,
        set: function(value) {
            if (value.startsWith("data:")) return srcSet(value);
            srcSet(`https://raw.githubusercontent.com/5GameMaker/ghg-mpgarden/refs/heads/master/${value}`);
        },
    };
    Object.defineProperty(Image.prototype, "src", newSrc);
}

(async() => {
    await loadScript("https://raw.githubusercontent.com/5GameMaker/ghg-mpgarden/refs/heads/master/amx.js");
    await loadScript("https://raw.githubusercontent.com/5GameMaker/ghg-mpgarden/refs/heads/master/index.js");
})();

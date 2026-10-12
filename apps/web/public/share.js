const button = document.getElementById("share");
button.addEventListener("click", async () => {
  const url = document.querySelector('link[rel="canonical"]').href;
  try {
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    await navigator.clipboard.writeText(url);
    button.textContent = "Link copied!";
    setTimeout(() => {
      button.textContent = "↗ Share";
    }, 2500);
  } catch {
    button.textContent = "Try sharing again";
  }
});

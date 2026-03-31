const searchParams = new URLSearchParams(window.location.search);

if (searchParams.get("ui") === "legacy") {
  void import("./legacy-app");
} else {
  void import("./react-preview/bootstrap").then(({ bootReactPreview }) => {
    bootReactPreview();
  });
}

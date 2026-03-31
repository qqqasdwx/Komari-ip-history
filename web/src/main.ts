const searchParams = new URLSearchParams(window.location.search);

if (searchParams.get("ui") === "react") {
  void import("./react-preview/bootstrap").then(({ bootReactPreview }) => {
    bootReactPreview();
  });
} else {
  void import("./legacy-app");
}

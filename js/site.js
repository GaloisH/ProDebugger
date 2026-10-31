// Links for the static project site (web/export_static.py); the home page shows them only
// there. An empty value renders as "coming soon".
export const PROJECT = {
  url: "https://galoish.github.io/ProDebugger/",  // shown under the QR code (web/static/img/qr-project.svg encodes it)
  paper: "./paper/WSDM_2027_DEMO.pdf",           // a URL, or a PDF in the site's paper/ folder (kept across exports)
  code: "https://github.com/GaloisH/ProDebugger",
  video: {
    youtube: "",                                 // video id or any youtube.com / youtu.be URL
    bilibili: "",                                // BV id or a bilibili.com/video/BV… URL
    mp4: "./video/demo.mp4",                     // a file in the site's video/ folder (kept across exports)
  },
  // Related work from the group, shown on the home page's closing section; each links to its paper.
  related: [
    {name: "MermaidFlow-CF", tagline: "How agentic workflow representation governs constraint-faithful control", venue: "AAAI 2026 TrustAgent Workshop", href: "https://trustagenticai.github.io/AAAI2026/AAAI-Workshop/57.pdf"},
    {name: "NesyProAct", tagline: "Proactive neural-symbolic control for web agents", venue: "NeurIPS 2026", href: "https://openreview.net/pdf?id=9xteuRjHr7"},
    {name: "SkillTracer", tagline: "Structural failure attribution and refinement of agentic skills in long-horizon web tasks", venue: "KDD 2026", href: "https://doi.org/10.1145/3770855.3817981"},
  ],
};

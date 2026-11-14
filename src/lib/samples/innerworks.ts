// Sample brand data. This is DATA, not application logic: nothing else in the codebase
// refers to INNERWORKS. It is installed on request into a workspace like any other brand
// and can be edited or deleted afterwards.
//
// The original INNERWORKS Studio concept was not present in this repository, so this
// profile is reconstructed from its stated scope: engineering content, documentary
// workflow, 3D production, English-language scripts, social strategy and publishing targets.
export const innerworksSample = {
  brand: {
    name: "INNERWORKS",
    tagline: "See how it works.",
    industry: "Engineering and technology media",
    market: "Global, English-speaking",
    description:
      "Documentary-style explainers that open up machines, engines and engineered systems to show how they work on the inside.",
    primary_language: "en",
    languages: ["en"],
    palette: [
      { name: "Graphite", hex: "#0e1116", role: "primary" },
      { name: "Signal amber", hex: "#ffb020", role: "accent" },
      { name: "Steel", hex: "#c9ced6", role: "neutral" },
    ],
    typography: { heading: "Space Grotesk", body: "Inter" },
  },
  guidelines: {
    positioning:
      "INNERWORKS makes the hidden engineering inside everyday and extraordinary machines visible and understandable, through accurate 3D cutaways and calm, precise narration.",
    personality: ["Curious", "Precise", "Calm", "Visual-first"],
    tone: "Clear and confident, like a knowledgeable engineer explaining something they love. No hype. Plain English; define every technical term the first time it appears.",
    voice_do: [
      "Start from a question the viewer already has",
      "Explain cause and effect step by step",
      "Use real units, dimensions and names of parts",
      "Let the visuals carry the explanation; narration supports them",
    ],
    voice_dont: [
      "Exaggerate or use clickbait claims",
      "State figures that have not been verified against a source",
      "Skip steps that a non-engineer needs in order to follow",
    ],
    visual_identity:
      "Dark graphite backgrounds, amber highlights on the part being explained, clean technical labels, 3D cutaways and exploded views, slow deliberate camera moves.",
    content_pillars: [
      { name: "Engines and powertrains", description: "Combustion, electric and hybrid drive systems." },
      { name: "Machines and mechanisms", description: "Gearboxes, pumps, valves, linkages and how motion is transformed." },
      { name: "Aerospace", description: "Jet engines, rockets, control surfaces and flight systems." },
      { name: "Infrastructure and construction", description: "Bridges, tunnels, cranes and heavy equipment." },
      { name: "Manufacturing and robotics", description: "Production lines, CNC, industrial robots and automation." },
      { name: "Everyday engineering", description: "The engineering inside ordinary objects." },
    ],
    key_messages: ["Every machine has a logic you can see once it is opened up.", "Accuracy first: if it is shown, it is correct."],
    objectives: ["Grow a subscribed audience for long-form engineering documentaries", "Turn each documentary into short vertical cutdowns for discovery"],
    creative_guidelines:
      "Documentary structure: hook question, context, how it works (step by step), why it was designed that way, closing insight. One idea per scene.",
    content_strategy:
      "Long-form 16:9 documentaries are the master asset, published on YouTube. Each one is cut into 9:16 shorts for YouTube Shorts, Instagram Reels and TikTok, with a supporting post on Facebook. Captions link back to the full documentary.",
    production_requirements:
      "3D production: Blender cutaway and exploded-view animation, parts modelled to scale and labelled. Master at 16:9; vertical cutdowns reframed, not cropped blindly. Narration and all scripts in English. Technical facts need a cited source before approval.",
    banned_terms: [] as string[],
  },
  audiences: [
    {
      name: "Curious engineering enthusiasts",
      description: "Adults who enjoy understanding how things work, without formal engineering training.",
      pains: ["Explanations that are either too shallow or too academic"],
      desires: ["A clear mental model of how a machine works"],
    },
    {
      name: "Students and early-career engineers",
      description: "People studying or starting work in mechanical, aerospace or related fields.",
      pains: ["Textbook diagrams that are hard to visualise in 3D"],
      desires: ["Accurate visual references they can trust"],
    },
  ],
  // Publishing targets. Handles are placeholders until the real accounts are entered.
  socialAccounts: [
    { platform: "youtube", handle: "@innerworks", display_name: "Placeholder handle — replace with the real channel" },
    { platform: "instagram", handle: "@innerworks", display_name: "Placeholder handle — replace with the real account" },
    { platform: "tiktok", handle: "@innerworks", display_name: "Placeholder handle — replace with the real account" },
    { platform: "facebook", handle: "innerworks", display_name: "Placeholder handle — replace with the real page" },
  ],
  // Brand-specific workflow override: documentaries add an explicit editing stage.
  workflow: {
    module: "video",
    content_type: "documentary",
    name: "INNERWORKS documentary workflow",
    stages: ["brief", "research", "strategy", "script", "generation", "editing", "quality_control", "human_approval", "distribution", "analytics"],
  },
};

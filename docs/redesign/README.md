# Inject Designer redesign

This folder holds the design proposal for reworking the Inject Designer and the
prototypes that back it.

- **[PRD-inject-designer-redesign.md](./PRD-inject-designer-redesign.md)** — the product requirements document.
- **[mockups/guided-stepper.html](./mockups/guided-stepper.html)** — clickable prototype of the per-inject **Guided Stepper** (Task → Flow → Completion, with the live test merged into the Completion step).
- **[mockups/scenario-map.html](./mockups/scenario-map.html)** — clickable prototype of the **Scenario Map** (drag the ▸ handle or a whole card onto another inject to set a prerequisite; drop a card into the timed lane / onto the start rail to change when it fires).

The mockups are self-contained HTML — open either file directly in a browser, no build step. They are reference behavior/layout for the implementation, not production code. Both use the same sample scenario ("Spearphishing Incident Response") spanning MISP, webhook and Python injects to demonstrate the tool-agnostic design.

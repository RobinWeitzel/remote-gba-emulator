import { useState } from "react";
import {
  Sheet, ActionSheet, Modal, Prompt, FAB,
  Slider, SegmentedControl, Carousel, StatusPill,
  type SheetState,
} from "./primitives";

export function PrimitivesShowcase() {
  const [sheetState, setSheetState] = useState<SheetState>("peek");
  const [actionOpen, setActionOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [sliderValue, setSliderValue] = useState(50);
  const [segValue, setSegValue] = useState<"a" | "b" | "c">("a");

  return (
    <div style={{ padding: 20, color: "var(--fg)", background: "var(--bg-0)", minHeight: "100vh" }}>
      <h1>Primitives showcase</h1>
      <p>Manually verify each primitive renders + behaves correctly.</p>

      <h2>SegmentedControl</h2>
      <SegmentedControl
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
          { value: "c", label: "Gamma" },
        ]}
        value={segValue}
        onChange={setSegValue}
        fullWidth
      />

      <h2 style={{ marginTop: 24 }}>Slider</h2>
      <Slider
        label="Opacity"
        value={sliderValue}
        min={0}
        max={100}
        onChange={setSliderValue}
        formatValue={(v) => `${v}%`}
      />

      <h2 style={{ marginTop: 24 }}>StatusPill</h2>
      <StatusPill tone="success" showDot>Connected</StatusPill>

      <h2 style={{ marginTop: 60 }}>Buttons opening overlays</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setActionOpen(true)}>Open ActionSheet</button>
        <button onClick={() => setModalOpen(true)}>Open Modal</button>
        <button onClick={() => setPromptOpen(true)}>Open Prompt</button>
        <button onClick={() => setSheetState("expanded")}>Expand Sheet</button>
      </div>

      <h2 style={{ marginTop: 24 }}>Carousel</h2>
      <Carousel ariaLabel="Demo carousel">
        {["red", "blue", "green", "purple"].map((c) => (
          <div key={c} style={{ height: 160, background: c, borderRadius: 18 }} />
        ))}
      </Carousel>

      <FAB ariaLabel="Add" onClick={() => alert("FAB tapped")}>+</FAB>

      <Sheet state={sheetState} onStateChange={setSheetState} peekHeight={60}>
        <div style={{ padding: 12 }}>
          <h3>Sheet body</h3>
          <p>Drag the handle to switch between peek and expanded.</p>
          <button onClick={() => setSheetState("closed")}>Close</button>
        </div>
      </Sheet>

      <ActionSheet
        open={actionOpen}
        title="Choose an action"
        items={[
          { label: "Rename…", onSelect: () => console.log("rename") },
          { label: "Archive", onSelect: () => console.log("archive") },
          { label: "Delete forever", onSelect: () => console.log("delete"), destructive: true },
        ]}
        onClose={() => setActionOpen(false)}
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h1>I'm a modal</h1>
        <p>Press Esc or tap the button to close.</p>
        <button onClick={() => setModalOpen(false)}>Close</button>
      </Modal>

      <Prompt
        open={promptOpen}
        title="What's your favorite GBA game?"
        placeholder="e.g. Pokémon Emerald"
        onSubmit={(v) => { console.log("submitted", v); setPromptOpen(false); }}
        onCancel={() => setPromptOpen(false)}
      />
    </div>
  );
}

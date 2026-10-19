// The fault items on the DVSA driving test report (form DL25), in the order
// and under the headings they appear on the form. An instructor can log a test
// fault by fault against these, instead of typing the three totals.
//
// The web app keeps the same list (src/lib/dl25.ts). Keys are stored on every
// detailed test, so a key must never be renamed or reused; add new ones only.
//
// Every item takes driving faults (a count, as the examiner tallies them) and
// a serious and a dangerous mark, except the eyesight test, which can only be
// marked serious.
const GROUPS = [
  { key: "eyesight", label: "Eyesight test", items: [["eyesight", "Eyesight test", { drivingFaults: false, dangerous: false }]] },
  { key: "manoeuvres", label: "Manoeuvres", items: [["control", "Control"], ["observation", "Observation"]] },
  { key: "showMeTellMe", label: "Show me / Tell me", items: [["showMeTellMe", "Show me / Tell me"]] },
  { key: "controlledStop", label: "Controlled stop", items: [["controlledStop", "Controlled stop"]] },
  {
    key: "control",
    label: "Control",
    items: [
      ["accelerator", "Accelerator"],
      ["clutch", "Clutch"],
      ["gears", "Gears"],
      ["footbrake", "Footbrake"],
      ["parkingBrake", "Parking brake"],
      ["steering", "Steering"],
    ],
  },
  { key: "precautions", label: "Precautions", items: [["precautions", "Precautions"]] },
  { key: "ancillaryControls", label: "Ancillary controls", items: [["ancillaryControls", "Ancillary controls"]] },
  { key: "moveOff", label: "Move off", items: [["safety", "Safety"], ["control", "Control"]] },
  {
    key: "mirrors",
    label: "Use of mirrors",
    items: [["signalling", "Signalling"], ["changeDirection", "Change direction"], ["changeSpeed", "Change speed"]],
  },
  { key: "signals", label: "Signals", items: [["necessary", "Necessary"], ["correctly", "Correctly"], ["timed", "Timed"]] },
  {
    key: "junctions",
    label: "Junctions",
    items: [
      ["approachSpeed", "Approach speed"],
      ["observation", "Observation"],
      ["turningRight", "Turning right"],
      ["turningLeft", "Turning left"],
      ["cuttingCorners", "Cutting corners"],
    ],
  },
  { key: "judgement", label: "Judgement", items: [["overtaking", "Overtaking"], ["meeting", "Meeting"], ["crossing", "Crossing"]] },
  { key: "positioning", label: "Positioning", items: [["normalDriving", "Normal driving"], ["laneDiscipline", "Lane discipline"]] },
  { key: "pedestrianCrossings", label: "Pedestrian crossings", items: [["pedestrianCrossings", "Pedestrian crossings"]] },
  { key: "positionNormalStop", label: "Position / normal stop", items: [["positionNormalStop", "Position / normal stop"]] },
  { key: "awarenessPlanning", label: "Awareness planning", items: [["awarenessPlanning", "Awareness planning"]] },
  { key: "clearance", label: "Clearance", items: [["clearance", "Clearance"]] },
  { key: "followingDistance", label: "Following distance", items: [["followingDistance", "Following distance"]] },
  { key: "useOfSpeed", label: "Use of speed", items: [["useOfSpeed", "Use of speed"]] },
  { key: "progress", label: "Progress", items: [["appropriateSpeed", "Appropriate speed"], ["undueHesitation", "Undue hesitation"]] },
  {
    key: "responseToSigns",
    label: "Response to signs / signals",
    items: [
      ["trafficSigns", "Traffic signs"],
      ["roadMarkings", "Road markings"],
      ["trafficLights", "Traffic lights"],
      ["trafficControllers", "Traffic controllers"],
      ["otherRoadUsers", "Other road users"],
    ],
  },
].map((group) => ({
  key: group.key,
  label: group.label,
  items: group.items.map(([key, label, marks = {}]) => ({
    // "junctions.observation": unique across the form, and readable in the data.
    key: `${group.key}.${key}`,
    label,
    group: group.key,
    groupLabel: group.label,
    drivingFaults: marks.drivingFaults !== false,
    serious: true,
    dangerous: marks.dangerous !== false,
  })),
}));

const ITEMS = GROUPS.flatMap((group) => group.items);
const ITEM_BY_KEY = new Map(ITEMS.map((item) => [item.key, item]));

module.exports = { GROUPS, ITEMS, ITEM_BY_KEY };

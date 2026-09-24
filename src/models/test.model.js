const crypto = require("crypto");
const mongoose = require("mongoose");

const testSchema = new mongoose.Schema(
  {
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Short human-readable id, e.g. "T-9F3A21". Generated on save and shown
    // in the test log so it can be quoted and searched for.
    reference: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    // --- Phase 1: who, when, where ---
    pupilName: {
      type: String,
      required: [true, "Pupil name is required"],
      trim: true,
    },
    testDate: {
      type: Date,
      required: [true, "Test date is required"],
    },
    // A copy of the centre, not a link. If the instructor later removes the
    // centre from their profile, past tests still read correctly.
    testCenter: {
      centerId: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      code: { type: String },
    },

    // --- Phase 2: the result ---
    result: {
      type: String,
      enum: ["pass", "fail"],
      required: [true, "Result is required"],
    },

    // --- Phase 3: faults ---
    faults: {
      driving: { type: Number, default: 0, min: 0 },
      serious: { type: Number, default: 0, min: 0 },
      dangerous: { type: Number, default: 0, min: 0 },
    },
    physicalIntervention: { type: Boolean, default: false },
    verbalIntervention: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Give every new test a unique reference. Six hex characters is 16.7 million
// combinations; the loop covers the rare clash rather than assuming it away.
testSchema.pre("validate", async function setReference() {
  if (this.reference) return;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `T-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const taken = await mongoose.models.Test.exists({ reference: candidate });
    if (!taken) {
      this.reference = candidate;
      return;
    }
  }

  throw new Error("Could not generate a unique test reference");
});

testSchema.virtual("totalFaults").get(function totalFaults() {
  const { driving = 0, serious = 0, dangerous = 0 } = this.faults || {};
  return driving + serious + dangerous;
});

testSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Test", testSchema);

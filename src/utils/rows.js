// Small helpers shared by the models.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids come from URLs. Anything that is not a uuid cannot match a row, so the
// models treat it as "not found" instead of letting Postgres throw.
function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

// Drops null and undefined keys, so optional fields are left out of responses
// instead of being sent as null.
function compact(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
        ? compact(value)
        : value;
  }
  return out;
}

// Escapes % _ and \ so user text is matched literally inside ILIKE.
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, "\\$&")}%`;
}

module.exports = { isUuid, compact, likePattern };

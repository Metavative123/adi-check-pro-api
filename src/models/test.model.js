const crypto = require("crypto");
const { query } = require("../utils/connectDatabase");
const { isUuid, compact, likePattern } = require("../utils/rows");

// Turns a database row into the shape the API has always returned.
function fromRow(row) {
  if (!row) return null;

  const faults = {
    driving: row.driving_faults,
    serious: row.serious_faults,
    dangerous: row.dangerous_faults,
  };

  return {
    ...compact({
      _id: row.id,
      instructor: row.instructor_id,
      reference: row.reference,
      pupilName: row.pupil_name,
      testDate: row.test_date,
      testCenter: {
        centerId: row.test_center_id,
        name: row.test_center_name,
        code: row.test_center_code,
      },
      result: row.result,
      faults,
      physicalIntervention: row.physical_intervention,
      verbalIntervention: row.verbal_intervention,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
    totalFaults: faults.driving + faults.serious + faults.dangerous,
    id: row.id,
  };
}

// Builds a WHERE clause. Every filter is optional and they all combine.
//   search       matches a pupil name or a test reference
//   pupilName    one pupil, case-insensitive exact match
//   from / to    test date range (Date objects)
function buildWhere(instructorId, filters = {}) {
  const params = [instructorId];
  const clauses = ["instructor_id = $1"];
  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replace(/\?/g, `$${params.length}`));
  };

  if (filters.search) add("(pupil_name ilike ? or reference ilike ?)", likePattern(filters.search));
  if (filters.pupilName) add("lower(pupil_name) = lower(?)", filters.pupilName);
  if (filters.from) add("test_date >= ?", filters.from);
  if (filters.to) add("test_date <= ?", filters.to);
  if (filters.physicalIntervention !== undefined) {
    add("physical_intervention = ?", filters.physicalIntervention);
  }
  if (filters.verbalIntervention !== undefined) {
    add("verbal_intervention = ?", filters.verbalIntervention);
  }

  return { where: clauses.join(" and "), params };
}

const ORDER = {
  newest: "test_date desc, created_at desc",
  oldest: "test_date asc, created_at asc",
};

// One page of tests, newest first, plus the total that match.
async function findPage(instructorId, filters, { offset, limit }) {
  const { where, params } = buildWhere(instructorId, filters);
  const n = params.length;

  const [page, count] = await Promise.all([
    query(
      `select * from tests where ${where} order by ${ORDER.newest} offset $${n + 1} limit $${n + 2}`,
      [...params, offset, limit]
    ),
    query(`select count(*)::int as total from tests where ${where}`, params),
  ]);

  return { tests: page.rows.map(fromRow), total: count.rows[0].total };
}

// Every test that matches, for the charts, ratings and reports.
async function findAll(instructorId, filters = {}, { order = "newest" } = {}) {
  const { where, params } = buildWhere(instructorId, filters);
  const { rows } = await query(
    `select * from tests where ${where} order by ${ORDER[order]}`,
    params
  );
  return rows.map(fromRow);
}

async function findOwned(instructorId, testId) {
  if (!isUuid(testId)) return null;
  const { rows } = await query("select * from tests where id = $1 and instructor_id = $2", [
    testId,
    instructorId,
  ]);
  return fromRow(rows[0]);
}

// Every new test gets a short unique reference such as "T-9F3A21". Six hex
// characters is 16.7 million combinations; the retry covers the rare clash.
async function create(test) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = `T-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    try {
      const { rows } = await query(
        `insert into tests (
           instructor_id, reference, pupil_name, test_date,
           test_center_id, test_center_name, test_center_code,
           result, driving_faults, serious_faults, dangerous_faults,
           physical_intervention, verbal_intervention
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning *`,
        [
          test.instructor,
          reference,
          String(test.pupilName).trim(),
          test.testDate,
          test.testCenter.centerId,
          test.testCenter.name,
          test.testCenter.code || null,
          test.result,
          test.faults.driving,
          test.faults.serious,
          test.faults.dangerous,
          test.physicalIntervention,
          test.verbalIntervention,
        ]
      );
      return fromRow(rows[0]);
    } catch (err) {
      const referenceClash = err.code === "23505" && err.constraint === "tests_reference_key";
      if (!referenceClash) throw err;
    }
  }

  throw new Error("Could not generate a unique test reference");
}

// Writes back a test in the API shape (as returned by fromRow).
async function save(test) {
  const { rows } = await query(
    `update tests set
       pupil_name = $3,
       test_date = $4,
       test_center_id = $5,
       test_center_name = $6,
       test_center_code = $7,
       result = $8,
       driving_faults = $9,
       serious_faults = $10,
       dangerous_faults = $11,
       physical_intervention = $12,
       verbal_intervention = $13,
       updated_at = now()
     where id = $1 and instructor_id = $2
     returning *`,
    [
      test._id,
      test.instructor,
      String(test.pupilName).trim(),
      test.testDate,
      test.testCenter.centerId,
      test.testCenter.name,
      test.testCenter.code || null,
      test.result,
      test.faults.driving,
      test.faults.serious,
      test.faults.dangerous,
      test.physicalIntervention,
      test.verbalIntervention,
    ]
  );
  return fromRow(rows[0]);
}

async function deleteOwned(instructorId, testId) {
  if (!isUuid(testId)) return null;
  const { rows } = await query(
    "delete from tests where id = $1 and instructor_id = $2 returning *",
    [testId, instructorId]
  );
  return fromRow(rows[0]);
}

// Pupils are not a table of their own - a pupil is a name on one or more tests.
// Names are grouped case-insensitively, so "sara khan" and "Sara Khan" are one
// pupil, however the name was typed on the day.

// Which pupils match a search (by name or test reference), newest first.
async function matchPupils(instructorId, search, limit) {
  const { where, params } = buildWhere(instructorId, { search });
  const { rows } = await query(
    `select lower(pupil_name) as key,
            max(test_date) as "lastTestDate",
            array_agg(distinct reference) as "references"
     from tests where ${where}
     group by lower(pupil_name)
     order by "lastTestDate" desc
     limit $${params.length + 1}`,
    [...params, limit]
  );
  return rows;
}

// Totals across every test for the given pupils (keys are lower-cased names).
async function summarisePupils(instructorId, keys) {
  const { rows } = await query(
    `select lower(pupil_name) as key,
            (array_agg(pupil_name order by created_at desc))[1] as name,
            count(*)::int as tests,
            max(test_date) as "lastTestDate"
     from tests
     where instructor_id = $1 and lower(pupil_name) = any($2)
     group by lower(pupil_name)
     order by "lastTestDate" desc`,
    [instructorId, keys]
  );
  return rows;
}

module.exports = {
  findPage,
  findAll,
  findOwned,
  create,
  save,
  deleteOwned,
  matchPupils,
  summarisePupils,
};

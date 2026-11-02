// Founding member places. See founding_places in db/schema.sql.
const { query } = require("../utils/connectDatabase");
const { foundingLimit } = require("../config/plans");

// How many places are gone and how many are left.
async function counts() {
  const { rows } = await query("select count(*)::int as taken from founding_places");
  const taken = rows[0].taken;
  return { limit: foundingLimit, taken, left: Math.max(foundingLimit - taken, 0) };
}

// The place this user holds, or held before cancelling. null if none.
async function placeFor(userId) {
  const { rows } = await query("select place from founding_places where user_id = $1", [userId]);
  return rows[0]?.place ?? null;
}

// Takes the next free place for this user. Returns their place number - the
// same one again if they already have it - or null when all are gone.
//
// Two payments landing at once can both pick the same next number; the
// primary key lets only one of them have it, so the other simply tries again.
async function claim(userId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await placeFor(userId);
    if (existing) return existing;

    // The lowest free number, so a place given back by an unpaid trial is
    // handed out again.
    const { rows } = await query(
      `insert into founding_places (place, user_id)
       select min(n), $1 from generate_series(1, $2::int) n
        where not exists (select 1 from founding_places f where f.place = n)
       having min(n) is not null
       on conflict do nothing
       returning place`,
      [userId, foundingLimit]
    );
    if (rows[0]) return rows[0].place;

    const { left } = await counts();
    if (left === 0) return placeFor(userId);
  }
  return placeFor(userId);
}

// Gives a place back, but only one that was never paid for: a founding trial
// that was cancelled or ran out. A place someone has paid in stays used up
// for good. Returns true when a place was freed.
async function release(userId) {
  const { rowCount } = await query(
    `delete from founding_places f
      where f.user_id = $1
        and not exists (
          select 1 from payments p
           where p.instructor_id = $1
             and p.plan_id = 'founding'
             and p.status in ('paid', 'refunded')
             and p.amount > 0
        )`,
    [userId]
  );
  return rowCount > 0;
}

module.exports = { counts, placeFor, claim, release };

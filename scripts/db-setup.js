// Creates the tables in the database named by DATABASE_URL.
// Safe to run more than once - every statement is "if not exists".
//
//   npm run db:setup
const fs = require("fs");
const path = require("path");
const { query, disconnectDatabase } = require("../src/utils/connectDatabase");

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await query(sql);
  const { rows } = await query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1"
  );
  console.log("Tables ready:", rows.map((r) => r.table_name).join(", "));
}

main()
  .catch((err) => {
    console.error("Database setup failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());

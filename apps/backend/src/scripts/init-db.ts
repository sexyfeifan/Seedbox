import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://seedbox:seedbox@localhost:5432/seedbox";
  const pool = new Pool({ connectionString: databaseUrl });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(currentDir, "../../../../docs/database.sql");
  const sql = await readFile(schemaPath, "utf8");

  try {
    await pool.query(sql);
    console.log(`Database initialized using ${schemaPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

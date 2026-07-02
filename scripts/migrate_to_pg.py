import os
import sqlite3
import pandas as pd
from sqlalchemy import create_engine
from dotenv import load_dotenv

load_dotenv()

SQLITE_PATH = "./central_hub.db"
PG_URL = os.getenv("DATABASE_URL")

def migrate():
    if not PG_URL or "sqlite" in PG_URL:
        print("❌ Please set a valid PostgreSQL DATABASE_URL in .env before migrating.")
        return

    print(f"🔄 Migrating data from {SQLITE_PATH} to PostgreSQL...")
    
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    pg_engine = create_engine(PG_URL)

    tables = ["raw_data", "processed_data", "api_keys", "mapping_rules"]
    
    for table in tables:
        try:
            print(f"📦 Migrating table: {table}...")
            df = pd.read_sql_query(f"SELECT * FROM {table}", sqlite_conn)
            if not df.empty:
                df.to_sql(table, pg_engine, if_exists='append', index=False)
                print(f"✅ Table {table} migrated ({len(df)} rows).")
            else:
                print(f"ℹ️ Table {table} is empty, skipping.")
        except Exception as e:
            print(f"⚠️ Failed to migrate {table}: {e}")

    sqlite_conn.close()
    print("✨ Migration complete!")

if __name__ == "__main__":
    migrate()
